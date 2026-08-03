import * as THREE from "three";
import { createNumberAtlasTexture, createCornerNumberAtlasTexture } from "./textureUtils.js";
import { DICE_NUMBER_COLOR } from "./diceColors.js";
import {
  buildFaceFrames,
  remapUVsToAtlas,
  pairOppositeFaces,
  numbersFromOppositeSum,
  numbersFromVertices,
  sequentialNumbers,
} from "./polyhedronUtils.js";

const UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_VISUAL_RADIUS = 0.5;

// One edge look shared by every instance of every die type — edges aren't
// tinted per instance, so there's no reason to allocate 60 copies of it.
const SHARED_EDGE_MATERIAL = new THREE.LineBasicMaterial({
  color: 0x1a1f26,
  transparent: true,
  opacity: 0.35,
});

// A generic invisible sphere reused as the raycast target for every die
// instance of every type — its per-instance scale (see applyHitboxRadius)
// is what actually gives each die its tap/click area, independent of how
// small its real silhouette is (a tetrahedron's mesh covers much less of
// its own bounding sphere than, say, a D20's).
const HITBOX_GEOMETRY = new THREE.SphereGeometry(1, 8, 6);
const HITBOX_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

/**
 * Builds the resources shared by every instance of one die type: geometry,
 * face numbering, a single atlas texture holding all of its numbers, and one
 * material (so instances never regenerate/duplicate either — every die of
 * this type is now visually identical, since color is fixed per type rather
 * than randomized per instance). Call this once per type.
 */
export function buildDieType({
  geometry,
  verticesPerFace,
  numbering = "sequential",
  color, // this type's fixed body color (see diceColors.js) — REQUIRED, baked into the atlas below
  textColor = DICE_NUMBER_COLOR,
  textureCellSize = 128,
  // Which face carries the result once the die is at rest (see dieValue.js).
  // Everything that settles flat on a face reads the face on TOP; the
  // tetrahedron rests ON a face and points a vertex up, so it reads the face
  // underneath instead.
  valueFace = "up",
}) {
  const frames = buildFaceFrames(geometry, verticesPerFace);
  const faceCount = frames.length;
  const isVertexNumbered = numbering === "vertex";

  // Vertex-numbered dice put a number on each CORNER of each face (three per
  // triangular face) instead of one in the middle; `numbers` (a per-face
  // array) simply doesn't apply to them, so it stays empty and `vertices`
  // carries the numbering instead.
  const vertexNumbering = isVertexNumbered ? numbersFromVertices(frames) : null;
  const numbers = isVertexNumbered
    ? []
    : numbering === "sequential"
      ? sequentialNumbers(faceCount)
      : numbersFromOppositeSum(pairOppositeFaces(frames), numbering.oppositeSum);

  const gridSize = Math.ceil(Math.sqrt(faceCount));
  remapUVsToAtlas(geometry, faceCount, verticesPerFace, gridSize);
  // The body color is painted directly into this texture's background (not
  // applied as a separate material tint) so the numbers' dark ink is baked in
  // as real contrast against it — see textureUtils.js for why that has to be
  // multiplicative (part of the same map) rather than an additive emissive
  // trick, which can only brighten a surface, never darken it.
  const atlasTexture = isVertexNumbered
    ? createCornerNumberAtlasTexture({
        faceLabels: vertexNumbering.faceLabels,
        gridSize,
        bgColor: color,
        textColor,
        cellSize: textureCellSize,
      })
    : createNumberAtlasTexture({ numbers, gridSize, bgColor: color, textColor, cellSize: textureCellSize });

  geometry.computeBoundingSphere();
  const boundingRadius = geometry.boundingSphere?.radius || 1;
  const edgesGeometry = new THREE.EdgesGeometry(geometry, 1);

  // One material for every instance of this type: color now comes entirely
  // from the baked-in map above, so there's nothing left to vary per
  // instance (material.color stays at its default white/1,1,1 — i.e. no
  // additional tint — so the map's baked colors reach the screen unaltered
  // apart from normal lighting).
  const material = new THREE.MeshStandardMaterial({
    map: atlasTexture,
    roughness: 0.5,
    metalness: 0.05,
  });

  // A single, non-random orientation used whenever a die needs to sit "tidy"
  // (the selection tray), identical for every instance of the type. Face-
  // numbered dice put face "1" flat on top facing the (zenithal) camera.
  // Vertex-numbered dice instead aim vertex "1" straight up — which is both
  // the number this convention reads AND a pose that actually rests on a
  // face, since the opposite face ends up flat on the table.
  const standardQuaternion = new THREE.Quaternion();
  if (isVertexNumbered) {
    const apex = vertexNumbering.vertices.find((v) => v.number === 1);
    standardQuaternion.setFromUnitVectors(apex.position.clone().normalize(), UP);
  } else {
    const standardFaceIndex = numbers.indexOf(1);
    standardQuaternion.setFromUnitVectors(frames[standardFaceIndex].normal.clone().normalize(), UP);
  }

  return {
    geometry,
    edgesGeometry,
    faceCount,
    frames,
    numbers,
    // Only present on vertex-numbered dice: [{ position, number }] for each
    // corner, which is what dieValue reads to find the apex. Undefined
    // elsewhere, so a face-numbered die can never accidentally take that path.
    vertices: vertexNumbering ? vertexNumbering.vertices : undefined,
    valueFace,
    boundingRadius,
    atlasTexture,
    material,
    standardQuaternion,
  };
}

/**
 * How far to lift a die (given a rotation + uniform scale) so the lowest
 * point of its geometry touches y=0 — exact for any shape, unlike
 * approximating with the bounding radius (which would leave spikier shapes
 * like D4/D10 floating or sinking).
 */
export function computeRestY(dieType, quaternion, scale) {
  const position = dieType.geometry.getAttribute("position");
  const vertex = new THREE.Vector3();
  let minY = Infinity;
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i).applyQuaternion(quaternion).multiplyScalar(scale);
    if (vertex.y < minY) minY = vertex.y;
  }
  return -minY;
}

/**
 * Creates one die instance at a resting pose: a random face points straight
 * up at the (zenithal) camera — so some legible number is always visible
 * from directly above, for every die shape including ones like D4 that
 * have no face-to-face symmetry — with a random spin around the vertical
 * axis for visual variety, lifted so its lowest point sits at y=0.
 *
 * Every instance of a type shares dieType.material (same body color, same
 * baked-in numbers) — there is no more per-instance color to set here.
 */
export function createDieInstance(dieType, { x = 0, z = 0, visualRadius = DEFAULT_VISUAL_RADIUS } = {}) {
  const scale = visualRadius / dieType.boundingRadius;

  const mesh = new THREE.Mesh(dieType.geometry, dieType.material);
  const edges = new THREE.LineSegments(dieType.edgesGeometry, SHARED_EDGE_MATERIAL);
  const hitbox = new THREE.Mesh(HITBOX_GEOMETRY, HITBOX_MATERIAL);
  hitbox.visible = false; // raycast target only — never drawn, so it costs nothing to render

  const group = new THREE.Group();
  group.add(mesh);
  group.add(edges);
  group.add(hitbox);
  group.scale.setScalar(scale);

  const restFaceIndex = Math.floor(Math.random() * dieType.faceCount);
  const localNormal = dieType.frames[restFaceIndex].normal.clone().normalize();
  const qAlign = new THREE.Quaternion().setFromUnitVectors(localNormal, UP);
  const qYaw = new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2);
  group.quaternion.multiplyQuaternions(qYaw, qAlign);

  group.position.set(x, computeRestY(dieType, group.quaternion, scale), z);

  return { group, mesh, hitbox, scale };
}

/** Uniform scale that makes a die type's geometry (boundingRadius=1-ish) render at a given world radius. */
export function scaleForRadius(dieType, radius) {
  return radius / dieType.boundingRadius;
}

/**
 * Sets a die's tap/click hitbox to an absolute world-space radius,
 * independent of the die's own visual scale (which the hitbox, as a child
 * of `group`, would otherwise inherit) — used to guarantee a minimum touch
 * target size that holds regardless of zoom level.
 */
export function applyHitboxRadius(hitbox, dieScale, worldRadius) {
  hitbox.scale.setScalar(worldRadius / dieScale);
}
