# Add a public API for resizing `PhysicsCharacterController` capsules

## Summary

Babylon Lite's public `PhysicsCharacterController` API currently allows a capsule size to be specified during creation, but does not provide a supported way to resize that capsule afterward.

Runtime resizing is needed for common character-controller features such as crouching, standing, crawling, sliding, and characters whose collision stance changes during gameplay.

## Current API limitation

A controller can be created with an initial capsule:

```ts
const controller = createPhysicsCharacterController(world, position, {
  capsuleHeight: 1.8,
  capsuleRadius: 0.35,
});
```

After creation, neither the capsule height nor radius can be changed through the public API.

Replacing the controller entirely is not a good runtime solution because application code must preserve:

- Position and velocity
- Ground and support state
- Contact/manifold state
- Controller configuration
- Event subscriptions
- References held by gameplay systems

## Current workaround

LiteCC currently uses a small, guarded adapter around Babylon Lite 1.8.0 private fields:

```ts
interface ControllerInternals {
  _world: PhysicsWorld;
  _body: PhysicsBody;
  _shape: PhysicsShape;
  _manifold: unknown[];
  _bodyTracking?: Map<unknown, unknown>;
}
```

The workaround:

1. Creates a new Havok capsule shape.
2. Assigns it to the existing private physics body.
3. Updates the private `_shape` reference.
4. Moves the controller center vertically to preserve its foot position.
5. Clears stale manifold and animated-body tracking state.
6. Releases the previous shape.

This works, but it depends on private implementation details and therefore pins LiteCC to Babylon Lite 1.8.0.

## Requested API

A public method on `PhysicsCharacterController` would solve this:

```ts
controller.resizeCapsule({
  height: 1.15,
  radius: 0.35,
  preserveFootPosition: true,
});
```

Possible type:

```ts
interface CharacterCapsuleResizeOptions {
  height: number;
  radius?: number;
  preserveFootPosition?: boolean;
  clearContacts?: boolean;
}
```

Alternatively, a standalone Lite function would also fit the existing API style:

```ts
resizePhysicsCharacterCapsule(controller, {
  height: 1.15,
  radius: 0.35,
  preserveFootPosition: true,
});
```

## Expected behavior

- Validate that `height >= radius * 2`.
- Replace and correctly release the old Havok capsule shape.
- Preserve the controller's position and velocity by default.
- Optionally preserve the world-space foot position.
- Invalidate contacts that reference the previous shape.
- Reset any cached body/support tracking that becomes stale.
- Keep the same `PhysicsCharacterController` instance and physics body.
- Work safely while grounded and while touching animated platforms.

## Standing clearance

The resize API does not need to decide whether expansion is safe. Applications may perform their own shape cast or ray-based clearance check before requesting a larger capsule.

It would also be useful if Babylon Lite eventually exposed a capsule-clearance query, but that is separate from the core resize request.

## Use case

```ts
if (input.crouch) {
  controller.resizeCapsule({
    height: 1.15,
    preserveFootPosition: true,
  });
} else if (hasStandingClearance()) {
  controller.resizeCapsule({
    height: 1.8,
    preserveFootPosition: true,
  });
}
```

## Environment

- `@babylonjs/lite`: 1.8.0
- `@babylonjs/havok`: 1.3.13
- WebGPU
- Physics V2 character controller

## Why this belongs in the public API

Capsule resizing requires coordinated shape ownership, body reassignment, transform adjustment, and cache invalidation. Those operations are implementation-specific and cannot be implemented robustly by consumers without private-field access.

A public resize operation would make stance changes safe and would allow character-controller packages to remain compatible across Babylon Lite releases.
