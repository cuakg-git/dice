import * as THREE from "three";
import { buildDieType } from "./DieBase.js";
import { DICE_COLORS } from "./diceColors.js";

/** D8 (octahedron), 8 triangular faces, opposite faces sum to 9. */
export function createD8Type({ textureCellSize } = {}) {
  const geometry = new THREE.OctahedronGeometry(1, 0);
  return buildDieType({
    geometry,
    verticesPerFace: 3,
    numbering: { oppositeSum: 9 },
    color: DICE_COLORS.D8,
    textureCellSize,
  });
}
