import type { Vec3 } from "@babylonjs/lite";

export type CharacterStance = "standing" | "crouching";

export interface LiteCCInput {
  /** World-space horizontal movement direction. LiteCC normalizes this value. */
  move: Vec3;
  /** Desired speed in metres per second. */
  /** Optional explicit speed override. Defaults to the active locomotion mode. */
  speed?: number;
  /** Requests sprint speed. */
  sprint?: boolean;
  /** Edge-triggered jump request. */
  jumpPressed?: boolean;
  /** Requests the crouching stance while true. */
  crouch?: boolean;
}

export interface LiteCCConfig {
  standingHeight: number;
  crouchingHeight: number;
  radius: number;
  gravity: number;
  jumpSpeed: number;
  groundAcceleration: number;
  groundBraking: number;
  airAcceleration: number;
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  crouchSprintSpeed: number;
  turnSpeed: number;
  maxSlopeDegrees: number;
  coyoteTime: number;
  jumpBufferTime: number;
  terminalVelocity: number;
  characterStrength: number;
  characterMass: number;
  maxStepHeight: number;
  stepProbeDistance: number;
  stepSkin: number;
  clearanceSkin: number;
  groundSnapDistance: number;
  ledgeProbeDistance: number;
  ledgeProbeDepth: number;
  ledgeMinDrop: number;
  fallingAirControlMultiplier: number;
}

export interface LiteCCSnapshot {
  readonly position: Readonly<Vec3>;
  readonly velocity: Readonly<Vec3>;
  readonly grounded: boolean;
  readonly sliding: boolean;
  readonly stance: CharacterStance;
  readonly facingYaw: number;
  readonly horizontalSpeed: number;
  readonly nearLedge: boolean;
  readonly ledgeDrop: number | null;
  readonly falling: boolean;
  readonly fallTime: number;
  /** Yaw inherited from a rotating support during this step, in radians. */
  readonly supportYawDelta: number;
}

export interface LiteCCEvents {
  landed: { velocity: number };
  jumped: undefined;
  stanceChanged: { stance: CharacterStance };
  stepped: { height: number };
  snappedDown: { distance: number };
  ledgeEntered: { drop: number | null };
  ledgeExited: undefined;
  fallStarted: { fromLedge: boolean };
}

export type ClearanceTest = (
  currentHeight: number,
  requestedHeight: number,
  radius: number,
) => boolean;
