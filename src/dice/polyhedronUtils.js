import * as THREE from "three";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
const EPSILON = 1e-4;

function dedupePositions(points) {
  const unique = [];
  for (const p of points) {
    if (!unique.some((u) => u.distanceToSquared(p) < EPSILON)) unique.push(p);
  }
  return unique;
}

/**
 * For a non-indexed, "face soup" BufferGeometry where each face occupies
 * `verticesPerFace` contiguous vertices (a triangle-fan of that face's
 * polygon — 3 for triangles, 6 for quads, 9 for pentagons split into 3
 * triangles, ...), this:
 *
 *  1. Assigns an "upright" UV mapping per face: the projection of world-up
 *     onto the face plane lands at the top of that face's texture tile, so
 *     every face can reuse the same "number centered on a square canvas"
 *     texture (see textureUtils.js) and still read right-side-up and
 *     un-mirrored once mapped onto the 3D face.
 *  2. Splits the geometry into one material group per face.
 *  3. Returns each face's {centroid, normal}, which callers use for
 *     opposite-face numbering.
 *
 * Reusable across any convex polyhedron die (D4, D6, D8, D10, D12, D20).
 */
export function buildFaceFrames(geometry, verticesPerFace) {
  const position = geometry.getAttribute("position");
  const faceCount = position.count / verticesPerFace;
  const uv = new Float32Array(position.count * 2);
  const frames = [];

  for (let f = 0; f < faceCount; f++) {
    const start = f * verticesPerFace;
    const facePoints = [];
    for (let v = 0; v < verticesPerFace; v++) {
      facePoints.push(new THREE.Vector3().fromBufferAttribute(position, start + v));
    }
    const unique = dedupePositions(facePoints);

    const centroid = unique
      .reduce((acc, p) => acc.add(p), new THREE.Vector3())
      .divideScalar(unique.length);
    const normal = new THREE.Vector3()
      .subVectors(unique[1], unique[0])
      .cross(new THREE.Vector3().subVectors(unique[2], unique[0]))
      .normalize();

    const reference = Math.abs(normal.dot(WORLD_UP)) > 0.999 ? WORLD_FORWARD : WORLD_UP;
    const right = new THREE.Vector3().crossVectors(reference, normal).normalize();
    const up = new THREE.Vector3().crossVectors(normal, right).normalize();

    let maxRadius = 0;
    const local2D = facePoints.map((p) => {
      const d = new THREE.Vector3().subVectors(p, centroid);
      const x = d.dot(right);
      const y = d.dot(up);
      maxRadius = Math.max(maxRadius, Math.hypot(x, y));
      return { x, y };
    });

    const padding = 1.25;
    const scale = 0.5 / (maxRadius * padding);

    for (let v = 0; v < verticesPerFace; v++) {
      const { x, y } = local2D[v];
      uv[(start + v) * 2] = 0.5 + x * scale;
      // Texture.flipY defaults to true, so V=1 already lands at the top of
      // the canvas (row 0) — no manual inversion needed here.
      uv[(start + v) * 2 + 1] = 0.5 + y * scale;
    }

    // Where each DISTINCT corner of this face lands inside its own 0..1 texture
    // tile, paired with the 3D vertex it belongs to. Face-numbered dice ignore
    // this (they only read centroid/normal); vertex-numbered dice (the D4) use
    // it to paint a number beside each corner at exactly the right spot. Same
    // right/up/scale basis as the UV write above, so the two can't drift.
    const corners = unique.map((p) => {
      const d = new THREE.Vector3().subVectors(p, centroid);
      return {
        position: p.clone(),
        u: 0.5 + d.dot(right) * scale,
        v: 0.5 + d.dot(up) * scale,
      };
    });

    frames.push({ centroid, normal, corners });
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));

  geometry.clearGroups();
  for (let f = 0; f < faceCount; f++) {
    geometry.addGroup(f * verticesPerFace, verticesPerFace, f);
  }

  return frames;
}

/**
 * Vertex numbering, for dice read by which CORNER points up rather than which
 * face lies flat (the D4's standard "read the apex" convention).
 *
 * Collects the polyhedron's distinct vertices from the face corners and hands
 * each one a number 1..N. Then, for every face, records which number sits at
 * each of its corners — a face corner simply inherits the number of the vertex
 * it *is*.
 *
 * That inheritance is what enforces the rule this convention depends on: the
 * three faces meeting at a vertex all touch that same vertex, so all three
 * print the same digit around it. Reading the apex therefore gives the same
 * answer from any angle, which is the whole point. It's a consequence of the
 * data model rather than something the texture code has to remember to do.
 *
 * Returns:
 *   vertices   [{ position, number }]  — the die's corners, numbered
 *   faceLabels [[{ u, v, number }]]    — per face, a label per corner (tile UV)
 */
export function numbersFromVertices(frames) {
  const vertices = [];
  const indexOfVertex = (p) => {
    for (let i = 0; i < vertices.length; i++) {
      if (vertices[i].position.distanceToSquared(p) < EPSILON) return i;
    }
    vertices.push({ position: p.clone(), number: vertices.length + 1 });
    return vertices.length - 1;
  };

  const faceLabels = frames.map((frame) =>
    frame.corners.map((corner) => ({
      u: corner.u,
      v: corner.v,
      number: vertices[indexOfVertex(corner.position)].number,
    }))
  );

  return { vertices, faceLabels };
}

/** Pairs each face with its most anti-parallel (geometrically opposite) face. */
export function pairOppositeFaces(frames) {
  const n = frames.length;
  const paired = new Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    if (paired[i] !== -1) continue;
    let best = -1;
    let bestDot = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i || paired[j] !== -1) continue;
      const dot = frames[i].normal.dot(frames[j].normal);
      if (dot < bestDot) {
        bestDot = dot;
        best = j;
      }
    }
    paired[i] = best;
    paired[best] = i;
  }

  return paired;
}

/** Assigns 1..n so that faces paired by pairOppositeFaces() sum to targetSum. */
export function numbersFromOppositeSum(pairing, targetSum) {
  const n = pairing.length;
  const numbers = new Array(n).fill(0);
  const used = new Array(n).fill(false);
  let next = 1;

  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const j = pairing[i];
    numbers[i] = next;
    numbers[j] = targetSum - next;
    used[i] = used[j] = true;
    next++;
  }

  return numbers;
}

export function sequentialNumbers(count) {
  return Array.from({ length: count }, (_, i) => i + 1);
}

/**
 * Remaps each face's independent 0..1 UV tile (set by buildFaceFrames) into
 * its cell of a gridSize x gridSize atlas, so all faces of a die can share
 * ONE texture and ONE material — cutting draw calls from one-per-face to
 * one-per-die. Cell (col, row) is row-major, row 0 at the top of the atlas
 * image; the V flip mirrors the same flipY reasoning buildFaceFrames uses.
 */
export function remapUVsToAtlas(geometry, faceCount, verticesPerFace, gridSize) {
  const uv = geometry.getAttribute("uv");

  for (let f = 0; f < faceCount; f++) {
    const col = f % gridSize;
    const row = Math.floor(f / gridSize);

    for (let v = 0; v < verticesPerFace; v++) {
      const idx = f * verticesPerFace + v;
      const localU = uv.getX(idx);
      const localV = uv.getY(idx);
      uv.setXY(idx, (col + localU) / gridSize, (gridSize - 1 - row + localV) / gridSize);
    }
  }

  uv.needsUpdate = true;
}
