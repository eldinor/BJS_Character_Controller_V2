import {
  CharacterSupportedState,
  createPhysicsCharacterController,
  physicsRaycast,
  type CharacterSurfaceInfo,
  type PhysicsCharacterController,
  type PhysicsBody,
  type PhysicsWorld,
  type Quat,
  type Vec3,
} from "@babylonjs/lite";
import { resolveConfig } from "./config";
import { EventBus } from "./events";
import { copyVec3, lengthXZ, moveTowards, moveTowardsAngle, normalizedXZ } from "./math";
import {
  assertLiteInternals,
  getAnimatedSupportBody,
  resetCharacterContacts,
  resizeCharacterCapsule,
} from "./lite-internals";
import type {
  CharacterStance,
  ClearanceTest,
  LiteCCConfig,
  LiteCCEvents,
  LiteCCInput,
  LiteCCSnapshot,
} from "./types";

const DOWN: Vec3 = { x: 0, y: -1, z: 0 };
const UP: Vec3 = { x: 0, y: 1, z: 0 };

export class LiteCharacterController {
  readonly config: LiteCCConfig;
  readonly physics: PhysicsCharacterController;
  readonly events = new EventBus<LiteCCEvents>();

  private stanceValue: CharacterStance = "standing";
  private groundedValue = false;
  private slidingValue = false;
  private coyoteRemaining = 0;
  private jumpBufferRemaining = 0;
  private disposed = false;
  private clearanceTest: ClearanceTest | undefined;
  private readonly world: PhysicsWorld;
  private facingYawValue = 0;
  private animatedSupportBody: PhysicsBody | undefined;
  private animatedSupportPosition: Vec3 | undefined;
  private animatedSupportRotation: Quat | undefined;
  private nearLedgeValue = false;
  private ledgeDropValue: number | null = null;
  private fallingValue = false;
  private fallTimeValue = 0;
  private stepMovementDebt = 0;
  private supportYawDeltaValue = 0;

  constructor(world: PhysicsWorld, position: Vec3, config: Partial<LiteCCConfig> = {}) {
    this.world = world;
    this.config = resolveConfig(config);
    this.physics = createPhysicsCharacterController(world, position, {
      capsuleHeight: this.config.standingHeight,
      capsuleRadius: this.config.radius,
    });
    assertLiteInternals(this.physics);
    this.applyPhysicsConfig();
  }

  get stance(): CharacterStance {
    return this.stanceValue;
  }

  get grounded(): boolean {
    return this.groundedValue;
  }

  get sliding(): boolean {
    return this.slidingValue;
  }

  get facingYaw(): number {
    return this.facingYawValue;
  }

  setClearanceTest(test: ClearanceTest | undefined): void {
    this.clearanceTest = test;
  }

  /** Call exactly once per Havok step, normally from Lite's onPhysicsAfterStep callback. */
  step(deltaSeconds: number, input: LiteCCInput): LiteCCSnapshot {
    this.assertActive();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return this.snapshot();
    const dt = Math.min(deltaSeconds, 0.1);
    this.supportYawDeltaValue = 0;
    const moveDirection = normalizedXZ(input.move);

    this.updateStance(input.crouch === true);
    if (input.jumpPressed) this.jumpBufferRemaining = this.config.jumpBufferTime;
    else this.jumpBufferRemaining = Math.max(0, this.jumpBufferRemaining - dt);

    const wasGrounded = this.groundedValue;
    let support = this.physics.checkSupport(dt, DOWN);
    this.groundedValue = support.supportedState === CharacterSupportedState.SUPPORTED;
    this.slidingValue = support.supportedState === CharacterSupportedState.SLIDING;
    this.updateLedge((this.groundedValue || wasGrounded) ? moveDirection : undefined);

    if (
      !this.groundedValue &&
      wasGrounded &&
      !this.nearLedgeValue &&
      this.jumpBufferRemaining <= 0 &&
      this.physics.getVelocity().y <= 0
    ) {
      const snappedSupport = this.trySnapDown();
      if (snappedSupport) {
        support = snappedSupport;
        this.groundedValue = true;
        this.slidingValue = false;
      }
    }
    this.followAnimatedSupport();

    if (this.groundedValue) this.coyoteRemaining = this.config.coyoteTime;
    else this.coyoteRemaining = Math.max(0, this.coyoteRemaining - dt);

    const current = this.physics.getVelocity();
    const requestedSpeed = Math.max(0, input.speed ?? this.modeSpeed(input.sprint === true));
    const movementBudget = requestedSpeed * dt;
    // Never consume the whole input budget: the controller still needs enough
    // forward motion to contact the following riser. The remaining 35% avoids
    // the head-on stair stall that diagonal input could otherwise bypass.
    const maxStepRepayment = movementBudget * 0.65;
    const repaidStepDistance = Math.min(this.stepMovementDebt, maxStepRepayment);
    this.stepMovementDebt -= repaidStepDistance;
    const effectiveSpeed = movementBudget > 1e-8
      ? requestedSpeed * (1 - repaidStepDistance / movementBudget)
      : requestedSpeed;
    if (Math.abs(moveDirection.x) + Math.abs(moveDirection.z) > 1e-6) {
      const targetYaw = Math.atan2(moveDirection.x, moveDirection.z);
      this.facingYawValue = moveTowardsAngle(this.facingYawValue, targetYaw, this.config.turnSpeed * dt);
    }
    const desired = {
      x: moveDirection.x * effectiveSpeed,
      y: current.y,
      z: moveDirection.z * effectiveSpeed,
    };

    if (this.groundedValue && effectiveSpeed > 0) {
      this.tryStep(moveDirection);
    }

    let velocity = this.calculateVelocity(dt, current, desired, support);
    if (this.jumpBufferRemaining > 0 && this.coyoteRemaining > 0) {
      velocity.y = this.config.jumpSpeed;
      this.jumpBufferRemaining = 0;
      this.coyoteRemaining = 0;
      this.groundedValue = false;
      this.events.emit("jumped", undefined);
    } else if (!this.groundedValue) {
      velocity.y = Math.max(-this.config.terminalVelocity, velocity.y - this.config.gravity * dt);
    } else if (velocity.y < 0) {
      velocity.y = 0;
    }

    const wasFalling = this.fallingValue;
    this.fallingValue = !this.groundedValue && velocity.y <= 0;
    this.fallTimeValue = this.fallingValue ? this.fallTimeValue + dt : 0;
    if (!wasFalling && this.fallingValue) {
      this.events.emit("fallStarted", { fromLedge: this.nearLedgeValue });
    }

    this.physics.setVelocity(velocity);
    this.physics.integrate(dt, support, { x: 0, y: -this.config.gravity, z: 0 });

    if (!wasGrounded && this.groundedValue) {
      this.events.emit("landed", { velocity: current.y });
    }
    return this.snapshot();
  }

  addImpulse(impulse: Vec3): void {
    this.assertActive();
    const velocity = this.physics.getVelocity();
    this.physics.setVelocity({
      x: velocity.x + impulse.x,
      y: velocity.y + impulse.y,
      z: velocity.z + impulse.z,
    });
    if (impulse.y > 0) {
      this.groundedValue = false;
      this.coyoteRemaining = 0;
    }
  }

  teleport(position: Vec3, preserveVelocity = false): void {
    this.assertActive();
    this.physics.setPosition(position);
    if (!preserveVelocity) this.physics.setVelocity({ x: 0, y: 0, z: 0 });
    this.groundedValue = false;
    this.slidingValue = false;
    this.coyoteRemaining = 0;
    this.stepMovementDebt = 0;
  }

  snapshot(): LiteCCSnapshot {
    return {
      position: copyVec3(this.physics.getPosition()),
      velocity: copyVec3(this.physics.getVelocity()),
      grounded: this.groundedValue,
      sliding: this.slidingValue,
      stance: this.stanceValue,
      facingYaw: this.facingYawValue,
      horizontalSpeed: lengthXZ(this.physics.getVelocity()),
      nearLedge: this.nearLedgeValue,
      ledgeDrop: this.ledgeDropValue,
      falling: this.fallingValue,
      fallTime: this.fallTimeValue,
      supportYawDelta: this.supportYawDeltaValue,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.events.clear();
    this.physics.dispose();
  }

  private calculateVelocity(
    dt: number,
    current: Vec3,
    desired: Vec3,
    support: CharacterSurfaceInfo,
  ): Vec3 {
    if (this.groundedValue) {
      this.physics.maxAcceleration = lengthXZ(desired) > 1e-5
        ? this.config.groundAcceleration
        : this.config.groundBraking;
      const forward = normalizedXZ(desired);
      const safeForward = Math.abs(forward.x) + Math.abs(forward.z) > 1e-6 ? forward : { x: 0, y: 0, z: 1 };
      return this.physics.calculateMovement(
        dt,
        safeForward,
        support.averageSurfaceNormal,
        current,
        support.averageSurfaceVelocity,
        desired,
        UP,
      );
    }

    const airMultiplier = current.y <= 0 ? this.config.fallingAirControlMultiplier : 1;
    const maxDelta = this.config.airAcceleration * airMultiplier * dt;
    return {
      x: moveTowards(current.x, desired.x, maxDelta),
      y: current.y,
      z: moveTowards(current.z, desired.z, maxDelta),
    };
  }

  /** Resolve a low vertical obstruction by sampling its walkable top and lifting the capsule. */
  private tryStep(direction: Vec3): boolean {
    if (this.config.maxStepHeight <= 0) return false;
    const position = this.physics.getPosition();
    const height = this.heightFor(this.stanceValue);
    const feetY = position.y - height * 0.5;
    const front = this.config.radius + this.physics.keepDistance + 0.01;
    const endDistance = front + this.config.stepProbeDistance;
    const fromLow = {
      x: position.x + direction.x * front,
      y: feetY + this.config.stepSkin,
      z: position.z + direction.z * front,
    };
    const toLow = {
      x: position.x + direction.x * endDistance,
      y: fromLow.y,
      z: position.z + direction.z * endDistance,
    };
    const obstruction = physicsRaycast(this.world, fromLow, toLow);
    if (!obstruction.hasHit) return false;
    // A walkable ramp intersects the low forward ray too, but it is not a
    // step. Let Havok's support/slope solver handle upward-facing surfaces;
    // stepping is reserved for a wall-like riser followed by a walkable top.
    if (obstruction.hitNormal.y >= this.physics.maxSlopeCosine) return false;

    const clearanceY = feetY + this.config.maxStepHeight + this.config.stepSkin;
    const fromHigh = { x: fromLow.x, y: clearanceY, z: fromLow.z };
    const toHigh = { x: toLow.x, y: clearanceY, z: toLow.z };
    if (physicsRaycast(this.world, fromHigh, toHigh).hasHit) return false;

    const downFrom = { x: toLow.x, y: clearanceY, z: toLow.z };
    const downTo = { x: toLow.x, y: feetY - this.config.stepSkin, z: toLow.z };
    const landing = physicsRaycast(this.world, downFrom, downTo);
    if (!landing.hasHit || landing.hitNormal.y < this.physics.maxSlopeCosine) return false;

    const rise = landing.hitPoint.y - feetY;
    if (rise <= this.config.stepSkin || rise > this.config.maxStepHeight) return false;

    // Lift and advance together. Raising in place leaves the capsule against
    // the riser, so it falls back down and repeats the step every frame.
    this.physics.setPosition({
      x: position.x + direction.x * this.config.stepProbeDistance,
      y: position.y + rise + this.config.stepSkin,
      z: position.z + direction.z * this.config.stepProbeDistance,
    });
    this.stepMovementDebt += this.config.stepProbeDistance;
    resetCharacterContacts(this.physics);
    this.events.emit("stepped", { height: rise });
    return true;
  }

  private trySnapDown(): CharacterSurfaceInfo | null {
    if (this.config.groundSnapDistance <= 0) return null;
    const position = this.physics.getPosition();
    const feetY = position.y - this.heightFor(this.stanceValue) * 0.5;
    const from = { x: position.x, y: feetY + this.config.stepSkin, z: position.z };
    const to = { x: position.x, y: feetY - this.config.groundSnapDistance, z: position.z };
    const hit = physicsRaycast(this.world, from, to);
    if (!hit.hasHit || hit.hitNormal.y < this.physics.maxSlopeCosine) return null;
    // Snap-down is for flat stair tops and small ledges. Repeated vertical
    // correction on an inclined ramp fights Havok's support motion and causes
    // visible downhill chatter, so continuous slopes stay with the slope solver.
    if (hit.hitNormal.y < 0.98) return null;

    const drop = feetY - hit.hitPoint.y;
    if (drop <= this.config.stepSkin || drop > this.config.groundSnapDistance) return null;
    this.physics.setPosition({ x: position.x, y: position.y - drop + this.config.stepSkin, z: position.z });
    resetCharacterContacts(this.physics);
    this.events.emit("snappedDown", { distance: drop });
    return {
      isSurfaceDynamic: false,
      supportedState: CharacterSupportedState.SUPPORTED,
      averageSurfaceNormal: hit.hitNormal,
      averageSurfaceVelocity: { x: 0, y: 0, z: 0 },
      averageAngularSurfaceVelocity: { x: 0, y: 0, z: 0 },
    };
  }

  private updateLedge(direction: Vec3 | undefined): void {
    let nearLedge = false;
    let drop: number | null = null;
    if (direction && lengthXZ(direction) > 1e-5) {
      const position = this.physics.getPosition();
      const feetY = position.y - this.heightFor(this.stanceValue) * 0.5;
      const distance = this.config.radius + this.config.ledgeProbeDistance;
      const from = {
        x: position.x + direction.x * distance,
        y: feetY + this.config.stepSkin,
        z: position.z + direction.z * distance,
      };
      const to = { x: from.x, y: from.y - this.config.ledgeProbeDepth, z: from.z };
      const hit = physicsRaycast(this.world, from, to);
      if (!hit.hasHit) {
        nearLedge = true;
      } else if (hit.hitNormal.y >= this.physics.maxSlopeCosine) {
        drop = Math.max(0, feetY - hit.hitPoint.y);
        nearLedge = drop >= this.config.ledgeMinDrop;
      } else {
        nearLedge = true;
      }
    }
    if (nearLedge !== this.nearLedgeValue) {
      this.events.emit(nearLedge ? "ledgeEntered" : "ledgeExited", nearLedge ? { drop } : undefined);
    }
    this.nearLedgeValue = nearLedge;
    this.ledgeDropValue = nearLedge ? drop : null;
  }

  private hasExpansionClearance(oldHeight: number, newHeight: number, radius: number): boolean {
    const extraHeight = newHeight - oldHeight;
    if (extraHeight <= 0) return true;
    const position = this.physics.getPosition();
    const currentTop = position.y + oldHeight * 0.5;
    const startY = currentTop + this.config.clearanceSkin;
    const endY = currentTop + extraHeight + this.config.clearanceSkin;
    const radial = radius * 0.72;
    const offsets: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [radial, 0],
      [-radial, 0],
      [0, radial],
      [0, -radial],
    ];
    return offsets.every(([x, z]) => {
      const hit = physicsRaycast(
        this.world,
        { x: position.x + x, y: startY, z: position.z + z },
        { x: position.x + x, y: endY, z: position.z + z },
      );
      return !hit.hasHit;
    });
  }

  private updateStance(crouchRequested: boolean): void {
    const requested: CharacterStance = crouchRequested ? "crouching" : "standing";
    if (requested === this.stanceValue) return;

    const oldHeight = this.heightFor(this.stanceValue);
    const newHeight = this.heightFor(requested);
    if (newHeight > oldHeight) {
      const clear = this.clearanceTest
        ? this.clearanceTest(oldHeight, newHeight, this.config.radius)
        : this.hasExpansionClearance(oldHeight, newHeight, this.config.radius);
      if (!clear) return;
    }

    resizeCharacterCapsule(this.physics, oldHeight, newHeight, this.config.radius);
    this.stanceValue = requested;
    this.groundedValue = false;
    this.events.emit("stanceChanged", { stance: requested });
  }

  private heightFor(stance: CharacterStance): number {
    return stance === "standing" ? this.config.standingHeight : this.config.crouchingHeight;
  }

  private modeSpeed(sprint: boolean): number {
    if (this.stanceValue === "crouching") {
      return sprint ? this.config.crouchSprintSpeed : this.config.crouchSpeed;
    }
    return sprint ? this.config.sprintSpeed : this.config.walkSpeed;
  }

  private followAnimatedSupport(): void {
    const body = this.groundedValue ? getAnimatedSupportBody(this.physics) : undefined;
    if (!body) {
      this.animatedSupportBody = undefined;
      this.animatedSupportPosition = undefined;
      this.animatedSupportRotation = undefined;
      return;
    }

    const nodePosition = body.node.position;
    const currentSupportPosition = copyVec3(nodePosition);
    const nodeRotation = body.node.rotationQuaternion;
    const currentSupportRotation = {
      x: nodeRotation.x,
      y: nodeRotation.y,
      z: nodeRotation.z,
      w: nodeRotation.w,
    };
    if (
      body === this.animatedSupportBody &&
      this.animatedSupportPosition &&
      this.animatedSupportRotation
    ) {
      const position = this.physics.getPosition();
      const previousRotation = this.animatedSupportRotation;
      const deltaRotation = multiplyQuat(currentSupportRotation, {
        x: -previousRotation.x,
        y: -previousRotation.y,
        z: -previousRotation.z,
        w: previousRotation.w,
      });
      const relative = {
        x: position.x - this.animatedSupportPosition.x,
        y: position.y - this.animatedSupportPosition.y,
        z: position.z - this.animatedSupportPosition.z,
      };
      const rotated = rotateByQuat(relative, deltaRotation);
      const supportYawDelta = yawFromQuat(deltaRotation);
      this.supportYawDeltaValue = supportYawDelta;
      this.facingYawValue = wrapAngle(this.facingYawValue + supportYawDelta);
      this.physics.setPosition({
        x: currentSupportPosition.x + rotated.x,
        y: currentSupportPosition.y + rotated.y,
        z: currentSupportPosition.z + rotated.z,
      });
    }
    this.animatedSupportBody = body;
    this.animatedSupportPosition = currentSupportPosition;
    this.animatedSupportRotation = currentSupportRotation;
  }

  private applyPhysicsConfig(): void {
    this.physics.maxSlopeCosine = Math.cos((this.config.maxSlopeDegrees * Math.PI) / 180);
    this.physics.maxAcceleration = this.config.groundAcceleration;
    this.physics.acceleration = 1;
    this.physics.characterStrength = this.config.characterStrength;
    this.physics.characterMass = this.config.characterMass;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("LiteCharacterController has been disposed");
  }
}

function multiplyQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function rotateByQuat(vector: Vec3, rotation: Quat): Vec3 {
  const qVector = { x: rotation.x, y: rotation.y, z: rotation.z };
  const tx = 2 * (qVector.y * vector.z - qVector.z * vector.y);
  const ty = 2 * (qVector.z * vector.x - qVector.x * vector.z);
  const tz = 2 * (qVector.x * vector.y - qVector.y * vector.x);
  return {
    x: vector.x + rotation.w * tx + qVector.y * tz - qVector.z * ty,
    y: vector.y + rotation.w * ty + qVector.z * tx - qVector.x * tz,
    z: vector.z + rotation.w * tz + qVector.x * ty - qVector.y * tx,
  };
}

function yawFromQuat(rotation: Quat): number {
  return Math.atan2(
    2 * (rotation.w * rotation.y + rotation.x * rotation.z),
    1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z),
  );
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
