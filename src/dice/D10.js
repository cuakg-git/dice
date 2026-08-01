import * as THREE from "three";
import { buildDieType } from "./DieBase.js";
import { DICE_COLORS } from "./diceColors.js";

/**
 * Builds a pentagonal trapezohedron (the real D10 shape): 2 apex vertices,
 * 10 "equatorial" vertices in a zigzag belt, and 10 kite-shaped quad faces
 * (5 pointing up toward the top apex, 5 pointing down toward the bottom
 * apex) — not a prism or antiprism, which only have triangular/pentagonal
 * faces.
 *
 * Each kite has 2 vertices on the mirror plane through its middle belt
 * vertex and the pole (apex, midBelt) plus a mirror-symmetric pair
 * (sideBelt, sideBelt'). That symmetry alone doesn't force the 4 points
 * onto one plane — the pole/belt height ratio has to satisfy
 * cos(36°)·(beltHeight + apexHeight) + (beltHeight − apexHeight) = 0, or
 * the kite folds into two differently-angled triangles instead of a flat
 * face. With apexHeight = 1 that gives beltHeight = (1−cos36°)/(1+cos36°).
 */
function buildD10Geometry() {
  const beltRadius = (2 * Math.cos(THREE.MathUtils.degToRad(36)) + 1) / 3;
  const cos36 = Math.cos(THREE.MathUtils.degToRad(36));
  const beltHeight = (1 - cos36) / (1 + cos36);

  const belt = [];
  for (let i = 0; i < 10; i++) {
    const angle = THREE.MathUtils.degToRad(i * 36);
    const z = i % 2 === 0 ? -beltHeight : beltHeight;
    belt.push(new THREE.Vector3(beltRadius * Math.cos(angle), beltRadius * Math.sin(angle), z));
  }
  const atBelt = (i) => belt[((i % 10) + 10) % 10];

  const top = new THREE.Vector3(0, 0, 1);
  const bottom = new THREE.Vector3(0, 0, -1);

  const kites = [];
  for (let k = 0; k < 5; k++) {
    // Outward-CCW winding (verified against the antiprism-dual derivation).
    kites.push([top, atBelt(2 * k - 1), atBelt(2 * k), atBelt(2 * k + 1)]);
    kites.push([bottom, atBelt(2 * k + 2), atBelt(2 * k + 1), atBelt(2 * k)]);
  }

  const positions = [];
  for (const [a, b, c, d] of kites) {
    // Fan-triangulate the quad: (a,b,c) + (a,c,d), preserving CCW winding.
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  // Poles vertical (matches how the other dice sit) instead of facing the camera.
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** D10 (pentagonal trapezohedron), 10 kite faces, opposite faces sum to 11. */
export function createD10Type({ textureCellSize } = {}) {
  const geometry = buildD10Geometry();
  return buildDieType({
    geometry,
    verticesPerFace: 6,
    numbering: { oppositeSum: 11 },
    color: DICE_COLORS.D10,
    textureCellSize,
  });
}
