import * as THREE from "three";
import { buildDieType } from "./DieBase.js";
import { DICE_COLORS } from "./diceColors.js";

/** D6 (cube), 6 quad faces, opposite faces sum to 7. */
export function createD6Type({ textureCellSize } = {}) {
  const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  return buildDieType({
    geometry,
    verticesPerFace: 6,
    numbering: { oppositeSum: 7 },
    color: DICE_COLORS.D6,
    textureCellSize,
  });
}
