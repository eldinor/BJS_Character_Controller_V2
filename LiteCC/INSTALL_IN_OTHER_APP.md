# Install LiteCC in another Babylon Lite app

## Contents

The ZIP contains a `LiteCC/` folder with the current controller source, tests, freshly built `dist/` library, package manifest/lockfile, build/test configurations, license, and coding-agent notes. The build includes the local off-centre stair-probing fix. Demo pages/assets and `node_modules` are excluded.

Validated before packaging: TypeScript check, all 17 tests, and the library build.

## 1. Copy the folder

Extract `LiteCC/` into your application's `packages/` directory:

```text
your-app/
  package.json
  packages/
    LiteCC/
      package.json
      src/
      dist/
      CC-AGENT_NOTES.md
      INSTALL_IN_OTHER_APP.md
```

Use Node.js 20.19+ (or a supported newer release satisfying the included tooling's requirements) and npm. This package requires exactly `@babylonjs/lite@1.8.0` and `@babylonjs/havok@1.3.13`; keep the host app on those versions too.

## 2. Install in the host app

From the application's root directory:

```sh
npm install @babylonjs/lite@1.8.0 @babylonjs/havok@1.3.13
npm install ./packages/LiteCC
```

The supplied `dist/` is already built. Import the package by name:

```ts
import {
  LiteCharacterController,
  LiteFollowCamera,
  cameraRelativeMove,
} from "@bjs-cc/litecc";
```

Local-directory dependency behavior can vary with npm/workspace configuration. After rebuilding, confirm that the app resolves the updated `packages/LiteCC/dist/litecc.js`; reinstall the local dependency if it was copied rather than linked. Avoid duplicate Babylon Lite instances in the host bundle.

## 3. Initialize physics

For a Vite app, this is the Havok initialization pattern. Supply your app's canvas; if you already have a Havok world, reuse it rather than creating a second world.

```ts
import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import {
  createEngine,
  createSceneContext,
  createHavokWorld,
  onPhysicsAfterStep,
} from "@babylonjs/lite";
import { LiteCharacterController } from "@bjs-cc/litecc";

const engine = await createEngine(canvas);
const scene = createSceneContext(engine);
const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });
```

Vite projects using the `?url` import need Vite client types (normally `/// <reference types="vite/client" />` in the app's environment declaration file). Other bundlers should serve the WASM and provide its URL through their own asset mechanism. Babylon Lite rendering requires WebGPU.

## 4. Connect the controller

Add physics colliders to the floor, walls, stairs and other level geometry. A visible mesh alone is not a collider. Choose a spawn above a valid floor; the controller position is the capsule centre, not the feet. Defaults: standing height 1.8 m, crouching height 1.15 m, radius 0.35 m.

```ts
const character = new LiteCharacterController(world, { x: 0, y: 1, z: 0 });

// inputState and visualRoot are supplied by your app.
onPhysicsAfterStep(world, (dt) => {
  const state = character.step(dt, {
    move: inputState.worldDirection, // { x, y: 0, z }; normalized internally
    sprint: inputState.sprintHeld,
    crouch: inputState.crouchHeld,
    jumpPressed: inputState.jumpQueued,
  });
  inputState.jumpQueued = false;

  visualRoot.position.copyFrom(state.position);
  visualRoot.rotation.y = state.facingYaw;
  // Update model height/animation from state.stance and other snapshot fields.
});
```

Call `step` exactly once per physics step with seconds, not milliseconds. Queue jump on a button press and consume it once. To move relative to an ArcRotate camera, use `cameraRelativeMove(strafe, forward, camera.alpha)`. Use `speed` for an explicit speed override; input direction magnitude is normalized.

The app owns its rendering loop, lights, scene registration, input bindings, character mesh/animation and cleanup. Apply a model-origin offset if your model root is at its feet. Do not add a second physics motor to the visual or move the capsule independently every render frame.

Standing clearance is checked automatically. Only install `setClearanceTest` if you provide a real replacement headroom query. The README's older statement that a callback is required is outdated; see `CC-AGENT_NOTES.md`.

## 5. Optional follow camera

```ts
const followCamera = new LiteFollowCamera(camera, world);
// After character.step(), using the same dt and returned state:
followCamera.update(dt, state);

// From an input handler:
followCamera.toggleMode();
```

Hide the character visual as `firstPersonBlend` approaches 1. Camera controls/attachment are host-owned. Adjust eye-height settings when using custom capsule dimensions.

## 6. Cleanup and development

Unregister the app's physics callback when leaving the scene, then call `character.dispose()` before disposing the physics world. Clear input handlers through the app's lifecycle too.

To modify and rebuild the copied source:

```sh
cd packages/LiteCC
npm ci
npm run typecheck
npm test
npm run build
```

For a fixed distributable package instead of a local folder dependency, run `npm pack` here and install the generated `.tgz` in the host app. Rebuild before packing. Documentation remains in this copied folder; the npm package's file list includes `dist`, README and license.

Demo scripts in `package.json` refer to assets from the original repository and are not part of this source/library transfer. Use the host app to preview integration. Read `CC-AGENT_NOTES.md` before changing the physics algorithm or upgrading dependencies.
