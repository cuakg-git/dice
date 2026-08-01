import * as THREE from "three";

const hullPointsCache = new WeakMap();

/**
 * Returns a flat Float32Array [x,y,z, ...] of a die type's geometry vertices
 * scaled to the die's visual size, for RAPIER.ColliderDesc.convexHull().
 *
 * Using the real hull (not a sphere/box) is what lets each die roll on its
 * actual faces and settle flush — a D6 lands square, a D20 tumbles across
 * facets, and a D4/D10 can't balance on a vertex. Rapier de-duplicates and
 * computes the convex hull internally, so the geometry's duplicated
 * face-soup vertices are fine to pass as-is.
 *
 * Cached per (dieType, scale): every instance of a type shares one scale,
 * so the array is built once per type and reused across its 10 instances.
 */
export function getHullPoints(dieType, scale) {
  let byScale = hullPointsCache.get(dieType);
  if (byScale && byScale.scale === scale) return byScale.points;

  const position = dieType.geometry.getAttribute("position");
  const points = new Float32Array(position.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).multiplyScalar(scale);
    points[i * 3] = v.x;
    points[i * 3 + 1] = v.y;
    points[i * 3 + 2] = v.z;
  }

  hullPointsCache.set(dieType, { scale, points });
  return points;
}
