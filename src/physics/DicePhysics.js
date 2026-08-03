import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { getHullPoints } from "./colliders.js";

const FIXED_DT = 1 / 60; // physics runs at a fixed 60Hz, decoupled from render FPS
const MAX_SUBSTEPS = 5; // cap catch-up steps so a long frame can't spiral
const GRAVITY = -22; // world units/s²; tuned with damping/friction for a ~1-3s settle

// Dice-on-a-table feel: high friction so they grip and stop rolling, low
// restitution so they barely bounce (no rubbery hopping), and damping so
// energy bleeds off and they come to rest in 1-3s instead of drifting.
const DIE_RESTITUTION = 0.15;
const DIE_FRICTION = 0.85;
const DIE_DENSITY = 1.2;
// Defaults for the desktop-scale board; addDie() lets a caller override
// these (see main.js's BOARD_TUNING) for boards with differently-sized dice
// — a bigger die falling from a proportionally taller drop/wall height
// carries more energy, and needs more damping to still settle in ~1-3s.
const DEFAULT_LINEAR_DAMPING = 0.35;
const DEFAULT_ANGULAR_DAMPING = 0.55;

const WALL_RESTITUTION = 0.1;
const WALL_FRICTION = 0.8;
const WALL_THICKNESS = 0.5;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

/** Initializes Rapier (async WASM) and returns the dice-tray physics manager. */
export async function createDicePhysics() {
  await RAPIER.init();

  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  // Rapier's world-level CCD budget defaults to 1 substep per step, which was
  // never exercised before charged throws could reach ~2.5x their old top
  // speed: at that speed a die crosses a large fraction of its own size in a
  // single 1/60s step, and one CCD substep isn't always enough to resolve a
  // fast, tumbling impact against a wall without a brief (but real —
  // measured ~0.1 world units) overshoot past its inner face before the
  // solver pushes it back out. Raising the budget gives Rapier the sub-
  // iterations to resolve that same contact within the step it happens,
  // instead of visibly correcting it a frame or two late. Per-body
  // setCcdEnabled(true) below is necessary but NOT sufficient on its own —
  // this is the other half of the same mechanism.
  world.integrationParameters.maxCcdSubsteps = 4;

  // record.id -> { body, record, prevPos, prevQuat, curPos, curQuat }
  const entries = new Map();
  let staticBody = null;
  let accumulator = 0;

  /** (Re)builds the tray's floor + 4 walls (+ ceiling) as one static body. */
  function setTrayBounds({ centerX, centerZ, width, depth, wallHeight = 5 }) {
    if (staticBody) {
      world.removeRigidBody(staticBody); // also removes its colliders
      staticBody = null;
    }

    staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    const hw = width / 2;
    const hd = depth / 2;
    const t = WALL_THICKNESS;

    const addBox = (hx, hy, hz, x, y, z) => {
      const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z)
        .setRestitution(WALL_RESTITUTION)
        .setFriction(WALL_FRICTION);
      world.createCollider(desc, staticBody);
    };

    // Floor: top face flush with y=0.
    addBox(hw, t, hd, centerX, -t, centerZ);
    // Ceiling: caps how high a violent throw can pop dice.
    addBox(hw, t, hd, centerX, wallHeight, centerZ);
    // Walls — inner faces exactly on the tray boundary; tall + thick so no
    // throw can escape (CCD on dice guards against tunnelling too).
    addBox(t, wallHeight, hd, centerX - hw - t, wallHeight / 2, centerZ);
    addBox(t, wallHeight, hd, centerX + hw + t, wallHeight / 2, centerZ);
    addBox(hw, wallHeight, t, centerX, wallHeight / 2, centerZ - hd - t);
    addBox(hw, wallHeight, t, centerX, wallHeight / 2, centerZ + hd + t);
  }

  function addDie(
    record,
    {
      position,
      quaternion,
      scale,
      linvel = { x: 0, y: 0, z: 0 },
      angvel = { x: 0, y: 0, z: 0 },
      linearDamping = DEFAULT_LINEAR_DAMPING,
      angularDamping = DEFAULT_ANGULAR_DAMPING,
    }
  ) {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })
      .setLinvel(linvel.x, linvel.y, linvel.z)
      .setAngvel(angvel)
      .setLinearDamping(linearDamping)
      .setAngularDamping(angularDamping)
      .setCcdEnabled(true); // fast throws mustn't tunnel through the thin walls

    const body = world.createRigidBody(bodyDesc);

    // The collider is always built at the die's current *tray* scale (the
    // caller passes it explicitly — a die's visual scale is context-
    // dependent now: smaller on the source strip, larger in the tray/board,
    // and can even differ mobile vs desktop).
    const points = getHullPoints(record.dieType, scale);
    const colliderDesc = RAPIER.ColliderDesc.convexHull(points)
      .setRestitution(DIE_RESTITUTION)
      .setFriction(DIE_FRICTION)
      .setDensity(DIE_DENSITY);
    world.createCollider(colliderDesc, body);

    const pos = body.translation();
    const rot = body.rotation();
    entries.set(record.id, {
      body,
      record,
      prevPos: { ...pos },
      curPos: { ...pos },
      prevQuat: { ...rot },
      curQuat: { ...rot },
    });
    record.body = body;
  }

  function removeDie(record) {
    const entry = entries.get(record.id);
    if (!entry) return;
    world.removeRigidBody(entry.body); // frees body + collider from the world
    entries.delete(record.id);
    record.body = null;
  }

  function hasBody(record) {
    return entries.has(record.id);
  }

  function isSleeping(record) {
    const entry = entries.get(record.id);
    return entry ? entry.body.isSleeping() : false;
  }

  /**
   * Advances the simulation with a fixed-timestep accumulator (stable
   * regardless of frame rate) and returns the interpolation factor `alpha`
   * for blending each body between its previous and current step.
   */
  function step(dt) {
    accumulator += Math.min(dt, 0.1); // clamp huge frames (tab was backgrounded)

    let substeps = 0;
    while (accumulator >= FIXED_DT && substeps < MAX_SUBSTEPS) {
      for (const entry of entries.values()) {
        entry.prevPos = entry.curPos;
        entry.prevQuat = entry.curQuat;
      }
      world.step();
      for (const entry of entries.values()) {
        entry.curPos = { ...entry.body.translation() };
        entry.curQuat = { ...entry.body.rotation() };
      }
      accumulator -= FIXED_DT;
      substeps++;
    }
    if (substeps === MAX_SUBSTEPS) accumulator = 0; // give up leftover to avoid spiral of death

    return accumulator / FIXED_DT;
  }

  /** Writes interpolated body transforms onto their record.group each frame. */
  function sync(alpha) {
    for (const entry of entries.values()) {
      const g = entry.record.group;
      g.position.set(
        THREE.MathUtils.lerp(entry.prevPos.x, entry.curPos.x, alpha),
        THREE.MathUtils.lerp(entry.prevPos.y, entry.curPos.y, alpha),
        THREE.MathUtils.lerp(entry.prevPos.z, entry.curPos.z, alpha)
      );
      _q.set(entry.prevQuat.x, entry.prevQuat.y, entry.prevQuat.z, entry.prevQuat.w);
      _q2.set(entry.curQuat.x, entry.curQuat.y, entry.curQuat.z, entry.curQuat.w);
      g.quaternion.slerpQuaternions(_q, _q2, alpha);
    }
  }

  // Diagnostics: total rigid bodies in the world (dynamic dice + the one
  // static tray body) and colliders, for leak checks.
  function stats() {
    return { rigidBodies: world.bodies.len(), colliders: world.colliders.len(), tracked: entries.size };
  }

  return { setTrayBounds, addDie, removeDie, hasBody, isSleeping, step, sync, stats };
}
