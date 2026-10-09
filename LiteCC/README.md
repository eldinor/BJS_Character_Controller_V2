# LiteCC

LiteCC is a new character controller for Babylon Lite and Havok. It is not a compatibility port of the original Babylon.js controller.

## Requirements

- `@babylonjs/lite` exactly `1.8.0`
- `@babylonjs/havok` exactly `1.3.13`
- WebGPU
- A Vite/ES module application

The exact Lite version is intentional: stance resizing uses a small, guarded adapter around Lite 1.8.0 internals because its public `PhysicsCharacterController` API cannot resize a capsule yet.

## Current features

- Lite `PhysicsCharacterController` motor
- Havok support classification and slope sliding
- Moving-surface velocity support
- Translating, vertical, and rotating animated-platform attachment for Lite 1.8.0
- Configurable stair stepping with walkable-top validation
- Ground and air acceleration
- Separate acceleration and braking tuning
- Camera-relative input helper and smooth facing yaw
- Walk, sprint, crouch and crouch-sprint speed modes
- Jump buffering and coyote time
- Terminal velocity
- External impulses and teleporting
- Configurable dynamic-body pushing through `characterStrength` and `characterMass`
- Standing/crouching capsule resizing
- Feet-preserving stance changes
- Built-in five-ray standing-clearance test with optional override
- Descending-step ground snap
- Forward ledge detection with measured drop depth
- Falling state/time and reduced falling air control
- Land, jump and stance events
- Explicit lifecycle and immutable state snapshots

## Installation

```bash
npm install @babylonjs/lite@1.8.0 @babylonjs/havok@1.3.13
npm install ./LiteCC
```

## Basic usage

```ts
import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import {
  createEngine,
  createHavokWorld,
  createSceneContext,
  onPhysicsAfterStep,
} from "@babylonjs/lite";
import { LiteCharacterController, cameraRelativeMove } from "@bjs-cc/litecc";

const engine = await createEngine(canvas);
const scene = createSceneContext(engine);
const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });

const character = new LiteCharacterController(world, { x: 0, y: 2, z: 0 });

character.setClearanceTest((_oldHeight, _newHeight, _radius) => {
  // Perform application-specific ceiling queries here.
  return true;
});

let input = {
  move: cameraRelativeMove(rawX, rawZ, camera.alpha),
  sprint: false,
  jumpPressed: false,
  crouch: false,
};

onPhysicsAfterStep(world, (dt) => {
  const snapshot = character.step(dt, input);
  visualRoot.position.copyFrom(snapshot.position);

  // jumpPressed is edge-triggered.
  input = { ...input, jumpPressed: false };
});
```

## Stance safety

Shrinking to crouch is immediate. Expansion back to standing is refused unless a clearance test is installed and returns `true`:

```ts
character.setClearanceTest((oldHeight, newHeight, radius) => {
  const extraHeadroom = newHeight - oldHeight;
  return capsuleHeadroomIsClear(extraHeadroom, radius);
});
```

Keep all use of Babylon Lite private fields inside `src/lite-internals.ts`. When Lite exposes official capsule resizing, replace that adapter without changing the public LiteCC API.

## Development

```bash
npm install
npm run demo
npm run build:demo
npm run preview:demo
npm run typecheck
npm test
npm run build
```

Open the URL printed by Vite (normally `http://localhost:5173`). The playground includes stairs, low ceilings, walkable and steep ramps, a moving platform, and pushable dynamic boxes. Use WASD to move, Shift to sprint, Space to jump, and C to crouch.

`build:demo` creates a standalone static playground in `demo-dist/`; `preview:demo` serves that production build locally.

The demo camera uses frame-rate-independent target damping: horizontal tracking is intentionally faster than vertical tracking so stair stepping remains responsive without camera bob.

`LiteFollowCamera` adds movement look-ahead, physics-ray obstacle avoidance, fast collision shortening, smooth radius recovery, and preserves user wheel/touch zoom changes.

It also blends between `thirdPerson` and `firstPerson` modes. First person uses stance-aware eye height, a smaller near plane, disables orbit collision shortening, and restores the previous third-person zoom when switched back:

```ts
followCamera.setMode("firstPerson");
followCamera.toggleMode();
```

The playground button or `V` key switches modes.

## Likely next modules

- Animation state and blend driver
- Optional touch/gamepad input
- Ledge handling and mantling
