# Character Controller Improvement Review

The controller is feature-rich, but several foundational issues should be addressed before adding more mechanics.

## Highest-priority improvements

### 1. Fix physics fallback propagation

`setupCharacter(..., usePhysics)` configures the capsule using `usePhysics`, but never passes that value into `CharCtrl`.

Near both `charOptions` construction paths in `js/character-controller.js`, add:

```js
charOptions.usePhysics = usePhysics;
```

Currently, failed Havok initialization can still make `CharCtrl` attempt to create a physics body because its constructor independently consults `localStorage`.

### 2. Add an explicit maximum walkable slope

Ground rays accept virtually any hit as grounded. Movement is then projected onto its normal without a configurable slope limit. This can cause wall-edge grounding, unrealistic climbing, and sticky steep surfaces.

Add parameters such as:

```js
MAX_SLOPE_ANGLE: 50,
STEP_HEIGHT: 0.45,
GROUND_PROBE_DISTANCE: 0.3
```

Reject ground contacts whose normal falls below `Math.cos(MAX_SLOPE_ANGLE)` and make the character slide on overly steep surfaces.

### 3. Improve grounding quality

`_checkGrounded()` fires up to five mesh raycasts every frame, stops at the first hit, and uses only that hit's normal.

Recommended changes:

- Select the closest or best walkable hit across all probes.
- Average compatible normals around the capsule.
- Prefer a capsule or sphere shape cast if supported.
- Use physics contacts for Havok grounding, with rays as fallback.
- Use time-based coyote grounding instead of a two-frame counter.

Frame-based grounding behaves differently at 30, 60, and 144 FPS.

### 4. Fix lifecycle leaks

`destroy()` removes many resources correctly, but misses some:

- The pointer observer added for camera tilt is never stored or removed.
- Camera-target callbacks registered by `setupCharacter()` cannot be unregistered.
- `_rollTimeoutId`, landing timers, touch initialization, and animation-frame polling can survive destruction.
- `destroy()` does not call `anim.destroy()`.
- Delayed callbacks may mutate disposed meshes.

Use stored observable handles and a controller-owned cleanup collection. All timers and animation-frame handles should be cancelled during destruction.

### 5. Make Havok gravity configuration consistent

`GRAV` controls kinematic falling, while Havok gravity comes from `initPhysics(scene, gravity)`. Changing `config.GRAV` therefore does not change physics-mode gravity.

Use one authoritative configuration source, or clearly split the settings:

```js
WORLD_GRAVITY
KINEMATIC_GRAVITY
```

## Movement-quality improvements

- Add coyote time and jump buffering.
- Make air control a numeric coefficient instead of a boolean.
- Preserve configurable horizontal momentum through jumps and air dashes.
- Replace hardcoded step velocities with capsule-scaled step resolution.
- Add separate acceleration curves for ground, air, turning, and braking.
- Add moving-platform velocity inheritance.
- Support external impulses and knockback without overwriting them on the next frame.
- Use the configured spawn point or checkpoint for out-of-bounds recovery instead of hardcoded coordinates.
- Clamp long frame times or substep movement instead of skipping the entire update when `dt > 0.1`.

## Architecture and performance

The controller currently combines the following responsibilities in one file:

- Input
- Camera control
- Physics
- Collision probes
- Animation state
- Particles
- HUD updates
- Touch UI
- Character loading and retargeting

Consider splitting it into focused components:

```text
CharacterController
|-- CharacterMotor
|-- GroundProbe
|-- InputSource
|-- CharacterStateMachine
|-- CameraRig
|-- AnimationDriver
`-- PresentationEffects
```

There is also considerable per-frame allocation from vectors, rays, predicate closures, and DOM lookups. Cache temporary vectors, rays, collision predicates, and HUD elements. Throttle FPS and HUD updates to approximately 5-10 Hz.

## Testing gap

`npm test` currently has no test suite, and the scratch scripts test autorigging rather than locomotion.

The controller needs automated scenarios for:

- Physics fallback
- Jump apex and landing
- Coyote time and jump buffering
- Slope limits
- Stairs at multiple frame rates
- Ceiling and uncrouching behavior
- Ledge departure
- Moving platforms
- Destruction and recreation without duplicated listeners

The controller file passes `node --check`, so no basic JavaScript syntax errors were found.

## Recommended implementation order

1. Correct `usePhysics` propagation.
2. Make controller destruction fully clean and repeatable.
3. Add maximum slope and step-height configuration.
4. Improve grounding and replace frame-based grace periods with time-based values.
5. Add a small deterministic locomotion test harness.
6. Separate gameplay mechanics from camera, UI, and effects.

