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
 *  - "vertex" (D4): a tetrahedron has no face on top — it rests ON a face and
 *    points a VERTEX at the sky, which is why a naive "most-up face" read is
 *    always wrong for it. This D4 uses the standard corner-numbered
 *    convention: three numbers per face, one beside each corner, with all
 *    three faces meeting at a vertex printing that vertex's number. The
 *    result is the number at the APEX — so we look through the die's corners
 *    (not its faces) and take the highest one after rotation.
 *
 * Ambiguity is impossible by construction: both branches are an argmax over a
 * finite set (faces, or corners), so even a die balanced on an edge — where
 * nothing is cleanly up — still yields a single best candidate. Ties break
 * toward the lower index, deterministically. The result is always a real
 * number from the die's own table.
 *
 * `quaternion` must be the die's WORLD rotation. Uniform scale is irrelevant
 * (it scales every candidate equally, so the argmax is unchanged), and
 * translation can't matter either.
 */
export function readDieValue(dieType, quaternion) {
  if (dieType.valueFace === "vertex") {
    // Highest CORNER after rotation — the apex the player reads.
    const vertices = dieType.vertices;
    let bestIndex = 0;
    let bestHeight = -Infinity;
    for (let i = 0; i < vertices.length; i++) {
      _normal.copy(vertices[i].position).applyQuaternion(quaternion);
      if (_normal.y > bestHeight) {
        bestHeight = _normal.y;
        bestIndex = i;
      }
    }
    return vertices[bestIndex].number;
  }

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
