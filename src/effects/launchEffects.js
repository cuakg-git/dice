import * as THREE from "three";
import { DICE_NUMBER_COLOR } from "../dice/diceColors.js";

/**
 * Comic-style launch feedback: a short streak trailing each thrown die, plus
 * a small burst of straight speed lines at the release point.
 *
 * Style notes: the app is flat/comic with heavy ink outlines, so these are
 * flat opaque quads in the same ink colour as the die edges — not glows, not
 * soft particles. Everything is drawn as unlit `MeshBasicMaterial` planes
 * lying in the board plane, which is also why they cost essentially nothing.
 *
 * Everything is POOLED and pre-allocated: a throw never allocates geometry,
 * materials or meshes, it just claims idle pool entries and writes transforms.
 * When the pool is exhausted the extra effects are simply skipped rather than
 * growing the pool — a hard ceiling on both cost and on-screen clutter.
 */

export const LAUNCH_EFFECTS_CONFIG = {
  enabled: true,

  // Below this release speed nothing spawns at all (a deposit, not a throw).
  minSpeed: 6,
  // Speed at which the effect is shown at full strength; scaled down linearly
  // toward minSpeed so gentle throws are barely visible.
  fullSpeed: 26,

  // --- Trail behind each die -------------------------------------------
  trailLength: 1.5, // world units at full force, measured behind the die
  trailWidth: 0.34, // world units across
  trailFadeDuration: 220, // ms from spawn to gone
  trailOpacity: 0.3, // peak opacity at full force
  maxTrails: 12, // pool size / hard cap on simultaneous trails

  // --- Speed lines at the release point ---------------------------------
  speedLinesCount: 4, // at full force; fewer for softer throws
  speedLinesDuration: 200, // ms
  speedLineLength: 1.1, // world units at full force
  speedLineWidth: 0.1,
  speedLineOpacity: 0.42,
  speedLineSpread: 0.42, // radians of fan around the throw direction
  speedLineDrift: 0.9, // world units each line travels outward while fading
  maxSpeedLines: 8, // pool size

  // With N dice thrown at once, per-die trail intensity is divided by
  // N^clutterFalloff. 0 = no reduction, 1 = fully proportional. 0.5 keeps a
  // big handful readable without making a single die look weak.
  clutterFalloff: 0.5,

  height: 0.05, // above the board plane, under the dice themselves
};

const _dir = new THREE.Vector2();

export function createLaunchEffects({ scene, config = LAUNCH_EFFECTS_CONFIG }) {
  // One unit quad shared by every effect mesh; per-instance size comes from
  // scale, so there is exactly one geometry for the whole system.
  const quad = new THREE.PlaneGeometry(1, 1);
  // Anchor the quad at one END rather than its centre, so a streak can be
  // "pinned" at the die/release point and grown backwards by scaling alone.
  quad.translate(0, -0.5, 0);

  function makePool(size) {
    const entries = [];
    for (let i = 0; i < size; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(DICE_NUMBER_COLOR),
        transparent: true,
        opacity: 0,
        depthWrite: false, // never occlude the dice or each other
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(quad, material);
      mesh.rotation.x = -Math.PI / 2; // lie flat in the board plane
      mesh.position.y = config.height;
      mesh.visible = false;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      scene.add(mesh);
      entries.push({ mesh, material, active: false, age: 0, life: 0 });
    }
    return entries;
  }

  const trailPool = makePool(config.maxTrails);
  const linePool = makePool(config.maxSpeedLines);
  // Trails track a live die, so each active entry remembers which one.
  const trailTargets = new Map(); // pool entry -> { record, peakOpacity, length }
  const activeLines = []; // { entry, dirX, dirZ, originX, originZ, drift, length, peakOpacity }

  function claim(pool) {
    for (const e of pool) if (!e.active) return e;
    return null; // pool exhausted: skip rather than grow
  }

  function release(entry) {
    entry.active = false;
    entry.mesh.visible = false;
    entry.material.opacity = 0;
  }

  /** 0..1 how strong the effect should be for this release speed. */
  function forceFraction(speed) {
    const span = Math.max(config.fullSpeed - config.minSpeed, 1e-4);
    return THREE.MathUtils.clamp((speed - config.minSpeed) / span, 0, 1);
  }

  /**
   * Fires the effect for one throw gesture.
   *
   * `dice` is every record launched together. The speed lines are spawned
   * ONCE for the whole gesture (they belong to the throw, not to any single
   * die), which is the main reason a 10-die handful doesn't produce ten
   * overlapping bursts; per-die trails additionally dim as the count grows.
   */
  function launch(dice, velX, velZ) {
    if (!config.enabled) return;
    const speed = Math.hypot(velX, velZ);
    if (speed < config.minSpeed || dice.length === 0) return;

    const force = forceFraction(speed);
    if (force <= 0) return;

    _dir.set(velX, velZ).normalize();
    const dirX = _dir.x;
    const dirZ = _dir.y;

    // --- per-die trails ---
    const clutter = 1 / Math.pow(dice.length, config.clutterFalloff);
    for (const record of dice) {
      const entry = claim(trailPool);
      if (!entry) break;
      entry.active = true;
      entry.age = 0;
      entry.life = config.trailFadeDuration;
      entry.mesh.visible = true;
      trailTargets.set(entry, {
        record,
        peakOpacity: config.trailOpacity * force * clutter,
        length: config.trailLength * force,
      });
    }

    // --- one speed-line burst for the gesture ---
    const count = Math.max(1, Math.round(config.speedLinesCount * force));
    const originX = dice.reduce((s, r) => s + r.group.position.x, 0) / dice.length;
    const originZ = dice.reduce((s, r) => s + r.group.position.z, 0) / dice.length;
    const baseAngle = Math.atan2(dirZ, dirX);
    for (let i = 0; i < count; i++) {
      const entry = claim(linePool);
      if (!entry) break;
      // Fan the lines evenly across the spread, centred on the throw direction.
      const t = count === 1 ? 0 : i / (count - 1) - 0.5;
      const angle = baseAngle + t * config.speedLineSpread;
      entry.active = true;
      entry.age = 0;
      entry.life = config.speedLinesDuration;
      entry.mesh.visible = true;
      activeLines.push({
        entry,
        dirX: Math.cos(angle),
        dirZ: Math.sin(angle),
        originX,
        originZ,
        drift: config.speedLineDrift * force,
        length: config.speedLineLength * force * (0.7 + 0.3 * Math.random()),
        peakOpacity: config.speedLineOpacity * force,
      });
    }
  }

  /**
   * Orients a flat quad so its anchored end sits at (x, z) and its body
   * extends along (dirX, dirZ) for `length`.
   */
  function place(mesh, x, z, dirX, dirZ, length, width) {
    mesh.position.set(x, config.height, z);
    // The quad lies in the board plane after the -90deg X rotation, with its
    // local +Y running along world -Z; this yaw aims that axis down the
    // direction vector.
    mesh.rotation.set(-Math.PI / 2, 0, Math.atan2(dirX, -dirZ));
    mesh.scale.set(width, Math.max(length, 1e-4), 1);
  }

  function update(dt) {
    const dtMs = dt * 1000;

    // Trails: re-anchored at their die every frame and stretched backwards
    // along its current heading, so the streak genuinely follows the throw
    // (including through the ballistic arc) instead of sitting where the die
    // used to be.
    for (const [entry, info] of trailTargets) {
      entry.age += dtMs;
      const t = entry.age / entry.life;
      if (t >= 1) {
        release(entry);
        trailTargets.delete(entry);
        continue;
      }
      const rec = info.record;
      const px = rec.group.position.x;
      const pz = rec.group.position.z;
      const prev = entry.prevX === undefined ? null : { x: entry.prevX, z: entry.prevZ };
      entry.prevX = px;
      entry.prevZ = pz;
      if (!prev) continue; // need one frame of motion to know the heading

      const mx = px - prev.x;
      const mz = pz - prev.z;
      const moved = Math.hypot(mx, mz);
      if (moved < 1e-5) {
        entry.mesh.visible = false;
        continue;
      }
      entry.mesh.visible = true;
      // Point the streak BACKWARDS from the die (opposite its motion).
      place(entry.mesh, px, pz, -mx / moved, -mz / moved, info.length * (1 - t), config.trailWidth * (1 - t * 0.5));
      entry.material.opacity = info.peakOpacity * (1 - t);
    }

    // Speed lines: fixed direction, drifting outward from the release point
    // while they shrink and fade.
    for (let i = activeLines.length - 1; i >= 0; i--) {
      const line = activeLines[i];
      const entry = line.entry;
      entry.age += dtMs;
      const t = entry.age / entry.life;
      if (t >= 1) {
        release(entry);
        activeLines.splice(i, 1);
        continue;
      }
      const travelled = line.drift * t;
      place(
        entry.mesh,
        line.originX + line.dirX * travelled,
        line.originZ + line.dirZ * travelled,
        line.dirX,
        line.dirZ,
        line.length * (1 - t * 0.6),
        config.speedLineWidth
      );
      // Fade out fast and late-weighted so they pop then vanish.
      entry.material.opacity = line.peakOpacity * (1 - t) * (1 - t);
    }
  }

  /** Live counts, for verification. */
  function stats() {
    return {
      activeTrails: trailTargets.size,
      activeLines: activeLines.length,
      trailPool: trailPool.length,
      linePool: linePool.length,
    };
  }

  function dispose() {
    for (const e of [...trailPool, ...linePool]) {
      scene.remove(e.mesh);
      e.material.dispose();
    }
    quad.dispose();
  }

  return { launch, update, stats, dispose, config };
}
