import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
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
import { LiteCharacterController, LiteFollowCamera, cameraRelativeMove } from "../src";

const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas");
const stateOutput = document.querySelector<HTMLOutputElement>("#state");
const errorOutput = document.querySelector<HTMLDivElement>("#error");
const cameraModeButton = document.querySelector<HTMLButtonElement>("#cameraMode");
if (!canvas || !stateOutput || !errorOutput || !cameraModeButton) throw new Error("Demo DOM is incomplete");

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
  // Lite 1.8.0 aggregate auto-sizing uses unscaled local bounds, so scaled
  // primitives need explicit world-size extents for matching Havok geometry.
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
  const engine = await createEngine(canvas!);
  const scene = createSceneContext(engine);
  // Emscripten cannot infer the WASM location after Vite pre-bundles the JS loader.
  const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
  const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });

  addToScene(scene, createHemisphericLight([0.3, 1, 0.2], 1.3));
  makeStaticBox(engine, scene, world, [0, -0.25, 0], [32, 0.5, 32], [0.08, 0.13, 0.2, 1]);
  makeStaticBox(engine, scene, world, [3, 0.25, 1], [2.5, 0.5, 2.5], [0.15, 0.25, 0.38, 1]);
  makeStaticBox(engine, scene, world, [-3, 0.5, -2], [2, 1, 2], [0.2, 0.18, 0.34, 1]);
  // Raised deck for ledge detection and controlled-fall testing.
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

  // Original controller demo stairs: 8 overlapping box steps, 0.2 m rise each.
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

  // Low-clearance test tunnel: comfortably fits the 1.15 m crouched capsule,
  // while remaining low enough to reject the 1.8 m standing capsule.
  makeStaticBox(engine, scene, world, [0, 1.75, 5], [4, 0.25, 5], [0.38, 0.18, 0.22, 1], "low-ceiling");
  makeStaticBox(engine, scene, world, [-2.15, 0.8, 5], [0.3, 1.6, 5], [0.28, 0.15, 0.2, 1], "tunnel-left");
  makeStaticBox(engine, scene, world, [2.15, 0.8, 5], [0.3, 1.6, 5], [0.28, 0.15, 0.2, 1], "tunnel-right");

  const platform = createBox(engine, 1);
  platform.name = "moving-platform";
  platform.position.set(-5, 0.3, -8);
  platform.scaling.set(4, 0.5, 3);
  platform.material = material([0.5, 0.16, 0.62, 1]);
  addToScene(scene, platform);
  const platformAggregate = createPhysicsAggregate(world, platform, PhysicsShapeType.BOX, {
    mass: 0,
    friction: 0.9,
    extents: { x: 4, y: 0.5, z: 3 },
  });
  setPhysicsBodyMotionType(world, platformAggregate.body, PhysicsMotionType.ANIMATED);
  // ACTION derives a kinematic velocity from the changing node transform.
  // TELEPORT would move the collider but report no useful support velocity,
  // allowing the platform to slide out from under the character.
  setPhysicsBodyPrestepType(platformAggregate.body, PhysicsPrestepType.ACTION);
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
    platform.position.x = -5 + Math.sin(platformTime * 0.8) * 3;
    verticalPlatform.position.y = 0.8 + Math.sin(platformTime * 0.9) * 0.5;
    rotatingPlatform.rotation.y = platformTime * 0.65;
  });

  for (let i = 0; i < 6; i++) makeDynamicBox(engine, scene, world, [-1.5 + i * 1.1, 0.55, -5]);

  const visual = createCapsule(engine, { height: 1.8, radius: 0.35 });
  visual.material = material([0.08, 0.65, 0.95, 1]);
  addToScene(scene, visual);
  const facingMarker = createBox(engine, 1);
  facingMarker.scaling.set(0.16, 0.16, 0.45);
  facingMarker.material = material([1, 0.82, 0.12, 1]);
  addToScene(scene, facingMarker);

  const spawn = { x: -10, y: 1.2, z: 3.6 };
  const character = new LiteCharacterController(world, spawn);
  let stepsClimbed = 0;
  let snapDowns = 0;
  character.events.on("stepped", () => stepsClimbed++);
  character.events.on("snappedDown", () => snapDowns++);

  const camera = createArcRotateCamera(-Math.PI / 2, 1.05, 7, {
    x: spawn.x,
    y: spawn.y + 0.35,
    z: spawn.z,
  });
  addToScene(scene, camera);
  scene.camera = camera;
  attachControl(camera, canvas, scene);
  setCameraLimits(camera, { lowerBeta: 0.25, upperBeta: 1.45, lowerRadius: 0.03, upperRadius: 12 }, scene);
  const followCamera = new LiteFollowCamera(camera, world);
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
    // Keep Lite's ObservableVec3 instance: replacing camera.target with a plain
    // object breaks dirty tracking and makes the view jump on the next click.
    followCamera.update(dt, snapshot);
    const showThirdPersonCharacter = followCamera.firstPersonBlend < 0.8;
    setMeshVisible(visual, showThirdPersonCharacter);
    setMeshVisible(facingMarker, showThirdPersonCharacter);
    const motionState = snapshot.nearLedge
      ? "LEDGE"
      : snapshot.falling
        ? `fall ${snapshot.fallTime.toFixed(1)}s`
        : snapshot.grounded
          ? "grounded"
          : snapshot.sliding
            ? "sliding"
            : "air";
    stateOutput.value = `${snapshot.stance} · ${motionState} · ${snapshot.horizontalSpeed.toFixed(1)} m/s · steps ${stepsClimbed} · snaps ${snapDowns}`;
  });

  await registerScene(scene);
  await startEngine(engine);
}

main().catch((error: unknown) => {
  errorOutput.hidden = false;
  errorOutput.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
  console.error(error);
});
