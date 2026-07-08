import { physicsRaycast, type ArcRotateCamera, type PhysicsWorld, type Vec3 } from "@babylonjs/lite";
import type { LiteCCSnapshot } from "./types";

export type LiteCameraMode = "thirdPerson" | "firstPerson";

export interface LiteFollowCameraConfig {
  targetHeight: number;
  horizontalDamping: number;
  verticalDamping: number;
  lookAheadDistance: number;
  lookAheadSpeed: number;
  collisionPadding: number;
  collisionStartOffset: number;
  minimumRadius: number;
  collisionDamping: number;
  recoveryDamping: number;
  firstPersonRadius: number;
  firstPersonStandingEyeHeight: number;
  firstPersonCrouchingEyeHeight: number;
  firstPersonNearPlane: number;
  modeTransitionDamping: number;
  firstPersonTargetDamping: number;
}

export const DEFAULT_LITE_FOLLOW_CAMERA_CONFIG: Readonly<LiteFollowCameraConfig> = Object.freeze({
  targetHeight: 0.35,
  horizontalDamping: 14,
  verticalDamping: 8,
  lookAheadDistance: 0.8,
  lookAheadSpeed: 5,
  collisionPadding: 0.2,
  collisionStartOffset: 0.55,
  minimumRadius: 1.2,
  collisionDamping: 15,
  recoveryDamping: 7,
  firstPersonRadius: 0.05,
  firstPersonStandingEyeHeight: 0.65,
  firstPersonCrouchingEyeHeight: 0.35,
  firstPersonNearPlane: 0.03,
  modeTransitionDamping: 10,
  firstPersonTargetDamping: 60,
});

export class LiteFollowCamera {
  readonly config: LiteFollowCameraConfig;
  private desiredRadius: number;
  private lastAppliedRadius: number;
  private obstructedValue = false;
  private modeValue: LiteCameraMode = "thirdPerson";
  private modeBlendValue = 0;
  private readonly thirdPersonNearPlane: number;

  constructor(
    readonly camera: ArcRotateCamera,
    readonly world: PhysicsWorld,
    config: Partial<LiteFollowCameraConfig> = {},
  ) {
    this.config = { ...DEFAULT_LITE_FOLLOW_CAMERA_CONFIG, ...config };
    this.desiredRadius = camera.radius;
    this.lastAppliedRadius = camera.radius;
    this.thirdPersonNearPlane = camera.nearPlane;
  }

  get obstructed(): boolean {
    return this.obstructedValue;
  }

  get requestedRadius(): number {
    return this.desiredRadius;
  }

  get mode(): LiteCameraMode {
    return this.modeValue;
  }

  get firstPersonBlend(): number {
    return this.modeBlendValue;
  }

  setMode(mode: LiteCameraMode): void {
    if (mode === this.modeValue) return;
    if (mode === "firstPerson") this.desiredRadius = this.camera.radius;
    this.modeValue = mode;
  }

  toggleMode(): LiteCameraMode {
    const mode = this.modeValue === "thirdPerson" ? "firstPerson" : "thirdPerson";
    this.setMode(mode);
    return mode;
  }

  update(deltaSeconds: number, character: LiteCCSnapshot): void {
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.1);
    if (dt <= 0) return;

    // A radius change not made by this class came from wheel/touch controls.
    if (this.modeValue === "thirdPerson" && Math.abs(this.camera.radius - this.lastAppliedRadius) > 1e-5) {
      this.desiredRadius = this.camera.radius;
    }

    const targetBlend = this.modeValue === "firstPerson" ? 1 : 0;
    this.modeBlendValue += (targetBlend - this.modeBlendValue) * damp(this.config.modeTransitionDamping, dt);
    this.camera.nearPlane = lerp(this.thirdPersonNearPlane, this.config.firstPersonNearPlane, this.modeBlendValue);
    // ArcRotate alpha turns opposite to character yaw. Applying only the
    // support delta preserves any manual first-person look offset.
    this.camera.alpha -= character.supportYawDelta * this.modeBlendValue;

    const speed = character.horizontalSpeed;
    const lookScale = Math.min(1, speed / Math.max(this.config.lookAheadSpeed, 1e-5));
    const lookDistance = this.config.lookAheadDistance * lookScale * (1 - this.modeBlendValue);
    const lookX = speed > 1e-5 ? character.velocity.x / speed * lookDistance : 0;
    const lookZ = speed > 1e-5 ? character.velocity.z / speed * lookDistance : 0;
    const direction = orbitDirection(this.camera.alpha, this.camera.beta);
    const eyeHeight = character.stance === "crouching"
      ? this.config.firstPersonCrouchingEyeHeight
      : this.config.firstPersonStandingEyeHeight;
    const thirdPersonTarget = {
      x: character.position.x + lookX,
      y: character.position.y + this.config.targetHeight,
      z: character.position.z + lookZ,
    };
    // ArcRotate's eye is target + radius * orbitDirection. Offset its target
    // backward so the actual first-person eye remains exactly on the capsule.
    const firstPersonTarget = {
      x: character.position.x - direction.x * this.camera.radius,
      y: character.position.y + eyeHeight - direction.y * this.camera.radius,
      z: character.position.z - direction.z * this.camera.radius,
    };
    const desiredTarget = this.modeBlendValue > 0.99
      ? firstPersonTarget
      : {
          x: lerp(thirdPersonTarget.x, firstPersonTarget.x, this.modeBlendValue),
          y: lerp(thirdPersonTarget.y, firstPersonTarget.y, this.modeBlendValue),
          z: lerp(thirdPersonTarget.z, firstPersonTarget.z, this.modeBlendValue),
        };
    if (this.modeBlendValue > 0.99) {
      this.camera.target.x = desiredTarget.x;
      this.camera.target.y = desiredTarget.y;
      this.camera.target.z = desiredTarget.z;
    } else {
      const horizontalRate = lerp(this.config.horizontalDamping, this.config.firstPersonTargetDamping, this.modeBlendValue);
      const verticalRate = lerp(this.config.verticalDamping, this.config.firstPersonTargetDamping, this.modeBlendValue);
      const horizontalFollow = damp(horizontalRate, dt);
      const verticalFollow = damp(verticalRate, dt);
      this.camera.target.x += (desiredTarget.x - this.camera.target.x) * horizontalFollow;
      this.camera.target.y += (desiredTarget.y - this.camera.target.y) * verticalFollow;
      this.camera.target.z += (desiredTarget.z - this.camera.target.z) * horizontalFollow;
    }

    let thirdPersonRadius = this.desiredRadius;
    this.obstructedValue = false;
    if (this.modeBlendValue < 0.99) {
      const rayStart = addScaled(this.camera.target, direction, this.config.collisionStartOffset);
      const rayEnd = addScaled(this.camera.target, direction, this.desiredRadius);
      const hit = physicsRaycast(this.world, rayStart, rayEnd);
      this.obstructedValue = hit.hasHit;
      if (hit.hasHit) {
        const hitDistance = distance(this.camera.target, hit.hitPoint);
        thirdPersonRadius = Math.max(this.config.minimumRadius, hitDistance - this.config.collisionPadding);
      }
    }
    const targetRadius = lerp(thirdPersonRadius, this.config.firstPersonRadius, this.modeBlendValue);
    const rate = this.obstructedValue ? this.config.collisionDamping : this.config.recoveryDamping;
    this.camera.radius += (targetRadius - this.camera.radius) * damp(rate, dt);
    this.lastAppliedRadius = this.camera.radius;
    if (this.modeBlendValue > 0.99) {
      this.camera.target.x = character.position.x - direction.x * this.camera.radius;
      this.camera.target.y = character.position.y + eyeHeight - direction.y * this.camera.radius;
      this.camera.target.z = character.position.z - direction.z * this.camera.radius;
    }
  }
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-Math.max(0, rate) * dt);
}

function orbitDirection(alpha: number, beta: number): Vec3 {
  const sinBeta = Math.sin(beta);
  return {
    x: Math.cos(alpha) * sinBeta,
    y: Math.cos(beta),
    z: Math.sin(alpha) * sinBeta,
  };
}

function addScaled(origin: Vec3, direction: Vec3, scale: number): Vec3 {
  return {
    x: origin.x + direction.x * scale,
    y: origin.y + direction.y * scale,
    z: origin.z + direction.z * scale,
  };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
