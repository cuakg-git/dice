import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();

/**
 * Reads the value a die is showing, from its current orientation.
 *
 * Face -> number needs no new table: buildDieType() keeps `frames[i]` (the
 * face's centroid + outward normal, in the die's local space) and `numbers[i]`
 * (the number textured onto that same face) as parallel arrays, so whichever
 * face we pick, its number is just `numbers[thatIndex]`. That is the very same
 * mapping the atlas was painted from, so a read can never disagree with what
 * is drawn on the die.
 *
 * Which face counts depends on the shape, via `dieType.valueFace`:
 *
 *  - "up" (D6/D8/D10/D12/D20): these all come to rest lying flat on a face,
 *    with the opposite face horizontal on top. So we take the face whose
 *    world-space normal is most aligned with world up.
 *
 *  - "down" (D4): a tetrahedron has no face on top — it rests ON a face and
 *    points a VERTEX at the sky, which is why a naive "most-up face" read is
 *    always wrong for it. In a tetrahedron every vertex is opposite exactly
 *    one face, so "the vertex pointing up" and "the face lying down" are the
 *    same piece of information; reading the face whose normal points most
 *    DOWNWARD is the same answer as reading the up-vertex, and it needs no
 *    separate vertex table. With one number centred per face (this D4 is
 *    numbered 1-4, one per face), that landed-on face is the die's result.
 *
 * Ambiguity is impossible by construction: this is an argmax over a finite set
 * of faces, so even a die balanced on an edge or a corner — where no face is
 * cleanly up — still yields the single best-aligned face. Ties break toward the
 * lower face index, deterministically. The result is always a real number from
 * the die's own `numbers` table.
 *
 * `quaternion` must be the die's WORLD rotation. Uniform scale is irrelevant
 * (it doesn't change normal directions), and translation can't matter either.
 */
export function readDieValue(dieType, quaternion) {
  const frames = dieType.frames;
  // +1 => most-aligned-with-up face wins; -1 => most-aligned-with-down wins.
  const sign = dieType.valueFace === "down" ? -1 : 1;

  let bestIndex = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < frames.length; i++) {
    _normal.copy(frames[i].normal).applyQuaternion(quaternion);
    const alignment = _normal.dot(UP) * sign;
    if (alignment > bestDot) {
      bestDot = alignment;
      bestIndex = i;
    }
  }
  return dieType.numbers[bestIndex];
}

/** Reads a die record's value from its current world orientation. */
export function readRecordValue(record) {
  record.group.updateWorldMatrix(true, false);
  return readDieValue(record.dieType, record.group.getWorldQuaternion(new THREE.Quaternion()));
}
