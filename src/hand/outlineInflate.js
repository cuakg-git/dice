import * as THREE from "three";

/**
 * Builds an "inflated" copy of `geometry`: every vertex pushed outward by
 * `distance` along a normal that is AVERAGED PER POSITION rather than per
 * vertex-index.
 *
 * Averaging per position (not per index) welds together any vertices that
 * share a location but disagree on normal — the two cases that show up
 * constantly in real meshes: a UV seam (duplicated so the two sides of the
 * wrap can carry different U) and a hard-shaded edge (duplicated so each
 * adjoining face gets its own flat normal). Without the weld, each copy at
 * the seam pushes in a different direction and the shell gapes open right
 * there — a crack in the outline exactly where two faces meet.
 *
 * This is the standard "inverted hull" ink-outline technique: the caller is
 * expected to render the result BackSide in a flat unlit color, so from any
 * angle only its silhouette shows past the real (FrontSide) mesh. Because
 * of that, this function does not bother computing a `normal` attribute for
 * the result — nothing reads it.
 *
 * `geometry` is untouched; a new BufferGeometry is returned with the same
 * topology (same index, same vertex count and order) and only the
 * `position` attribute changed, so it stays trivially cheap to build one of
 * these per part, per instantiation.
 */
export function inflateGeometry(geometry, distance) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const vertexCount = position.count;

  // 1. Group vertex indices by position, quantized to fold together
  //    anything that is the "same point" up to float noise from authoring.
  const keyOf = (i) =>
    `${position.getX(i).toFixed(5)},${position.getY(i).toFixed(5)},${position.getZ(i).toFixed(5)}`;

  const groups = new Map(); // key -> accumulated (unnormalized) face-normal sum
  for (let i = 0; i < vertexCount; i++) {
    const k = keyOf(i);
    if (!groups.has(k)) groups.set(k, new THREE.Vector3());
  }

  // 2. Accumulate each triangle's face normal into every position-group its
  //    three corners belong to. Left unnormalized (cross product, not
  //    cross+normalize) so larger triangles pull harder on the shared
  //    corner's average — the same weighting a smooth-shaded mesh uses.
  const triCount = index ? index.count / 3 : vertexCount / 3;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const indexAt = (n) => (index ? index.getX(n) : n);

  for (let t = 0; t < triCount; t++) {
    const ia = indexAt(t * 3);
    const ib = indexAt(t * 3 + 1);
    const ic = indexAt(t * 3 + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    edgeAB.subVectors(b, a);
    edgeAC.subVectors(c, a);
    faceNormal.crossVectors(edgeAB, edgeAC);

    groups.get(keyOf(ia)).add(faceNormal);
    groups.get(keyOf(ib)).add(faceNormal);
    groups.get(keyOf(ic)).add(faceNormal);
  }

  // 3. Normalize each group's accumulated normal once (degenerate/zero-area
  //    groups — shouldn't happen on a real mesh — fall back to no push).
  for (const normal of groups.values()) {
    if (normal.lengthSq() > 1e-12) normal.normalize();
  }

  // 4. Push every vertex out along its group's welded normal by `distance`.
  const inflated = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const normal = groups.get(keyOf(i));
    inflated[i * 3] = position.getX(i) + normal.x * distance;
    inflated[i * 3 + 1] = position.getY(i) + normal.y * distance;
    inflated[i * 3 + 2] = position.getZ(i) + normal.z * distance;
  }

  const outline = geometry.clone();
  outline.setAttribute("position", new THREE.BufferAttribute(inflated, 3));
  outline.deleteAttribute("normal"); // stale w.r.t. the new positions; nothing reads it (see above)
  outline.computeBoundingSphere();
  outline.computeBoundingBox();
  return outline;
}
