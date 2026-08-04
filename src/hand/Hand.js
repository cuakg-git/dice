import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { inflateGeometry } from "./outlineInflate.js";

// Comic-style hand: flat white toon fill + thick black ink outline
// (inverted hull). All proportions eyeballed from the reference sketch:
// chunky palm, stubby rounded fingers, open relaxed pose, thumb out to the
// side. Palm faces +Z (the camera), fingers point +Y.

// Full-curl target angles per joint (radians). The knuckle bends most,
// the tip least — interpolating all three by one 0..1 amount reads as a
// natural fist closing from the knuckle, because pivots sit at the joints.
const CURL_KNUCKLE = 1.35;
const CURL_MID = 1.5;
const CURL_TIP = 0.9;

const PALM_W = 1.6;
const PALM_H = 1.7;
const PALM_D = 0.55;

function makeToonMaterial(mirrored) {
  // 3-step gradient: shadow / mid / light. Coarse steps are what sell the
  // flat comic shading instead of a smooth realistic falloff. Steps skew
  // bright so the fill reads as white-on-paper like the sketch, with the
  // shadow step only appearing at grazing angles.
  const steps = new Uint8Array([175, 235, 255]);
  const gradientMap = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  // A mirrored rig (negative X scale) reverses triangle winding AND flips the
  // interpolated normals. three.js already compensates the winding for a
  // negative-determinant world matrix (it flips gl.frontFace), so culling is
  // fine on its own — but the flipped normals would light the toon fill from
  // the inside. DoubleSide makes the shader re-orient the normal per face
  // toward the camera (faceDirection), so the flat shading comes out
  // identical to the right hand. FrontSide is enough (and cheaper) for the
  // one-sided right rig.
  return new THREE.MeshToonMaterial({
    color: 0xffffff,
    gradientMap,
    side: mirrored ? THREE.DoubleSide : THREE.FrontSide,
  });
}

// Inverted-hull outline: the inflated copy is drawn far-side-only so just its
// silhouette rings the body. "Far side" = BackSide, and because three.js
// flips gl.frontFace for the mirror, BackSide keeps selecting the far faces
// on the left hand too — so the SAME shared material gives an identical thin
// outline on both hands (an explicit FrontSide here would instead fill the
// whole silhouette solid black).
const OUTLINE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x0d0d0d, side: THREE.BackSide });

/**
 * A body mesh plus its ink outline: the outline is a second mesh built from
 * an *inflated copy* of the geometry (see outlineInflate.js — vertices
 * pushed out along position-welded normals, not a uniform scale, so the
 * stroke width doesn't depend on the part's size), rendered inside-out in
 * black so only its silhouette shows around the body from any angle.
 */
function inkedMesh(geometry, material, ink) {
  const mesh = new THREE.Mesh(geometry, material);
  const outline = new THREE.Mesh(inflateGeometry(geometry, ink), OUTLINE_MATERIAL);
  mesh.add(outline);
  return mesh;
}

/**
 * One finger = a chain of joint Groups, each pivoting AT the articulation
 * (base of its phalanx), with the capsule mesh offset by half its length so
 * it extends outward from the pivot:
 *
 *   metacarpo (Group, pivot at the palm knuckle)
 *   └─ falange1 (Mesh) + falange2Joint (Group, pivot at 1st interphalangeal)
 *      └─ falange2 (Mesh) + falange3Joint (Group, pivot at 2nd)
 *         └─ falange3 (Mesh)
 *
 * Rotating a joint Group therefore flexes everything distal to it around
 * the articulation, like a real finger.
 */
function buildFinger({ radius, lengths, material, ink }) {
  const joints = [];
  let parent = null;
  let root = null;

  lengths.forEach((len, i) => {
    const joint = new THREE.Group();
    joint.name = i === 0 ? "metacarpo" : `falange${i + 1}Joint`;
    const phalanx = inkedMesh(new THREE.CapsuleGeometry(radius, len, 4, 12), material, ink);
    phalanx.name = `falange${i + 1}`;
    phalanx.position.y = len / 2; // capsule grows outward from the joint pivot
    joint.add(phalanx);

    if (parent) {
      joint.position.y = lengths[i - 1]; // next pivot sits at the end of the previous phalanx
      parent.add(joint);
    } else {
      root = joint;
    }
    parent = joint;
    joints.push(joint);
  });

  return { root, joints };
}

/**
 * Builds the hand rig. Returns:
 *  - root: THREE.Group to add to a scene (rotate this for whole-hand pose)
 *  - setFingerCurl(i, amount): flex finger i (0=pulgar, 1=índice, 2=medio,
 *    3=anular, 4=meñique) by amount 0..1, interpolating every joint of that
 *    finger from its open rest angle toward the fist target.
 *  - setPose({ curls }): array shorthand for all five curls at once.
 *  - holdAnchor: an empty Group sitting just off the palm's front face —
 *    parent a die to it to have the hand carry it (see HandCursor.js).
 */
export function createHand({ outlineWidth = 0.055, mirrored = false } = {}) {
  const ink = outlineWidth;
  const material = makeToonMaterial(mirrored);
  const root = new THREE.Group();
  root.name = mirrored ? "manoEspejo" : "mano";
  // Reflect across X to make a left hand from the right rig. Every child
  // position/rotation is authored once for the right hand and simply
  // inherits this flip — no separate geometry (see material notes above for
  // how the winding/normal reversal is corrected).
  if (mirrored) root.scale.x = -1;

  // --- Palm ------------------------------------------------------------
  const palm = inkedMesh(new RoundedBoxGeometry(PALM_W, PALM_H, PALM_D, 4, 0.22), material, ink);
  palm.name = "palma";
  root.add(palm);

  // Stubby wrist peeking out below, like the two little strokes in the sketch.
  const wrist = inkedMesh(new THREE.CapsuleGeometry(0.3, 0.35, 4, 12), material, ink);
  wrist.name = "muñeca";
  wrist.position.set(0, -PALM_H / 2 - 0.12, 0);
  root.add(wrist);

  // Where a carried die sits: centred on the palm, just off its front face
  // (the palm faces +Z in model space). HandCursor parents the die here.
  const holdAnchor = new THREE.Group();
  holdAnchor.name = "agarre";
  holdAnchor.position.set(0, 0.1, PALM_D / 2);
  root.add(holdAnchor);

  // --- Fingers (índice..meñique), thumb-side = +X ----------------------
  const fingerDefs = [
    { x: 0.58, radius: 0.155, lengths: [0.42, 0.3, 0.22], splay: -0.07 }, // índice
    { x: 0.2, radius: 0.16, lengths: [0.48, 0.34, 0.24], splay: -0.02 }, // medio
    { x: -0.19, radius: 0.15, lengths: [0.44, 0.31, 0.22], splay: 0.05 }, // anular
    { x: -0.57, radius: 0.125, lengths: [0.3, 0.22, 0.17], splay: 0.14 }, // meñique
  ];

  const fingers = []; // [{ joints, restAngles }]

  for (const def of fingerDefs) {
    const { root: fingerRoot, joints } = buildFinger({ radius: def.radius, lengths: def.lengths, material, ink });
    fingerRoot.position.set(def.x, PALM_H / 2 - 0.05, 0.02);
    fingerRoot.rotation.z = def.splay; // slight natural spread
    root.add(fingerRoot);
    fingers.push({ joints });
  }

  // --- Thumb: 2 phalanges, splayed out to the +X side ------------------
  const thumbRoot = new THREE.Group();
  thumbRoot.name = "pulgarBase";
  thumbRoot.position.set(PALM_W / 2 - 0.12, 0.05, 0.12);
  thumbRoot.rotation.z = -0.8; // points up-and-out like the sketch
  thumbRoot.rotation.y = 0.35; // slightly opposed toward the palm plane
  const { root: thumbChain, joints: thumbJoints } = buildFinger({
    radius: 0.185,
    lengths: [0.45, 0.32],
    material,
    ink,
  });
  thumbRoot.add(thumbChain);
  root.add(thumbRoot);

  // Finger order per spec examples: 0=pulgar, 1..4 = índice..meñique.
  const allFingers = [{ joints: thumbJoints }, ...fingers];

  // Open-hand rest: a whisper of flexion so it reads relaxed, not starfish.
  const REST = [0.08, 0.06, 0.05, 0.06, 0.08];
  const curls = REST.slice();

  function applyCurl(fingerIndex) {
    const { joints } = allFingers[fingerIndex];
    const t = curls[fingerIndex];
    const targets = [CURL_KNUCKLE, CURL_MID, CURL_TIP];
    joints.forEach((joint, j) => {
      joint.rotation.x = t * targets[j];
    });
  }

  function setFingerCurl(fingerIndex, amount) {
    curls[fingerIndex] = THREE.MathUtils.clamp(amount, 0, 1);
    applyCurl(fingerIndex);
  }

  function setPose({ curls: newCurls } = {}) {
    if (newCurls) newCurls.forEach((value, i) => value !== undefined && setFingerCurl(i, value));
  }

  allFingers.forEach((_, i) => applyCurl(i));

  return { root, holdAnchor, setFingerCurl, setPose, fingerCount: allFingers.length };
}
