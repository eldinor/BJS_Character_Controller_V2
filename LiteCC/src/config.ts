import type { LiteCCConfig } from "./types";

export const DEFAULT_LITE_CC_CONFIG: Readonly<LiteCCConfig> = Object.freeze({
  standingHeight: 1.8,
  crouchingHeight: 1.15,
  radius: 0.35,
  gravity: 22,
  jumpSpeed: 9.5,
  groundAcceleration: 45,
  groundBraking: 60,
  airAcceleration: 12,
  walkSpeed: 2.5,
  sprintSpeed: 5,
  crouchSpeed: 1.8,
  crouchSprintSpeed: 3,
  turnSpeed: 12,
  maxSlopeDegrees: 50,
  coyoteTime: 0.12,
  jumpBufferTime: 0.12,
  terminalVelocity: 25,
  characterStrength: 20,
  characterMass: 1,
  maxStepHeight: 0.42,
  stepProbeDistance: 0.45,
  stepSkin: 0.025,
  clearanceSkin: 0.04,
  groundSnapDistance: 0.3,
  ledgeProbeDistance: 0.2,
  ledgeProbeDepth: 3,
  ledgeMinDrop: 0.5,
  fallingAirControlMultiplier: 0.55,
});

export function resolveConfig(config: Partial<LiteCCConfig> = {}): LiteCCConfig {
  const result = { ...DEFAULT_LITE_CC_CONFIG, ...config };

  if (result.radius <= 0) throw new RangeError("radius must be greater than zero");
  if (result.crouchingHeight < result.radius * 2) {
    throw new RangeError("crouchingHeight must be at least twice the capsule radius");
  }
  if (result.standingHeight < result.crouchingHeight) {
    throw new RangeError("standingHeight must be greater than or equal to crouchingHeight");
  }
  if (result.maxSlopeDegrees <= 0 || result.maxSlopeDegrees >= 90) {
    throw new RangeError("maxSlopeDegrees must be between 0 and 90");
  }
  if (
    result.walkSpeed < 0 ||
    result.sprintSpeed < 0 ||
    result.crouchSpeed < 0 ||
    result.crouchSprintSpeed < 0 ||
    result.groundAcceleration <= 0 ||
    result.groundBraking <= 0 ||
    result.airAcceleration < 0 ||
    result.turnSpeed < 0 ||
    result.characterStrength < 0 ||
    result.characterMass < 0
  ) {
    throw new RangeError("Movement speeds and acceleration values are invalid");
  }
  if (
    result.maxStepHeight < 0 ||
    result.stepProbeDistance < 0 ||
    result.stepSkin < 0 ||
    result.clearanceSkin < 0 ||
    result.groundSnapDistance < 0
    || result.ledgeProbeDistance < 0
    || result.ledgeProbeDepth <= 0
    || result.ledgeMinDrop < 0
    || result.fallingAirControlMultiplier < 0
    || result.fallingAirControlMultiplier > 1
  ) {
    throw new RangeError("Probe and step configuration values cannot be negative");
  }

  return result;
}
