import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config";

describe("resolveConfig", () => {
  it("merges valid overrides", () => {
    expect(resolveConfig({ jumpSpeed: 12 }).jumpSpeed).toBe(12);
  });

  it("rejects a capsule shorter than its diameter", () => {
    expect(() => resolveConfig({ radius: 0.5, crouchingHeight: 0.9 })).toThrow(/twice/);
  });

  it("rejects invalid slope angles", () => {
    expect(() => resolveConfig({ maxSlopeDegrees: 90 })).toThrow(/between/);
  });

  it("rejects negative character strength", () => {
    expect(() => resolveConfig({ characterStrength: -1 })).toThrow(/invalid/);
  });
});
