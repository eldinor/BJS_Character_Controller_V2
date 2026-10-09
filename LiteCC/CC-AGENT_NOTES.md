# LiteCC: notes for coding agents

This document describes the current source implementation, including the local stair-probing changes. Keep it with the `LiteCC` folder when copying the controller into another application. Paths below are relative to that folder. Read the source before changing behavior; this document is a guide, not an alternate specification.

## Purpose and dependencies

LiteCC is a capsule character motor for **Babylon Lite + Havok**. It wraps Lite's `PhysicsCharacterController` and adds locomotion, stance changes, steps, ground snapping, ledge information, and platform attachment. It does not create an application, character mesh, skeleton, input bindings, or level colliders.

- Required peer versions: `@babylonjs/lite` **1.8.0**, `@babylonjs/havok` **1.3.13**.
- The rendering demos require WebGPU. The package is ES modules; Vite is the provided build tool.
- Capsule resizing and animated support detection depend on guarded private Lite internals. Do not upgrade Lite without reviewing `src/lite-internals.ts` and running the Havok regressions.
- This implementation is separate from the older controller elsewhere in the parent repository. Integrations should use the exports in `src/index.ts`.

## Source map

| File | Responsibility |
| --- | --- |
| `src/character-controller.ts` | Motor, physics-step orchestration, probes, platform attachment, lifecycle |
| `src/types.ts` | Input, configuration, snapshots, events, clearance callback |
| `src/config.ts` | Defaults and configuration validation |
| `src/lite-internals.ts` | All access to private Lite controller fields; capsule replacement and contact reset |
| `src/input.ts` | ArcRotate camera-relative movement conversion |
| `src/follow-camera.ts` | Optional first/third-person camera helper |
| `src/events.ts`, `src/math.ts` | Event bus and movement math |
| `src/character-controller.havok.test.ts` | Headless real-Havok behavior regressions |

## Integration contract

The host app creates the engine, scene, Havok instance and physics world, and installs collision shapes on the level. Serve the Havok WASM with the app and configure Havok's `locateFile`; the local demos show Vite's `?url` import pattern.

Create `new LiteCharacterController(world, spawn, partialConfig)`. Positions are the **capsule centre**, with Y up. Capsule heights include both hemispheres. For a floor at `floorY`, a standing spawn is approximately `floorY + standingHeight / 2`, plus a small clearance. Distances and speeds are intended as metres and metres per second; angles use radians except `maxSlopeDegrees`.

Call `character.step(dt, input)` **exactly once per Havok step**, normally from `onPhysicsAfterStep`. `dt` is seconds; the motor caps it at 0.1 and ignores nonpositive/nonfinite values. Do not also integrate the underlying controller or drive its position from a render callback.

```ts
import { onPhysicsAfterStep } from "@babylonjs/lite";
import { LiteCharacterController, cameraRelativeMove } from "@bjs-cc/litecc";

// world, camera, visualRoot and inputState are owned by the host app.
const character = new LiteCharacterController(world, { x: 0, y: 2, z: 0 });
onPhysicsAfterStep(world, (dt) => {
  const state = character.step(dt, {
    move: cameraRelativeMove(inputState.x, inputState.z, camera.alpha),
    sprint: inputState.sprint,
    crouch: inputState.crouch,
    jumpPressed: inputState.jumpQueued,
  });
  inputState.jumpQueued = false;
  visualRoot.position.copyFrom(state.position);
  visualRoot.rotation.y = state.facingYaw;
});
```

`move` is a world-space horizontal direction, normalized by the motor. Its magnitude does not provide analog speed; use the optional `speed` override for that. Sprint/crouch are held requests. Jump is edge-triggered: queue it from input and consume it once at the next physics tick. A held jump flag repeatedly refreshes the buffer.

The visual root should represent the capsule centre or apply an explicit model-origin offset. Adapt visuals/animation to the returned stance; resizing physics does not resize the rendered mesh. Facing yaw zero points toward +Z. Use snapshots to drive animation, not visual movement to drive physics.

During teardown, remove the physics callback using the host's callback lifecycle API, then call `character.dispose()` before disposing the world. Dispose is idempotent and clears controller events. The camera and scene remain host-owned.

## What happens in a physics tick

1. Resolve stance and update jump-buffer time.
2. Ask Havok for support: supported, sliding, or unsupported. Probe ahead for ledges.
3. If support was just lost while descending, attempt a short snap onto a flat stair top, provided no ledge or buffered jump blocks it.
4. Apply the supporting animated platform's transform delta.
5. Update coyote time, choose locomotion speed, repay stair movement debt, and turn toward the requested movement direction.
6. When grounded and moving, attempt a step up.
7. Compute ground movement through Havok's `calculateMovement`, including surface normal and velocity. In air, move X/Z velocity toward the target with limited acceleration; descending has reduced control.
8. Apply buffered/coyote jump or gravity with terminal velocity, update falling information, set velocity, and call Havok `integrate`.
9. Emit transitions and return a snapshot.

Ordering matters. Probe corrections, support classification, platform attachment and integration cooperate; avoid casually moving these operations or replacing Havok movement with mesh translation.

## Steps, slopes and ledges

Step-up uses three lanes: centre, then offsets of `+/- radius * 0.65` across the movement direction. Each lane needs a low wall-like obstruction, a clear high ray, and a downward hit on a walkable top within `maxStepHeight`. Walkable ramp hits are left to Havok's slope solver.

An accepted step lifts the centre by the rise plus skin and advances only by the detected edge distance plus margins, capped by `stepProbeDistance`. It resets cached contacts and emits `stepped`. That advance becomes movement debt, repaid from later movement budgets at up to 65% per tick. Preserve this mechanism: repeated full-distance advances can accelerate a character on dense stairs, while consuming the whole movement budget can stall it.

Snap-down is limited to walkable, nearly flat tops (`normal.y >= 0.98`) within `groundSnapDistance`. Continuous downhill slopes stay with Havok to avoid vertical chatter.

Ledge detection casts downward ahead of the capsule in the requested movement direction while grounded or just leaving ground. It reports a sufficiently large drop, no floor, or a nonwalkable surface. It is informational and suppresses inappropriate snapping; it does not stop movement, grab ledges, or mantle. `ledgeDrop` may be null when no walkable landing depth is known.

These probes are ray samples, not full capsule sweeps. When investigating authored geometry failures, inspect collider dimensions, seams and hit normals before increasing global allowances.

## Crouching and private adapter

Crouching shrinks immediately. Standing checks five upward rays by default: centre and four radial offsets. `setClearanceTest(callback)` **replaces** that built-in test; the callback must really verify headroom. Passing `undefined` restores the default.

`resizeCharacterCapsule` builds a replacement Havok capsule, assigns it to the existing body, shifts the centre by half the height difference to preserve feet, clears cached contacts, and releases the old shape. Keep private-field access in `src/lite-internals.ts`.

The README's claim that standing requires an installed clearance callback is outdated: current source provides the built-in test. Do not install an unconditional `return true` callback in a real level.

## Moving platforms

Havok's movement solver handles reported support velocity. Lite 1.8.0 currently reports zero support velocity for animated contacts, so the adapter finds the supporting animated body in the contact manifold. The motor carries the capsule using consecutive node position/quaternion deltas, including rotation around the platform, and adds the support's yaw delta to facing.

Create moving platforms with animated motion type and the appropriate prestep behavior, as shown in the demos (`PhysicsMotionType.ANIMATED`, `PhysicsPrestepType.ACTION`). Keep their node transforms synchronized with physics. Do not separately translate the character by the same platform delta. `supportYawDelta` lets the camera inherit rotation without overriding manual look.

## Public state and lifecycle

Snapshots contain copied position/velocity, grounded/sliding flags, stance, facing yaw, horizontal speed, ledge/drop information, falling/time, and support yaw delta. Types are readonly; objects are not runtime-frozen. Treat them as observations rather than commands.

Events: `landed`, `jumped`, `stanceChanged`, `stepped`, `snappedDown`, `ledgeEntered`, `ledgeExited`, `fallStarted`. See `src/types.ts` for payloads. `landed.velocity` is the previous vertical velocity.

`addImpulse` adds directly to velocity (a velocity change, despite the name). An upward impulse clears grounding/coyote time. `teleport(position, preserveVelocity = false)` sets the centre and normally zeroes velocity; it resets grounding, sliding, coyote time and movement debt. It does not reset every timer or cached support field. Review those details if implementing respawn semantics.

## Optional camera

`LiteFollowCamera` wraps a host-owned ArcRotate camera. Call `update(dt, snapshot)` once for each chosen camera update; demos call it after the motor in the physics callback. It provides separate horizontal/vertical target damping, velocity look-ahead, a single physics-ray obstacle check, radius recovery, and wheel/touch zoom tracking.

`setMode("firstPerson")` and `toggleMode()` blend radius, target and near plane toward a stance-aware eye position. Hide the character visual as the blend approaches first person; demos use `firstPersonBlend < 0.8` for visibility. Custom capsule heights may need custom eye-height offsets, which are relative to the capsule centre. Camera collision uses physics colliders, not arbitrary visible meshes.

## Copying, building and checking changes

For a local package inside another Lite app, keep `src/`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, and `vite.config.ts`; retain license/documentation too. Keep test files and `vitest.config.ts` if continuing controller development. Do not copy `node_modules`; install dependencies in the destination.

Run `npm install` and `npm run build` in this folder, then install it from the host app with `npm install ./packages/LiteCC` (adjust path). Import `@bjs-cc/litecc`. Package exports point to `dist`, so rebuild after source edits. The build emits `dist/litecc.js` and declarations and leaves Babylon dependencies external. Check the host resolves the same Lite instance/version.

For controller code changes, use the relevant Havok regressions and run `npm run typecheck`, `npm test`, and `npm run build`. Tests use the installed Havok WASM and Lite null engine. Important cases include stairs, off-centre risers, slopes, stance clearance, and moving platforms. Check demos when visual or camera behavior changes.

`demo/lite-pg.ts` imports a remote bundle from `ForBJS/master` via jsDelivr. It does **not** exercise local source edits until that remote bundle is rebuilt and updated. Use local-import demos/tests to validate local controller changes. `npm run build:demo` packages the demo pages separately from the library.
