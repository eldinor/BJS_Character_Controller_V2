import { readFileSync } from "node:fs";
import HavokPhysics from "@babylonjs/havok";
import {
  PhysicsShapeType,
  PhysicsMotionType,
  PhysicsPrestepType,
  createPhysicsBody,
  createPhysicsShape,
  createHavokWorld,
  createArcRotateCamera,
  createNullEngine,
  createSceneContext,
  createTransformNode,
  disposePhysics,
  onPhysicsAfterStep,
  onBeforeRender,
  runHeadlessSteps,
  setPhysicsBodyShape,
  setPhysicsBodyPrestepType,
  setPhysicsShapeMaterial,
  removePhysicsBody,
  type PhysicsWorld,
} from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import { LiteCharacterController } from "./character-controller";
import { LiteFollowCamera } from "./follow-camera";

function addBox(
  world: PhysicsWorld,
  name: string,
  position: [number, number, number],
  extents: [number, number, number],
  motionType = PhysicsMotionType.STATIC,
  rotationX = 0,
) {
  const node = createTransformNode(
    name,
    ...position,
    Math.sin(rotationX * 0.5), 0, 0, Math.cos(rotationX * 0.5),
  );
  const body = createPhysicsBody(world, node, motionType);
  const shape = createPhysicsShape(world, {
    type: PhysicsShapeType.BOX,
    parameters: { extents: { x: extents[0], y: extents[1], z: extents[2] } },
  });
  setPhysicsBodyShape(world, body, shape);
  return { node, body, shape };
}

describe("LiteCharacterController with Havok", () => {
  it("lands, walks, and jumps in a headless Lite scene", async () => {
    const wasmUrl = new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url);
    const wasmBinary = Uint8Array.from(readFileSync(wasmUrl)).buffer;
    const havok = await HavokPhysics({ wasmBinary });
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });

    const ground = createTransformNode("ground", 0, -0.25, 0);
    const groundBody = createPhysicsBody(world, ground, PhysicsMotionType.STATIC);
    const groundShape = createPhysicsShape(world, {
      type: PhysicsShapeType.BOX,
      parameters: { extents: { x: 20, y: 0.5, z: 20 } },
    });
    setPhysicsBodyShape(world, groundBody, groundShape);

    const character = new LiteCharacterController(world, { x: 0, y: 2, z: 0 });
    let jump = false;
    let snapshot = character.snapshot();
    onPhysicsAfterStep(world, (dt) => {
      snapshot = character.step(dt, {
        move: { x: 0, y: 0, z: 1 },
        jumpPressed: jump,
        crouch: false,
      });
      jump = false;
    });

    runHeadlessSteps(engine, scene, 90);
    expect(snapshot.grounded).toBe(true);
    expect(snapshot.position.z).toBeGreaterThan(1);

    jump = true;
    runHeadlessSteps(engine, scene, 1);
    expect(snapshot.velocity.y).toBeGreaterThan(0);
    expect(snapshot.grounded).toBe(false);

    character.dispose();
    disposePhysics(world);
  });

  it("inherits motion from an animated platform", async () => {
    const wasmUrl = new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url);
    const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(readFileSync(wasmUrl)).buffer });
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });

    const platform = createTransformNode("platform", 0, 0, 0);
    const body = createPhysicsBody(world, platform, PhysicsMotionType.ANIMATED);
    const shape = createPhysicsShape(world, {
      type: PhysicsShapeType.BOX,
      parameters: { extents: { x: 4, y: 0.5, z: 4 } },
    });
    setPhysicsBodyShape(world, body, shape);
    setPhysicsBodyPrestepType(body, PhysicsPrestepType.ACTION);

    const character = new LiteCharacterController(world, { x: 0, y: 1, z: 0 });
    let elapsed = 0;
    onBeforeRender(scene, (deltaMs) => {
      elapsed += deltaMs / 1000;
      const travelTime = Math.min(2, Math.max(0, elapsed - 0.5));
      platform.position.x = 2 * Math.sin(travelTime * Math.PI / 2);
    });
    onPhysicsAfterStep(world, (dt) => {
      character.step(dt, { move: { x: 0, y: 0, z: 0 }, crouch: false });
    });

    runHeadlessSteps(engine, scene, 90);
    expect(platform.position.x).toBeGreaterThan(1.8);
    expect(character.snapshot().position.x).toBeGreaterThan(1.5);
    runHeadlessSteps(engine, scene, 60);
    expect(Math.abs(platform.position.x)).toBeLessThan(0.1);
    expect(Math.abs(character.snapshot().position.x)).toBeLessThan(0.5);

    character.dispose();
    disposePhysics(world);
  });

  it("steps over a low riser", async () => {
    const wasmUrl = new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url);
    const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(readFileSync(wasmUrl)).buffer });
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });
    addBox(world, "ground", [0, -0.25, 0], [12, 0.5, 12]);
    addBox(world, "step", [0, 0.15, 2], [3, 0.3, 1]);
    const character = new LiteCharacterController(world, { x: 0, y: 1, z: 0 });
    let stepped = 0;
    character.events.on("stepped", () => stepped++);
    onPhysicsAfterStep(world, (dt) => character.step(dt, { move: { x: 0, y: 0, z: 1 }, crouch: false }));
    runHeadlessSteps(engine, scene, 150);
    expect(character.snapshot().position.z).toBeGreaterThan(3);
    expect(stepped).toBeGreaterThan(0);
    character.dispose();
    disposePhysics(world);
  });

  it("climbs a multi-step staircase without jumping", async () => {
    const wasmUrl = new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url);
    const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(readFileSync(wasmUrl)).buffer });
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });
    addBox(world, "ground", [0, -0.25, 0], [12, 0.5, 16]);
    for (let i = 0; i < 8; i++) {
      addBox(world, `stair-${i}`, [0, 0.2 + i * 0.2, 2 + i * 0.6], [3, 0.4, 0.8]);
    }
    const character = new LiteCharacterController(world, { x: 0, y: 1, z: 0.6 });
    let jumped = false;
    let maxHeight = 0;
    let elapsed = 0;
    let reachedTopAt = 0;
    character.events.on("jumped", () => { jumped = true; });
    onPhysicsAfterStep(world, (dt) => {
      elapsed += dt;
      const moveZ = character.snapshot().position.z < 6.2 ? 1 : 0;
      const snapshot = character.step(dt, { move: { x: 0, y: 0, z: moveZ }, crouch: false });
      maxHeight = Math.max(maxHeight, snapshot.position.y);
      if (reachedTopAt === 0 && snapshot.position.z >= 6.2) reachedTopAt = elapsed;
    });
    runHeadlessSteps(engine, scene, 180);
    const snapshot = character.snapshot();
    expect(snapshot.position.z).toBeGreaterThan(6);
    expect(maxHeight).toBeGreaterThan(2);
    expect(reachedTopAt).toBeGreaterThan(2);
    expect(jumped).toBe(false);
    character.dispose();
    disposePhysics(world);
  });

  it("refuses to stand beneath a low ceiling", async () => {
    const wasmUrl = new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url);
    const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(readFileSync(wasmUrl)).buffer });
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });
    addBox(world, "ground", [0, -0.25, 0], [8, 0.5, 8]);
    const character = new LiteCharacterController(world, { x: 0, y: 1, z: 0 });
    let crouch = false;
    onPhysicsAfterStep(world, (dt) => character.step(dt, { move: { x: 0, y: 0, z: 0 }, crouch }));
    runHeadlessSteps(engine, scene, 45);
    crouch = true;
    runHeadlessSteps(engine, scene, 2);
    expect(character.stance).toBe("crouching");
    const ceiling = addBox(world, "ceiling", [0, 1.5, 0], [4, 0.2, 4]);
    crouch = false;
    runHeadlessSteps(engine, scene, 5);
    expect(character.stance).toBe("crouching");
    removePhysicsBody(world, ceiling.body);
    runHeadlessSteps(engine, scene, 2);
    expect(character.stance).toBe("standing");
    character.dispose();
    disposePhysics(world);
  });

  it("pushes a dynamic box", async () => {
    const wasmUrl = new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url);
    const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(readFileSync(wasmUrl)).buffer });
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });
    addBox(world, "ground", [0, -0.25, 0], [12, 0.5, 12]);
    const box = addBox(world, "push-box", [0, 0.5, 2], [1, 1, 1], PhysicsMotionType.DYNAMIC);
    setPhysicsShapeMaterial(world, box.shape, 0.3, 0);
    const character = new LiteCharacterController(world, { x: 0, y: 1, z: 0 });
    onPhysicsAfterStep(world, (dt) => character.step(dt, { move: { x: 0, y: 0, z: 1 }, sprint: true, crouch: false }));
    runHeadlessSteps(engine, scene, 150);
    expect(box.node.position.z).toBeGreaterThan(2.5);
    character.dispose();
    disposePhysics(world);
  });

  it("climbs a walkable ramp but rejects a steep ramp", async () => {
    const wasmUrl = new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url);
    const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(readFileSync(wasmUrl)).buffer });
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });
    addBox(world, "ground", [0, -0.25, 0], [14, 0.5, 14]);
    addBox(world, "walkable-ramp", [-3, 1.1, 0], [3, 0.5, 6], PhysicsMotionType.STATIC, Math.PI / 9);
    addBox(world, "steep-ramp", [3, 2.5, 0], [3, 0.5, 6], PhysicsMotionType.STATIC, Math.PI * 0.36);
    const walkable = new LiteCharacterController(world, { x: -3, y: 1, z: 3.5 });
    const steep = new LiteCharacterController(world, { x: 3, y: 1, z: 3.5 });
    onPhysicsAfterStep(world, (dt) => {
      const input = { move: { x: 0, y: 0, z: -1 }, crouch: false };
      walkable.step(dt, input);
      steep.step(dt, input);
    });
    runHeadlessSteps(engine, scene, 90);
    expect(walkable.snapshot().position.y).toBeGreaterThan(1.4);
    expect(steep.snapshot().position.y).toBeLessThan(1.4);
    walkable.dispose();
    steep.dispose();
    disposePhysics(world);
  });

  it("follows vertical and rotating platform transforms", async () => {
    const wasmUrl = new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url);
    const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(readFileSync(wasmUrl)).buffer });
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });
    const platform = addBox(world, "transform-platform", [0, 0, 0], [6, 0.5, 6], PhysicsMotionType.ANIMATED);
    setPhysicsBodyPrestepType(platform.body, PhysicsPrestepType.ACTION);
    const character = new LiteCharacterController(world, { x: 1, y: 1, z: 0 });
    let elapsed = 0;
    onBeforeRender(scene, (deltaMs) => {
      elapsed += deltaMs / 1000;
      const motionTime = Math.max(0, elapsed - 0.5);
      platform.node.position.y = Math.min(1, motionTime);
      platform.node.rotation.y = Math.min(1, motionTime);
    });
    onPhysicsAfterStep(world, (dt) => {
      character.step(dt, { move: { x: 0, y: 0, z: 0 }, crouch: false });
    });
    runHeadlessSteps(engine, scene, 90);
    const snapshot = character.snapshot();
    expect(snapshot.position.y).toBeGreaterThan(1.7);
    expect(Math.abs(snapshot.position.z)).toBeGreaterThan(0.5);
    expect(Math.abs(snapshot.facingYaw)).toBeGreaterThan(0.5);
    character.dispose();
    disposePhysics(world);
  });

  it("detects a ledge and enters a controlled fall", async () => {
    const wasmUrl = new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url);
    const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(readFileSync(wasmUrl)).buffer });
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });
    addBox(world, "ledge", [0, 0, 0], [4, 0.5, 4]);
    const character = new LiteCharacterController(world, { x: 0, y: 1, z: 0.5 });
    let sawLedge = false;
    let fellFromLedge = false;
    character.events.on("ledgeEntered", () => { sawLedge = true; });
    character.events.on("fallStarted", ({ fromLedge }) => { fellFromLedge ||= fromLedge; });
    onPhysicsAfterStep(world, (dt) => {
      character.step(dt, { move: { x: 0, y: 0, z: 1 }, crouch: false });
    });
    runHeadlessSteps(engine, scene, 100);
    const snapshot = character.snapshot();
    expect(sawLedge).toBe(true);
    expect(fellFromLedge).toBe(true);
    expect(snapshot.falling).toBe(true);
    expect(snapshot.fallTime).toBeGreaterThan(0.2);
    expect(snapshot.position.y).toBeLessThan(0);
    character.dispose();
    disposePhysics(world);
  });

  it("shortens the follow camera radius when a wall obstructs it", async () => {
    const wasmUrl = new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url);
    const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(readFileSync(wasmUrl)).buffer });
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const world = createHavokWorld(scene, havok, { x: 0, y: -22, z: 0 });
    addBox(world, "camera-wall", [0, 1, -3], [5, 4, 0.5]);
    const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2, 7, { x: 0, y: 1, z: 0 });
    const follow = new LiteFollowCamera(camera, world);
    const snapshot = {
      position: { x: 0, y: 0.65, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      sliding: false,
      stance: "standing" as const,
      facingYaw: 0,
      horizontalSpeed: 0,
      nearLedge: false,
      ledgeDrop: null,
      falling: false,
      fallTime: 0,
      supportYawDelta: 0,
    };
    for (let i = 0; i < 10; i++) follow.update(1 / 60, snapshot);
    expect(follow.obstructed).toBe(true);
    expect(camera.radius).toBeLessThan(3);
    follow.setMode("firstPerson");
    for (let i = 0; i < 60; i++) follow.update(1 / 60, snapshot);
    expect(follow.firstPersonBlend).toBeGreaterThan(0.99);
    expect(camera.radius).toBeLessThan(0.1);
    expect(camera.nearPlane).toBeCloseTo(0.03, 2);
    expect(follow.obstructed).toBe(false);
    snapshot.position.x = 4;
    snapshot.position.z = 2;
    snapshot.supportYawDelta = 0.2;
    follow.update(1 / 60, snapshot);
    expect(camera.alpha).toBeCloseTo(-Math.PI / 2 - 0.2, 3);
    expect(camera.worldMatrix[12]).toBeCloseTo(4, 3);
    expect(camera.worldMatrix[13]).toBeCloseTo(1.3, 2);
    expect(camera.worldMatrix[14]).toBeCloseTo(2, 3);
    disposePhysics(world);
  });
});
