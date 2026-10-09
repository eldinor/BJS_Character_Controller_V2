import type { Vec3 } from "@babylonjs/lite";
import { normalizedXZ } from "./math";

/** Convert local strafe/forward input into a world-space direction using ArcRotateCamera alpha. */
export function cameraRelativeMove(inputX: number, inputZ: number, cameraAlpha: number): Vec3 {
  const forwardX = -Math.cos(cameraAlpha);
  const forwardZ = -Math.sin(cameraAlpha);
  const rightX = -Math.sin(cameraAlpha);
  const rightZ = Math.cos(cameraAlpha);
  return normalizedXZ({
    x: rightX * inputX + forwardX * inputZ,
    y: 0,
    z: rightZ * inputX + forwardZ * inputZ,
  });
}
