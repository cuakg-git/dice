import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { inflateGeometry } from "./outlineInflate.js";

/**
 * Builds a hand rig from a GLB authored per RIG_SPEC.md, as an alternative
 * geometry source to the procedural capsule builder in Hand.js. Returns the
 * EXACT SAME contract as createHand(): { root, holdAnchor, setFingerCurl,
 * setPose, fingerCount }. See handSkins.js for the registry/dispatcher that
 * picks between this and the procedural builder.
 *
 * Deliberately does NOT import anything from Hand.js: the procedural rig is
 * calibrated and in production, and the user asked not to touch it even for
 * conceptual consistency (RIG_SPEC S1.1). The few values shared in spirit
 * (curl targets, toon gradient steps) are duplicated here on purpose, each
 * with a comment pointing at its Hand.js counterpart, rather than adding an
 * import edge into the file everyone agreed to leave alone.
 */

// Must match Hand.js:12-14 (CURL_KNUCKLE/CURL_MID/CURL_TIP). Duplicated
// rather than imported — see file comment above.
const CURL_KNUCKLE = 1.35;
const CURL_MID = 1.5;
const CURL_TIP = 0.9;
const CURL_TARGETS = [CURL_KNUCKLE, CURL_MID, CURL_TIP];

// Same rest pose as Hand.js's REST const (Hand.js:193): a whisper of flexion
// so an unposed hand reads relaxed, not starfish, before HandCursor's first
// setFingerCurl() call each frame.
const REST_CURLS = [0.08, 0.06, 0.05, 0.06, 0.08];

// Must match Hand.js:25 (the 3-step toon gradient). Duplicated for the same
// reason as the curl targets above.
const GRADIENT_STEPS = new Uint8Array([175, 235, 255]);

function makeGradientMap() {
  const map = new THREE.DataTexture(GRADIENT_STEPS, GRADIENT_STEPS.length, 1, THREE.RedFormat);
  map.minFilter = THREE.NearestFilter;
  map.magFilter = THREE.NearestFilter;
  map.needsUpdate = true;
  return map;
}

// Placeholder colors from Fase 4 (RIG_SPEC S9): the GLB's own baked
// materials are throwaway placeholders — real materials are always assigned
// here, at load time, never read off the file.
const COLOR_BODY = 0x5e9440;
const COLOR_NAIL = 0xe8dfc0;
const COLOR_BONE = 0xf2ecda;

/**
 * `flipped`: whether THIS instance ends up with a negative-determinant world
 * matrix — see buildHandFromTemplate for why that is NOT simply the caller's
 * `mirrored` flag. Side must track the actual determinant sign, exactly like
 * Hand.js's own makeToonMaterial does (see its comment at Hand.js:30-37):
 * DoubleSide re-orients the flipped normals toward the camera; FrontSide is
 * enough (and cheaper) when nothing is flipped.
 */
function makeToonMaterial(colorHex, flipped) {
  return new THREE.MeshToonMaterial({
    color: colorHex,
    gradientMap: makeGradientMap(),
    side: flipped ? THREE.DoubleSide : THREE.FrontSide,
  });
}

// Same inverted-hull outline technique as Hand.js (see its comment at
// Hand.js:45-50): BackSide-only inflated copy, so only the silhouette rings
// the body. Shared OUTLINE_MATERIAL — it's flat unlit black either way, no
// per-instance state needed.
const OUTLINE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x0d0d0d, side: THREE.BackSide });

function materialFor(nodeName, materials) {
  if (nodeName.endsWith("_una")) return materials.nail;
  if (nodeName === "muneca_hueso") return materials.bone;
  return materials.body;
}

function addOutline(mesh, ink) {
  const outline = new THREE.Mesh(inflateGeometry(mesh.geometry, ink), OUTLINE_MATERIAL);
  mesh.add(outline);
}

// RIG_SPEC S2.1/S5: finger index order is fixed, 0=pulgar..4=menique. Joint
// names are the ones verified against the exported GLB in Fase 3/5 — thumb
// has 2 joints (no falange3Joint), the rest have 3.
const FINGER_ORDER = ["pulgar", "indice", "medio", "anular", "menique"];
const FINGER_JOINT_NAMES = {
  pulgar: ["pulgar_metacarpo", "pulgar_falange2Joint"],
  indice: ["indice_metacarpo", "indice_falange2Joint", "indice_falange3Joint"],
  medio: ["medio_metacarpo", "medio_falange2Joint", "medio_falange3Joint"],
  anular: ["anular_metacarpo", "anular_falange2Joint", "anular_falange3Joint"],
  menique: ["menique_metacarpo", "menique_falange2Joint", "menique_falange3Joint"],
};

/**
 * `template`: the GLTF scene root as resolved by loadHandTemplate() — shared
 * and read-only. Each call clones it into an independent hierarchy, so two
 * hands (e.g. HandCursor's right cursor + left cup hand) never share mutable
 * state even though they share the same source geometry/template.
 */
export function buildHandFromTemplate(template, { outlineWidth = 0.055, mirrored = false } = {}) {
  const ink = outlineWidth;
  const root = template.clone(true);
  root.name = mirrored ? "manoEspejo" : "mano";

  // RIG_SPEC S1.1 — the load-bearing decision of this file. The GLB is
  // authored as a genuine right hand (thumb at -X). The PROCEDURAL rig's
  // *unmirrored* pose has the thumb at +X — a known lateral inversion, kept
  // as-is because the user chose not to touch the calibrated procedural rig
  // (Fase 1 approval). For this skin to land on the SAME world-space
  // convention HandCursor already assumes (cup rotations, thumb-splay
  // folding, etc. were all solved against that convention), the flip here is
  // the OPPOSITE of what Hand.js does with its own `mirrored` flag:
  //   mirrored=false (the visible cursor hand) -> FLIP (thumb -X -> +X, to
  //     match the procedural rig's own, anatomically-backwards, "unmirrored")
  //   mirrored=true  (the cup's other hand)     -> leave as authored
  //     (already -X, which is what the procedural rig's mirrored -X lands on)
  // Copying Hand.js's `mirrored ? -1 : 1` verbatim here would be WRONG and
  // exactly the trap this comment exists to prevent.
  const flipped = !mirrored;
  if (flipped) root.scale.x = -1;

  const materials = {
    body: makeToonMaterial(COLOR_BODY, flipped),
    nail: makeToonMaterial(COLOR_NAIL, flipped),
    bone: makeToonMaterial(COLOR_BONE, flipped),
  };

  // Snapshot the mesh list BEFORE touching anything: traverse() walks
  // children live, and addOutline() adds a new child mesh to each one we
  // process. Calling addOutline inside the traverse callback itself would
  // make that recursion visit the outline mesh it just added too — which
  // isn't `_una`/`muneca_hueso`, so it would get a body material and ANOTHER
  // outline, forever. (Caught by __test_glbskin.mjs: stack overflow.)
  const bodyMeshes = [];
  root.traverse((obj) => {
    if (obj.isMesh) bodyMeshes.push(obj);
  });
  for (const obj of bodyMeshes) {
    obj.material = materialFor(obj.name, materials);
    addOutline(obj, ink);
  }

  const holdAnchor = root.getObjectByName("agarre");
  if (!holdAnchor) throw new Error('glbHandSkin: nodo "agarre" no encontrado en el GLB');
  if (!root.getObjectByName("pulgarBase")) {
    throw new Error('glbHandSkin: nodo "pulgarBase" no encontrado en el GLB (HandCursor lo requiere)');
  }

  const fingerJoints = FINGER_ORDER.map((finger) =>
    FINGER_JOINT_NAMES[finger].map((name) => {
      const node = root.getObjectByName(name);
      if (!node) throw new Error(`glbHandSkin: joint "${name}" no encontrado en el GLB`);
      return node;
    })
  );

  const curls = REST_CURLS.slice();

  function applyCurl(fingerIndex) {
    const t = curls[fingerIndex];
    fingerJoints[fingerIndex].forEach((joint, j) => {
      joint.rotation.x = t * CURL_TARGETS[j];
    });
  }

  function setFingerCurl(fingerIndex, amount) {
    curls[fingerIndex] = THREE.MathUtils.clamp(amount, 0, 1);
    applyCurl(fingerIndex);
  }

  function setPose({ curls: newCurls } = {}) {
    if (newCurls) newCurls.forEach((value, i) => value !== undefined && setFingerCurl(i, value));
  }

  fingerJoints.forEach((_, i) => applyCurl(i));

  return { root, holdAnchor, setFingerCurl, setPose, fingerCount: FINGER_ORDER.length };
}

const loader = new GLTFLoader();
const templatesByUrl = new Map(); // url -> Promise<Object3D>, memoized

/**
 * Loads (and memoizes, by url) a GLB's scene root. Returns a Promise —
 * callers needing createHand()'s synchronous contract must await this
 * BEFORE building any hand from it (see handSkins.js's preloadHandSkin).
 */
export function loadHandTemplate(url) {
  if (!templatesByUrl.has(url)) {
    templatesByUrl.set(
      url,
      new Promise((resolve, reject) => {
        loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
      })
    );
  }
  return templatesByUrl.get(url);
}
