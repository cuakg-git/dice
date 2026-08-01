import * as THREE from "three";
import { buildDieType } from "./DieBase.js";
import { DICE_COLORS } from "./diceColors.js";

/**
 * D12 (dodecahedron), 12 pentagonal faces (each pre-triangulated into 3
 * triangles by three.js, 9 vertices/face), opposite faces sum to 13.
 */
export function createD12Type({ textureCellSize } = {}) {
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  return buildDieType({
    geometry,
    verticesPerFace: 9,
    numbering: { oppositeSum: 13 },
    color: DICE_COLORS.D12,
    textureCellSize,
  });
}
