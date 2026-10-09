import {
  PhysicsShapeType,
  createPhysicsShape,
  releasePhysicsShape,
  setPhysicsBodyShape,
  type PhysicsBody,
  type PhysicsCharacterController,
  type PhysicsShape,
  type PhysicsWorld,
} from "@babylonjs/lite";

interface ControllerInternals {
  _world: PhysicsWorld;
  _body: PhysicsBody;
  _shape: PhysicsShape;
  _manifold: unknown[];
  _bodyTracking?: Map<unknown, unknown>;
}

interface ManifoldContact {
  normal?: { x: number; y: number; z: number };
  body?: PhysicsBody;
}

function internals(controller: PhysicsCharacterController): ControllerInternals {
  const candidate = controller as unknown as Partial<ControllerInternals>;
  for (const key of ["_world", "_body", "_shape", "_manifold"] as const) {
    if (!(key in candidate)) {
      throw new Error(
        `LiteCC requires @babylonjs/lite 1.8.0 internals; missing ${key}. ` +
          "Update the LiteCC adapter before changing Babylon Lite versions.",
      );
    }
  }
  return candidate as ControllerInternals;
}

/**
 * Replaces Lite 1.8.0's private character capsule while preserving the feet and velocity.
 * All private API usage is deliberately isolated in this module.
 */
export function resizeCharacterCapsule(
  controller: PhysicsCharacterController,
  oldHeight: number,
  newHeight: number,
  radius: number,
): void {
  if (newHeight < radius * 2) throw new RangeError("Capsule height cannot be smaller than its diameter");
  const cc = internals(controller);
  const oldShape = cc._shape;
  const halfSegment = newHeight * 0.5 - radius;
  const newShape = createPhysicsShape(cc._world, {
    type: PhysicsShapeType.CAPSULE,
    parameters: {
      pointA: { x: 0, y: halfSegment, z: 0 },
      pointB: { x: 0, y: -halfSegment, z: 0 },
      radius,
    },
  });

  try {
    setPhysicsBodyShape(cc._world, cc._body, newShape);
    cc._shape = newShape;

    const position = controller.getPosition();
    controller.setPosition({
      x: position.x,
      y: position.y + (newHeight - oldHeight) * 0.5,
      z: position.z,
    });

    cc._manifold.length = 0;
    cc._bodyTracking?.clear();
  } catch (error) {
    releasePhysicsShape(cc._world, newShape);
    throw error;
  }

  releasePhysicsShape(cc._world, oldShape);
}

export function assertLiteInternals(controller: PhysicsCharacterController): void {
  internals(controller);
}

export function resetCharacterContacts(controller: PhysicsCharacterController): void {
  const cc = internals(controller);
  cc._manifold.length = 0;
  cc._bodyTracking?.clear();
}

/**
 * Lite 1.8.0 classifies animated contacts but currently reports zero support
 * velocity for them. Expose only the supporting animated body so LiteCC can
 * preserve attachment using its node-transform delta.
 */
export function getAnimatedSupportBody(controller: PhysicsCharacterController): PhysicsBody | undefined {
  const cc = internals(controller);
  for (const raw of cc._manifold) {
    const contact = raw as ManifoldContact;
    if (contact.normal && contact.normal.y > 0.08 && contact.body?.motionType === 1) {
      return contact.body;
    }
  }
  return undefined;
}
