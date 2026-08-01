import * as THREE from "three";
import { buildDieType } from "./DieBase.js";
import { DICE_COLORS } from "./diceColors.js";

/** D20 (icosahedron), 20 triangular faces, opposite faces sum to 21. */
export function createD20Type({ textureCellSize } = {}) {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  return buildDieType({
    geometry,
    verticesPerFace: 3,
    numbering: { oppositeSum: 21 },
    color: DICE_COLORS.D20,
    textureCellSize,
  });
}
