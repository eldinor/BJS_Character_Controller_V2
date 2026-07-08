import type { Vec3 } from "@babylonjs/lite";

export function lengthXZ(value: Vec3): number {
  return Math.hypot(value.x, value.z);
}

export function normalizedXZ(value: Vec3): Vec3 {
  const length = lengthXZ(value);
  return length > 1e-6
    ? { x: value.x / length, y: 0, z: value.z / length }
    : { x: 0, y: 0, z: 0 };
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

export function copyVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

export function moveTowardsAngle(current: number, target: number, maxDelta: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + Math.max(-maxDelta, Math.min(maxDelta, delta));
}
