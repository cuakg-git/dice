import * as THREE from "three";
import { buildDieType } from "./DieBase.js";
import { DICE_COLORS } from "./diceColors.js";

/**
 * D4 (tetrahedron), 4 triangular faces, one number per face (1-4).
 *
 * Unlike every other die here, a tetrahedron at rest has no face on top — it
 * lands flat on one face with a vertex aimed at the camera. With the number
 * centred on each face, the result is therefore the face it came to rest ON,
 * i.e. the one facing DOWN (equivalently: the face opposite the up-vertex).
 * See dieValue.js.
 */
export function createD4Type({ textureCellSize } = {}) {
  const geometry = new THREE.TetrahedronGeometry(1, 0);
  return buildDieType({
    geometry,
    verticesPerFace: 3,
    numbering: "sequential",
    color: DICE_COLORS.D4,
    textureCellSize,
    valueFace: "down",
  });
}
