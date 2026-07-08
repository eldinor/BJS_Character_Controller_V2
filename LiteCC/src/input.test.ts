import { describe, expect, it } from "vitest";
import { cameraRelativeMove } from "./input";

describe("cameraRelativeMove", () => {
  it("maps forward using the orbit camera heading", () => {
    const move = cameraRelativeMove(0, 1, -Math.PI / 2);
    expect(move.x).toBeCloseTo(0);
    expect(move.z).toBeCloseTo(1);
  });

  it("normalizes diagonal input", () => {
    const move = cameraRelativeMove(1, 1, 0);
    expect(Math.hypot(move.x, move.z)).toBeCloseTo(1);
  });
});
