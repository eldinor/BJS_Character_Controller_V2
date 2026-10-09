// @ts-ignore Lite PG loads Havok directly because the npm package is not in its type resolver.
import HavokPhysics from "https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.13/lib/esm/HavokPhysics_es.js";
import {
  PhysicsMotionType,
  PhysicsPrestepType,
  PhysicsShapeType,
  addToScene,
  attachControl,
  createArcRotateCamera,
  createBox,
  createCapsule,
  createEngine,
  createHavokWorld,
  createHemisphericLight,
  createPbrMaterial,
  createPhysicsAggregate,
  createSceneContext,
  onBeforeRender,
  onPhysicsAfterStep,
  registerScene,
  setCameraLimits,
  setPhysicsBodyMotionType,
  setPhysicsBodyPrestepType,
  setMeshVisible,
  startEngine,
  type EngineContext,
  type Mesh,
  type PhysicsWorld,
  type SceneContext,
} from "@babylonjs/lite";
// Same ForBJS/master file as the raw GitHub URL, served with a JavaScript MIME type.
// @ts-ignore Remote ESM is resolved by the Lite PG/browser, not local TypeScript.
import {
  LiteCharacterController,
  LiteFollowCamera,
  cameraRelativeMove,
} from "https://cdn.jsdelivr.net/gh/eldinor/ForBJS@master/litecc.js";

const havokWasmUrl = "https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.13/lib/esm/HavokPhysics.wasm";

const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas");
if (!canvas) throw new Error("#renderCanvas was not found.");

function createUi(): {
  stateOutput: HTMLOutputElement;
  errorOutput: HTMLDivElement;
  cameraModeButton: HTMLButtonElement;
} {
  const style = document.createElement("style");
  style.textContent = `
    .litecc-hud { position: fixed; right: 18px; bottom: 18px; z-index: 10; display: grid; gap: 5px; min-width: 255px; padding: 14px 16px; color: #e9f0ff; font-family: Inter, ui-sans-serif, system-ui, sans-serif; border: 1px solid #ffffff24; border-radius: 12px; background: #091020d9; box-shadow: 0 12px 32px #0008; backdrop-filter: blur(12px); pointer-events: none; }
    .litecc-hud strong { color: #7dd3fc; }
    .litecc-hud span { color: #b8c3da; font-size: 13px; }
    .litecc-hud output { margin-top: 5px; color: #86efac; font: 12px/1.5 ui-monospace, monospace; }
    .litecc-hud button { margin-top: 7px; padding: 8px 10px; color: #dff6ff; border: 1px solid #7dd3fc55; border-radius: 8px; background: #12304a; cursor: pointer; pointer-events: auto; }
    .litecc-hud button:hover { background: #194263; }
    .litecc-error { position: fixed; inset: 20px; z-index: 20; padding: 20px; color: #fecaca; font-family: ui-monospace, monospace; white-space: pre-wrap; border: 1px solid #ef4444; border-radius: 12px; background: #260b0bf2; }
  `;
  document.head.append(style);

  const hud = document.createElement("aside");
  hud.className = "litecc-hud";
  const addLabel = (text: string, emphasis = false) => {
    const element = document.createElement(emphasis ? "strong" : "span");
    element.textContent = text;
    hud.append(element);
  };
  addLabel("LiteCC — remote package test", true);
  addLabel("WASD · move   Shift · sprint");
  addLabel("Space · jump   C · crouch");
  addLabel("Green ramp walkable · red ramp steep");
  addLabel("Purple / cyan / gold platforms move");
  addLabel("Orange boxes are pushable");

  const cameraModeButton = document.createElement("button");
  cameraModeButton.type = "button";
  hud.append(cameraModeButton);
  const stateOutput = document.createElement("output");
  stateOutput.value = "loading…";
  hud.append(stateOutput);
  document.body.append(hud);

  const errorOutput = document.createElement("div");
  errorOutput.className = "litecc-error";
  errorOutput.hidden = true;
  document.body.append(errorOutput);
  return { stateOutput, errorOutput, cameraModeButton };
}

const { stateOutput, errorOutput, cameraModeButton } = createUi();

const keys = new Set<string>();
let jumpQueued = false;
window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (event.code === "Space" && !event.repeat) jumpQueued = true;
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());

function material(color: [number, number, number, number]) {
  return createPbrMaterial({ baseColorFactor: color, metallicFactor: 0, roughnessFactor: 0.82 });
}

function makeStaticBox(
  engine: EngineContext,
  scene: SceneContext,
  world: PhysicsWorld,
  position: [number, number, number],
  scale: [number, number, number],
  color: [number, number, number, number],
  name = "static-box",
  rotation: [number, number, number] = [0, 0, 0],
): Mesh {
  const mesh = createBox(engine, 1);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scaling.set(...scale);
  mesh.rotation.set(...rotation);
  mesh.material = material(color);
  addToScene(scene, mesh);
  createPhysicsAggregate(world, mesh, PhysicsShapeType.BOX, {
    mass: 0,
    friction: 0.8,
    extents: { x: scale[0], y: scale[1], z: scale[2] },
  });
  return mesh;
}

function makeDynamicBox(
  engine: EngineContext,
  scene: SceneContext,
  world: PhysicsWorld,
  position: [number, number, number],
): void {
  const mesh = createBox(engine, 1);
  mesh.position.set(...position);
  mesh.material = material([0.75, 0.38, 0.08, 1]);
  addToScene(scene, mesh);
  createPhysicsAggregate(world, mesh, PhysicsShapeType.BOX, {
    mass: 1.5,
    friction: 0.3,
    restitution: 0.05,
    extents: { x: 1, y: 1, z: 1 },
  });
}

function makeAnimatedPlatform(
  engine: EngineContext,
  scene: SceneContext,
  world: PhysicsWorld,
  position: [number, number, number],
  scale: [number, number, number],
  color: [number, number, number, number],
  name: string,
): Mesh {
  const mesh = createBox(engine, 1);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scaling.set(...scale);
  mesh.material = material(color);
  addToScene(scene, mesh);
  const aggregate = createPhysicsAggregate(world, mesh, PhysicsShapeType.BOX, {
    mass: 0,
    friction: 0.9,
    extents: { x: scale[0], y: scale[1], z: scale[2] },
  });
  setPhysicsBodyMotionType(world, aggregate.body, PhysicsMotionType.ANIMATED);
  setPhysicsBodyPrestepType(aggregate.body, PhysicsPrestepType.ACTION);
  return mesh;
}

async function main(): Promise<void> {
  if (!navigator.gpu) throw new Error("WebGPU is required for Babylon Lite.");

  const engine = await createEngine(canvas);
  const scene = createSceneContext(engine);
  const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
  const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });
  addToScene(scene, createHemisphericLight([0.3, 1, 0.2], 1.3));

  makeStaticBox(engine, scene, world, [0, -0.25, 0], [32, 0.5, 32], [0.08, 0.13, 0.2, 1], "ground");
  makeStaticBox(engine, scene, world, [3, 0.25, 1], [2.5, 0.5, 2.5], [0.15, 0.25, 0.38, 1]);
  makeStaticBox(engine, scene, world, [-3, 0.5, -2], [2, 1, 2], [0.2, 0.18, 0.34, 1]);
  makeStaticBox(engine, scene, world, [0, 0.3, -11.5], [6, 0.6, 5], [0.18, 0.34, 0.24, 1], "ledge-deck");
  makeStaticBox(engine, scene, world, [0, 0.15, -8.65], [3, 0.3, 0.7], [0.2, 0.42, 0.28, 1], "ledge-step");
  makeStaticBox(engine, scene, world, [8, 0.65, 5], [4, 0.45, 7], [0.12, 0.42, 0.29, 1], "walkable-ramp", [
    Math.PI / 9,
    0,
    0,
  ]);
  makeStaticBox(engine, scene, world, [9, 1.55, -6], [4, 0.45, 7], [0.55, 0.16, 0.14, 1], "steep-ramp", [
    Math.PI * 0.36,
    0,
    0,
  ]);

  for (let i = 0; i < 8; i++) {
    makeStaticBox(
      engine,
      scene,
      world,
      [-10, 0.2 + 0.2 * i, 5 + 0.6 * i],
      [5.5, 0.4, 0.8],
      [0.22, 0.32 + i * 0.025, 0.48, 1],
      `step-${i}`,
    );
  }

  makeStaticBox(engine, scene, world, [0, 1.75, 5], [4, 0.25, 5], [0.38, 0.18, 0.22, 1], "low-ceiling");
  makeStaticBox(engine, scene, world, [-2.15, 0.8, 5], [0.3, 1.6, 5], [0.28, 0.15, 0.2, 1], "tunnel-left");
  makeStaticBox(engine, scene, world, [2.15, 0.8, 5], [0.3, 1.6, 5], [0.28, 0.15, 0.2, 1], "tunnel-right");

  const horizontalPlatform = makeAnimatedPlatform(
    engine,
    scene,
    world,
    [-5, 0.3, -8],
    [4, 0.5, 3],
    [0.5, 0.16, 0.62, 1],
    "moving-platform",
  );
  const verticalPlatform = makeAnimatedPlatform(
    engine,
    scene,
    world,
    [5, 0.3, -10],
    [3, 0.5, 3],
    [0.1, 0.55, 0.62, 1],
    "vertical-platform",
  );
  const rotatingPlatform = makeAnimatedPlatform(
    engine,
    scene,
    world,
    [8, 0.3, -1],
    [5, 0.5, 2],
    [0.72, 0.42, 0.1, 1],
    "rotating-platform",
  );
  let platformTime = 0;
  onBeforeRender(scene, (deltaMs) => {
    platformTime += deltaMs / 1000;
    horizontalPlatform.position.x = -5 + Math.sin(platformTime * 0.8) * 3;
    verticalPlatform.position.y = 0.8 + Math.sin(platformTime * 0.9) * 0.5;
    rotatingPlatform.rotation.y = platformTime * 0.65;
  });

  for (let i = 0; i < 6; i++) makeDynamicBox(engine, scene, world, [-1.5 + i * 1.1, 0.55, -5]);

  const spawn = { x: -10, y: 1.2, z: 3.6 };
  const character = new LiteCharacterController(world, spawn);
  const visual = createCapsule(engine, { height: 1.8, radius: 0.35 });
  visual.material = material([0.08, 0.65, 0.95, 1]);
  addToScene(scene, visual);
  const facingMarker = createBox(engine, 1);
  facingMarker.scaling.set(0.16, 0.16, 0.45);
  facingMarker.material = material([1, 0.82, 0.12, 1]);
  addToScene(scene, facingMarker);

  const camera = createArcRotateCamera(-Math.PI / 2, 1.05, 7, {
    x: spawn.x,
    y: spawn.y + 0.35,
    z: spawn.z,
  });
  addToScene(scene, camera);
  scene.camera = camera;
  attachControl(camera, canvas!, scene);
  const followCamera = new LiteFollowCamera(camera, world);
  let stepsClimbed = 0;
  character.events.on("stepped", () => stepsClimbed++);

  const updateCameraModeUi = () => {
    cameraModeButton.textContent =
      followCamera.mode === "thirdPerson" ? "Switch to first person (V)" : "Switch to third person (V)";
  };
  const toggleCameraMode = () => {
    followCamera.toggleMode();
    updateCameraModeUi();
  };
  cameraModeButton.addEventListener("click", toggleCameraMode);
  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyV" && !event.repeat) toggleCameraMode();
  });
  updateCameraModeUi();

  onPhysicsAfterStep(world, (dt) => {
    const x = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const z = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const snapshot = character.step(dt, {
      move: cameraRelativeMove(x, z, camera.alpha),
      sprint: keys.has("ShiftLeft") || keys.has("ShiftRight"),
      jumpPressed: jumpQueued,
      crouch: keys.has("KeyC"),
    });
    jumpQueued = false;

    visual.position.copyFrom(snapshot.position);
    visual.rotation.y = snapshot.facingYaw;
    visual.scaling.set(1, (snapshot.stance === "standing" ? 1.8 : 1.15) / 1.8, 1);
    facingMarker.position.set(
      snapshot.position.x + Math.sin(snapshot.facingYaw) * 0.45,
      snapshot.position.y + 0.15,
      snapshot.position.z + Math.cos(snapshot.facingYaw) * 0.45,
    );
    facingMarker.rotation.y = snapshot.facingYaw;
    followCamera.update(dt, snapshot);
    const showThirdPersonCharacter = followCamera.firstPersonBlend < 0.8;
    setMeshVisible(visual, showThirdPersonCharacter);
    setMeshVisible(facingMarker, showThirdPersonCharacter);
    const motion = snapshot.falling
      ? `fall ${snapshot.fallTime.toFixed(1)}s`
      : snapshot.grounded
        ? "grounded"
        : snapshot.sliding
          ? "sliding"
          : "air";
    stateOutput.value = `${snapshot.stance} · ${motion} · ${snapshot.horizontalSpeed.toFixed(1)} m/s · steps ${stepsClimbed}`;
  });

  await registerScene(scene);
  await startEngine(engine);
}

main().catch((error: unknown) => {
  errorOutput.hidden = false;
  errorOutput.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
  console.error(error);
});
