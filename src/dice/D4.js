import * as THREE from "three";
import { buildDieType } from "./DieBase.js";
import { DICE_COLORS } from "./diceColors.js";

/**
 * D4 (tetrahedron), 4 triangular faces, numbered at the CORNERS — the
 * standard "read the apex" convention you see on physical d4s.
 *
 * A tetrahedron at rest has no face on top: it lands flat on one face and
 * points a vertex at the sky. So instead of one number per face, each of the
 * 4 vertices owns a number (1-4), and every face prints its three vertices'
 * numbers beside the matching corners. Because the three faces meeting at a
 * vertex all print that vertex's number, the apex reads the same from any
 * angle — and that apex number is the roll. See numbersFromVertices() in
 * polyhedronUtils.js for the numbering and dieValue.js for the read.
 */
export function createD4Type({ textureCellSize = 128 } = {}) {
  const geometry = new THREE.TetrahedronGeometry(1, 0);
  return buildDieType({
    geometry,
    verticesPerFace: 3,
    numbering: "vertex",
    color: DICE_COLORS.D4,
    // Double the shared base resolution (the other 5 dice keep it as-is):
    // this atlas packs THREE rotated glyphs per face instead of one centred
    // one, so it needs more pixels per face to stay crisp at the same
    // on-screen size — see createCornerNumberAtlasTexture's own defaults for
    // the font-size/placement side of this same legibility pass.
    textureCellSize: textureCellSize * 2,
    valueFace: "vertex",
  });
}
