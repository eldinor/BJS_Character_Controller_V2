import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import {
  PhysicsMotionType,
  PhysicsShapeType,
  addToScene,
  attachControl,
  createArcRotateCamera,
  createCapsule,
  createEngine,
  createHavokWorld,
  createHemisphericLight,
  createPbrMaterial,
  createPhysicsBody,
  createPhysicsShape,
  createSceneContext,
  loadGltf,
  onPhysicsAfterStep,
  registerScene,
  setCameraLimits,
  setMeshVisible,
  setPhysicsBodyShape,
  setPhysicsShapeMaterial,
  startEngine,
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

async function main(): Promise<void> {
  if (!navigator.gpu) throw new Error("WebGPU is required for Babylon Lite.");

  const engine = await createEngine(canvas);
  const scene = createSceneContext(engine);
  const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
  const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });
  addToScene(scene, createHemisphericLight([0.25, 1, 0.15], 1.4));

  // The glTF root keeps every visual mesh in its authored hierarchy.  Havok's
  // mesh shape uses that same hierarchy, so rendering and collision stay aligned.
  stateOutput.value = "loading game-level.glb…";
  const level = await loadGltf(engine, "/game-level.glb");
  addToScene(scene, level);
  const levelRoot = level.entities[0];
  if (!levelRoot) throw new Error("game-level.glb contains no root node.");
  const levelCollider = createPhysicsShape(world, {
    type: PhysicsShapeType.MESH,
    mesh: levelRoot,
    includeChildMeshes: true,
  });
  const levelBody = createPhysicsBody(world, levelRoot, PhysicsMotionType.STATIC);
  setPhysicsBodyShape(world, levelBody, levelCollider);
  setPhysicsShapeMaterial(world, levelCollider, 0.9, 0);

  const capsuleHeightScale = 1.2;
  const standingHeight = 1.8 * capsuleHeightScale;
  const crouchingHeight = 1.15 * capsuleHeightScale;

  // A verified walkable triangle on Floor_Floor_01_0. The floor is at y=4.4;
  // the controller position is its capsule centre, hence the 1.08 m offset.
  const spawn = { x: 24.2, y: 5.48, z: -21.9 };
  // The authored mesh has small seams and bevels around its stairs. Keep these
  // allowances local to this demo rather than relaxing the package defaults.
  const character = new LiteCharacterController(world, spawn, {
    standingHeight,
    crouchingHeight,
    walkSpeed: 1.8,
    sprintSpeed: 3.4,
    maxStepHeight: 0.5,
    stepProbeDistance: 0.45,
    groundSnapDistance: 0.4,
  });
  const visual = createCapsule(engine, { height: standingHeight, radius: 0.35 });
  visual.material = createPbrMaterial({
    baseColorFactor: [0.08, 0.68, 0.95, 1], metallicFactor: 0.05, roughnessFactor: 0.45,
  });
  addToScene(scene, visual);

  // Face the staircase near (23.1, -32.1). The previous -PI/2 heading faced
  // away from it, making the player turn the camera before W could approach it.
  const stairsApproach = { x: 23.1, z: -32.1 };
  const initialCameraAlpha = Math.atan2(
    spawn.z - stairsApproach.z,
    spawn.x - stairsApproach.x,
  );
  const camera = createArcRotateCamera(initialCameraAlpha, 1.05, 7, {
    x: spawn.x, y: spawn.y + 0.35, z: spawn.z,
  });
  addToScene(scene, camera);
  scene.camera = camera;
  attachControl(camera, canvas, scene);
  setCameraLimits(camera, { lowerBeta: 0.25, upperBeta: 1.45, lowerRadius: 0.03, upperRadius: 14 }, scene);
  const followCamera = new LiteFollowCamera(camera, world);

  const updateCameraModeUi = () => {
    cameraModeButton.textContent = followCamera.mode === "thirdPerson"
      ? "Switch to first person (V)"
      : "Switch to third person (V)";
  };
  const toggleCameraMode = () => {
    followCamera.toggleMode();
    updateCameraModeUi();
  };
  cameraModeButton.addEventListener("click", toggleCameraMode);
  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyV" && !event.repeat) toggleCameraMode();
    if (event.code === "KeyR" && !event.repeat) {
      character.teleport(spawn);
      camera.alpha = initialCameraAlpha;
    }
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
    visual.scaling.set(1, (snapshot.stance === "standing" ? standingHeight : crouchingHeight) / standingHeight, 1);
    followCamera.update(dt, snapshot);
    setMeshVisible(visual, followCamera.firstPersonBlend < 0.8);
    const motion = snapshot.falling ? `fall ${snapshot.fallTime.toFixed(1)}s` : snapshot.grounded ? "grounded" : snapshot.sliding ? "sliding" : "air";
    stateOutput.value = `${snapshot.stance} · ${motion} · ${snapshot.horizontalSpeed.toFixed(1)} m/s`;
  });

  await registerScene(scene);
  await startEngine(engine);
}

main().catch((error: unknown) => {
  errorOutput.hidden = false;
  errorOutput.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
  console.error(error);
});
