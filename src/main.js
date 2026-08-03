import * as THREE from "three";
import { createScene } from "./scene.js";
import { createD4Type } from "./dice/D4.js";
import { createD6Type } from "./dice/D6.js";
import { createD8Type } from "./dice/D8.js";
import { createD10Type } from "./dice/D10.js";
import { createD12Type } from "./dice/D12.js";
import { createD20Type } from "./dice/D20.js";
import { createDieInstance, computeRestY, applyHitboxRadius, scaleForRadius } from "./dice/DieBase.js";
import { buildZones, samplePointsInZone } from "./tableLayout.js";
import { createSlotGrid } from "./traySlots.js";
import { animateTransform, updateTweens, cancelTween, easeOutCubic } from "./animation.js";
import { setupInteraction } from "./interaction.js";
import { getSelection, isSelected, selectDie, deselectDie, addHeldDie, removeHeldDie, clearHeldDice } from "./state/selection.js";
import { readRecordValue } from "./dice/dieValue.js";
import { addRoll } from "./state/rollLog.js";
import { createThrowBatcher } from "./state/throwBatches.js";
import { createRollLogPanel } from "./ui/rollLogPanel.js";
import { createDiscordPanel, isDiscordModalOpen, subscribeDiscordModalOpen } from "./ui/discordPanel.js";
import { isConnected, getWebhookUrl, sendWebhookPayload } from "./state/discordWebhook.js";
import { buildRollWebhookPayload } from "./state/discordMessage.js";
import { getBreakpoint, isTouchDevice } from "./responsive.js";
import { createDicePhysics } from "./physics/DicePhysics.js";
import { createHandCursor, gripCurlForDie, inradiusFraction } from "./hand/HandCursor.js";
import { HAND_CONFIG } from "./hand/handConfig.js";
import { createLaunchEffects } from "./effects/launchEffects.js";
import { initNameGate, isModalOpen, subscribeModalOpen } from "./ui/nameGate.js";
import { getStoredName, subscribeName } from "./state/userName.js";

// Wired up first, synchronously, before anything below that might take a
// moment (Rapier's WASM init in particular) — so a first-time visitor sees
// the "what's your name" modal immediately rather than staring at a blank
// frame while physics loads in the background.
initNameGate();

// Same reasoning, same urgency: #app.layout-mobile is what CSS keys the
// roll-log's desktop-fixed-column vs mobile-sidesheet split on (see
// style.css), so it has to be correct BEFORE the browser's first paint — a
// raw CSS media query can't reproduce getBreakpoint()'s portrait-aware
// mobile test (a narrow but landscape window is still "desktop" here), so
// this has to be a JS-driven class, kept in sync on every later resize too
// (see the call inside rebuildLayout() below).
const appEl = document.getElementById("app");
function syncLayoutModeClass() {
  appEl.classList.toggle("layout-mobile", getBreakpoint() === "mobile");
}
syncLayoutModeClass();

const DIE_TYPES = [
  { name: "D4", build: createD4Type },
  { name: "D6", build: createD6Type },
  { name: "D8", build: createD8Type },
  { name: "D10", build: createD10Type },
  { name: "D12", build: createD12Type },
  { name: "D20", build: createD20Type },
];

const DICE_PER_ZONE = 10;
const SOURCE_RATIO = 0.2; // the source strip's share of the screen — 20%; the throw board gets the rest

// Source-strip dice are small (they just need to be pickable and legible in
// a compact zone); the throw board's dice are the "hero" size, and on
// mobile that hero size is doubled per spec.
// The source-strip die size is now per-breakpoint (see BOARD_TUNING's
// sourceDieRadius) so desktop can grow it without touching mobile. Dice are
// created at this baseline and rescaled to the live source size in
// rebuildLayout. Packing distances are multiples of the *current* source
// radius (kept as factors here), so a bigger die automatically packs looser
// and the no-overlap floor still holds.
const SOURCE_DIE_RADIUS = 0.28; // creation baseline (mobile's size)
const SOURCE_MIN_DISTANCE_FACTOR = 2.4; // comfortable spacing target
const SOURCE_ZONE_MARGIN_FACTOR = 1.6;
const SOURCE_OVERLAP_FLOOR_FACTOR = 2.1; // 2r + slack: the actual no-overlap distance

// Per-breakpoint tuning for the throw board: die size plus the physics
// parameters that scale with it (thrown mustn't feel floatier/heavier just
// because the geometry got bigger). Friction/restitution/density are
// intrinsic material properties and don't need to scale with size — Rapier
// already derives more mass for a bigger hull at the same density, which is
// physically correct (a bigger die IS heavier). Damping *does* need to go up
// for the 2x mobile board: a bigger die falls from a proportionally taller
// drop/wall height (see *_HEIGHT_RATIO below) and carries more energy per
// throw, so without more damping it took 4-5s to settle instead of 1-3s.
// dropHeightRatio/wallHeightRatio are intentionally *not* the same multiple
// of dieRadius on both boards: naively scaling them 1:1 with the 2x radius
// gave the mobile board 2x the vertical room to bounce/tumble in *and* 2x
// the fall distance, which compounded into a 4-5s settle instead of 1-3s.
// Trimming both ratios (while keeping the higher damping above) gets the
// die back to a natural-feeling, proportionally-sized toss that still
// settles quickly.
const BOARD_TUNING = {
  desktop: {
    // Dice are ~1.5x bigger than before (0.4 -> 0.6) so the numbers read
    // clearly. Everything below is recalibrated to keep the SAME throw feel at
    // the new size — the recipe follows the mobile 2x board's precedent:
    //  - height ratios are multiples of dieRadius, so the absolute drop/wall
    //    heights would balloon 1.5x if left alone; they're trimmed so a bigger,
    //    heavier die doesn't fall from proportionally higher and take longer to
    //    settle (verified with a headless Rapier settle test: ~1-2.5s, same as
    //    the old 0.4 board).
    //  - damping is raised (heavier die carries more energy per throw), again
    //    interpolating toward the mobile values.
    //  - torqueFactor is lowered: roll angvel = speed * torqueFactor, and for a
    //    bigger die the same angular rate covers more ground, so it's reduced
    //    ~1/scale so a throw rolls a natural distance (mobile does the same).
    //  - velocity-based knobs (maxThrowSpeed, the flick gesture thresholds) are
    //    unchanged: the board is the same world size and the gesture is the
    //    same, so entry speeds stay as they were.
    dieRadius: 0.6,
    sourceDieRadius: 0.4, // the source-strip size (also bigger; see packing note below)
    maxThrowSpeed: 18,
    // Whole-throw inertia scale. Applied to the launch velocity AND to the cap
    // it's clamped against (and to the flick's entry speed), so EVERY throw —
    // gentle ones and ones already pinned at the cap alike — comes out exactly
    // this much stronger. Scaling only the velocity would have left hard
    // throws unchanged, since they're clamped at maxThrowSpeed anyway.
    // Kept as its own factor instead of folding 25% into maxThrowSpeed so the
    // original tuning stays legible and this is one number to revert.
    // Roll spin follows for free: rollAngvel is speed * torqueFactor.
    throwForceMultiplier: 1.25,
    torqueFactor: 1.75,
    linearDamping: 0.55,
    angularDamping: 0.95,
    dragHeightRatio: 2.9,
    dropHeightRatio: 2.25,
    wallHeightRatio: 9.5,
    // Flick-to-board aim assist + ballistic flight (see flickDieIntoBoard).
    // Gesture speed (world u/s) at/above which a release *outside* the board
    // becomes a thrown flick instead of a dead drop.
    flickSpeedThreshold: 6,
    // Gesture speed mapped to full force; anything faster is clamped. Between
    // threshold and this, the inward entry speed ramps min->maxThrowSpeed.
    flickSpeedForMaxForce: 26,
    // Softest flick's inward speed as it enters the board (world u/s); a full
    // flick enters at maxThrowSpeed. Depth then *emerges* from how far the die
    // rolls at that speed — like a real throw — instead of being teleported
    // deep (which made a hard flick land already at the far wall).
    flickMinInwardSpeed: 5,
    aimLateralFactor: 0.55, // fraction of the gesture's sideways speed carried into the entry velocity
    flightTime: 0.4, // ballistic arc duration (s)
    flightGravity: 22, // apparent gravity of the flight arc (world u/s²)
    flightTumbleFactor: 1.6, // spin per unit entry speed during flight (carried into physics)
  },
  mobile: {
    dieRadius: 0.8,
    sourceDieRadius: 0.28, // unchanged — this whole change is desktop-only
    maxThrowSpeed: 25,
    throwForceMultiplier: 1, // desktop-only change; mobile keeps its current feel
    torqueFactor: 1.5,
    linearDamping: 0.95,
    angularDamping: 1.4,
    dragHeightRatio: 2.2,
    dropHeightRatio: 1.2,
    wallHeightRatio: 7,
    flickSpeedThreshold: 9,
    flickSpeedForMaxForce: 40,
    flickMinInwardSpeed: 8,
    aimLateralFactor: 0.55,
    flightTime: 0.42,
    flightGravity: 30,
    flightTumbleFactor: 1.2,
  },
};

// Per-type visual size correction. Only the D4 uses this (Plan B from the
// vertex-numbering legibility pass): even at the geometric optimum for its
// corner-number placement, a triangular face has less usable area per digit
// than the others — measured, its glyphs still came out smaller relative to
// its own die than every other type's, including the 20-tiny-faces D20
// (relative on-screen glyph size 0.57 vs D20's 0.64 and D6/D8's 0.86 — see
// the task notes). +20% brings it above the D20 without making it
// conspicuously the biggest die on the board. Applied uniformly wherever a
// die's world radius is computed (dieWorldRadius below) — board, source
// strip, hand-hold, drag ramps, hitbox — so the D4 is consistently bigger
// everywhere rather than mismatched between contexts. Same ratio on both
// desktop and mobile, since it's a fix for the shape itself, not a
// platform-specific one; the other 5 types are untouched (default 1).
const DIE_SIZE_MULTIPLIER = { D4: 1.2 };
function sizeMultiplierFor(typeName) {
  return DIE_SIZE_MULTIPLIER[typeName] ?? 1;
}
/** A die's actual world radius for `scaleForRadius`, after its type's size correction. */
function dieWorldRadius(record, baseRadius) {
  return baseRadius * sizeMultiplierFor(record.typeName);
}

const LABEL_HEIGHT = 0.02;
const RETURN_DURATION_MS = 300;
const SCALE_TRANSITION_MS = 250; // source <-> board scale ramp (drag start, and the return trip)
const HOVER_SCALE = 1.05;
const PRESS_SCALE = 1.08;
const MIN_HIT_DIAMETER_PX = 44;
const HITBOX_VISUAL_MULTIPLIER = 1.4;
const SHADOW_Y = 0.03;

// Device performance tier is decided once at load (a phone's GPU class
// doesn't change when it's rotated) and drives the render-cost knobs;
// layout (below) is re-decided live on every resize/orientation change.
const touchDevice = isTouchDevice();
const textureCellSize = touchDevice ? 64 : 128; // half-resolution number atlas on touch devices

// Which input model this device gets. A hand *cursor* only makes sense
// where there is a hovering pointer, so it's keyed on input type rather
// than on the layout breakpoint: pointer devices get the hand cursor plus
// grab/release, touch devices keep the floating hand widget plus
// drag & flick. No device ever gets both, whatever shape the window is.
const handCursorEnabled = !touchDevice;

// ---------------------------------------------------------------------------
// Scene + physics
// ---------------------------------------------------------------------------

const viewport = document.getElementById("viewport");
const { scene, camera, renderer, start, onResize, onFrame, setViewTarget } = createScene(viewport, {
  antialias: !touchDevice,
});

// Rapier loads its WASM asynchronously; everything below is synchronous
// setup, so await it up front before wiring the frame loop.
const physics = await createDicePhysics();

// iOS Safari's 100vh includes space the address bar can cover; 100dvh (in
// style.css) handles this in modern engines, and this keeps a JS-computed
// fallback in sync for anything that doesn't support dvh yet.
function updateViewportHeightVar() {
  document.documentElement.style.setProperty("--app-vh", `${window.innerHeight * 0.01}px`);
}
updateViewportHeightVar();
window.addEventListener("resize", updateViewportHeightVar);
window.addEventListener("orientationchange", updateViewportHeightVar);

// Source strip / board / border all reuse one unit plane, resized per-layout
// via scale instead of rebuilding geometry on every breakpoint change.
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

const sourcePanel = new THREE.Mesh(UNIT_PLANE, new THREE.MeshStandardMaterial({ color: 0xd7dce3, roughness: 0.95 }));
sourcePanel.rotation.x = -Math.PI / 2;
scene.add(sourcePanel);

// A thin divider line between the source strip and the board — flush with
// the seam, never overhanging the outer edges (an earlier oversized version
// of this read as a dark frame around the whole app).
const seamDivider = new THREE.Mesh(UNIT_PLANE, new THREE.MeshStandardMaterial({ color: 0xa8b0bc, roughness: 1 }));
seamDivider.rotation.x = -Math.PI / 2;
seamDivider.position.y = 0.001;
scene.add(seamDivider);

const boardPanel = new THREE.Mesh(UNIT_PLANE, new THREE.MeshStandardMaterial({ color: 0xc7ced8, roughness: 0.95 }));
boardPanel.rotation.x = -Math.PI / 2;
scene.add(boardPanel);

// Soft blob shadow shown under a die while it's being dragged, so its
// height above the plane reads clearly. Built as a unit circle and scaled
// per-frame to track the die's own (transitioning) size.
const dragShadow = new THREE.Mesh(
  new THREE.CircleGeometry(1, 24),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })
);
dragShadow.rotation.x = -Math.PI / 2;
dragShadow.visible = false;
scene.add(dragShadow);

// The hand cursor lives in this same scene (pointer devices only). It is
// never handed to the raycaster, so it can't click itself or mask a die
// under it; it floats above the board's ceiling so nothing can occlude it.
const handCursor = createHandCursor({ scene });

// Comic-style throw feedback (streaks + speed lines). Pre-allocates its whole
// mesh pool here so a throw never allocates; see launchEffects.js.
const launchEffects = createLaunchEffects({ scene });

// Both modals (name gate, Discord config) are equivalent for cursor/hand
// purposes: whichever is open, the native OS cursor must be usable and the
// 3D hand must get out of the way. One combined check instead of repeating
// `isModalOpen() || isDiscordModalOpen()` at every call site.
function anyModalOpen() {
  return isModalOpen() || isDiscordModalOpen();
}

// The 3D hand hides itself while a modal is up (the OS cursor takes over
// instead — see the body.hand-cursor-active handling below) so it doesn't
// float uselessly over/behind the modal, then reappears the moment it closes.
function updateHandCursorVisibility() {
  handCursor.setVisible(handCursorEnabled && !anyModalOpen());
}
updateHandCursorVisibility();
subscribeModalOpen(updateHandCursorVisibility);
subscribeDiscordModalOpen(updateHandCursorVisibility);

// Native-cursor visibility, on <body>, not a curated element list: see
// style.css's `body.hand-cursor-active, body.hand-cursor-active * { cursor:
// none !important; }`. That blanket rule is what a prior version of this
// class (scoped to html/body/#app/#viewport/canvas/#labels only) was
// missing — any element with its OWN `cursor` rule (a button's `cursor:
// pointer`, say) still won on inheritance regardless of that list, and the
// roll-log's "Limpiar" button turned out to be exactly that once the log
// became a permanent column instead of a toggled sidesheet (diagnosed by
// auditing every `cursor:` declaration in style.css against what's actually
// reachable on desktop — see the task notes). Modals opt OUT by having this
// class removed from <body> entirely while they're open, rather than each
// modal's own CSS carving out a `cursor: auto` exception — that per-modal
// opt-out was the same "someone has to remember" failure mode that caused
// the bug above, just one level down, so it's gone now: no override to
// forget, the blanket rule simply isn't in effect.
function updateCursorClass() {
  const active = handCursorEnabled && !anyModalOpen();
  document.body.classList.toggle("hand-cursor-active", active);
}
updateCursorClass();
subscribeModalOpen(updateCursorClass);
subscribeDiscordModalOpen(updateCursorClass);

// Some engines cache "is the native cursor hidden" per window and don't
// re-check it just because our CSS class was never removed — they only
// notice a genuine style change. So leaving the window (any edge) and
// coming back, or switching tabs/apps and returning, can leave the OS
// cursor visible again despite the class still being present. Force a
// reflow between removing and re-adding the class so the browser is
// guaranteed to re-evaluate it, on every "pointer (re)entered the window"
// and "window regained focus" signal. This is a SEPARATE concern from the
// coverage fix above (a browser-caching quirk, not a missing selector) —
// belt-and-suspenders, kept from the original fix attempt since it's cheap
// and still correct, just retargeted to the new class/element.
function reassertHiddenCursor() {
  if (!handCursorEnabled || anyModalOpen()) return;
  document.body.classList.remove("hand-cursor-active");
  void document.body.offsetWidth; // forces a reflow between the remove/add
  document.body.classList.add("hand-cursor-active");
}

if (handCursorEnabled) {
  // pointerenter/mouseenter on `document` (not a descendant) only fire when
  // the pointer crosses INTO the document from outside the window — exactly
  // the "re-entered through some edge" case, from any of the four sides.
  document.addEventListener("pointerenter", reassertHiddenCursor);
  document.addEventListener("mouseenter", reassertHiddenCursor);
  // Covers returning from another tab/window/app with the pointer already
  // inside the viewport (no enter event fires in that case).
  window.addEventListener("focus", reassertHiddenCursor);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) reassertHiddenCursor();
  });
}

// ---------------------------------------------------------------------------
// Dice (built once at the source-strip scale; only their table position
// gets recomputed per layout, and their *scale* becomes context-dependent
// once drag/throw enters the picture — see scale ramps below)
// ---------------------------------------------------------------------------

let nextDieId = 1;
const records = []; // every die ever created, source strip or board
const recordsById = new Map();
const hitboxToRecord = new Map();

for (const { name, build } of DIE_TYPES) {
  const dieType = build({ textureCellSize });

  for (let i = 0; i < DICE_PER_ZONE; i++) {
    const { group, mesh, hitbox, scale } = createDieInstance(dieType, {
      visualRadius: SOURCE_DIE_RADIUS,
    });
    scene.add(group);

    const record = {
      id: nextDieId++,
      typeName: name,
      dieType,
      group,
      mesh,
      hitbox,
      restingScale: scale, // the scale this die should be at when idle (not hovered/pressed/mid-ramp)
      originalPosition: group.position.clone(),
      originalQuaternion: group.quaternion.clone(),
      inTray: false, // has a live physics body on the board
      settled: false, // that body has come to rest (=> counted as selected)
      value: null, // face-up number once settled; null while rolling ("in transit")
      dragging: false,
      flying: false, // mid ballistic-flight (kinematic arc) before entering physics
      flight: null, // active flight params (see flickDieIntoBoard)
      scaleRamp: null, // { from, to, start, duration } while transitioning source<->board scale
      body: null,
    };
    records.push(record);
    recordsById.set(record.id, record);
    hitboxToRecord.set(hitbox, record);
  }
}

// ---------------------------------------------------------------------------
// Labels (HTML overlay, positioned by projecting 3D anchors each resize)
// ---------------------------------------------------------------------------

const labelsContainer = document.getElementById("labels");
const boardLabelAnchor = { position: new THREE.Vector3() };
const zoneLabelAnchors = DIE_TYPES.map(() => ({ position: new THREE.Vector3() }));

const boardLabelEl = document.createElement("div");
boardLabelEl.className = "zone-label";
boardLabelEl.textContent = "Selección";
labelsContainer.appendChild(boardLabelEl);

const zoneLabelEls = DIE_TYPES.map(({ name }) => {
  const el = document.createElement("div");
  el.className = "zone-label";
  el.textContent = name;
  labelsContainer.appendChild(el);
  return el;
});

// Cached rather than re-measured on every placeLabelAt() call: the hand-name
// label (below) repositions every FRAME, and getBoundingClientRect() forces
// a layout read, so it's refreshed only where the viewport can actually have
// changed size (updateLabels(), called on resize/layout events) rather than
// 60x/sec regardless.
let viewportRect = viewport.getBoundingClientRect();
const _labelProjected = new THREE.Vector3();

function placeLabelAt(el, worldX, worldY, worldZ) {
  _labelProjected.set(worldX, worldY, worldZ).project(camera);
  const x = (_labelProjected.x * 0.5 + 0.5) * viewportRect.width;
  const y = (1 - (_labelProjected.y * 0.5 + 0.5)) * viewportRect.height;
  el.style.transform = `translate(${x}px, ${y}px)`;
}

function updateLabels() {
  // The renderer normally keeps the camera's world/projection matrices in
  // sync each frame, but this can run before the first render (on load,
  // updateLabels fires before start()) when they're still stale identity
  // matrices — force an update so projections are correct from frame one.
  camera.updateMatrixWorld(true);
  viewportRect = viewport.getBoundingClientRect();

  placeLabelAt(boardLabelEl, boardLabelAnchor.position.x, boardLabelAnchor.position.y, boardLabelAnchor.position.z);
  zoneLabelAnchors.forEach((anchor, i) =>
    placeLabelAt(zoneLabelEls[i], anchor.position.x, anchor.position.y, anchor.position.z)
  );
}

// ---------------------------------------------------------------------------
// Desktop-only: the name label that rides along with the hand-cursor. Purely
// visual — it lives in #labels, which is `pointer-events: none`, so it can
// never be a raycast/click target or steal a grab/throw gesture (unlike the
// mobile label below, which sits in its own separate widget and can safely
// be tappable).
// ---------------------------------------------------------------------------

const HAND_NAME_LABEL_OFFSET_Z = 1.3; // world units "below" the hand on screen (+Z, see tilt notes elsewhere)

const handNameLabelEl = document.createElement("div");
handNameLabelEl.className = "hand-name-label";
handNameLabelEl.hidden = true; // shown by updateHandNameLabel() once it's actually safe to display
labelsContainer.appendChild(handNameLabelEl);
handNameLabelEl.textContent = getStoredName() || "";
subscribeName((name) => {
  handNameLabelEl.textContent = name || "";
});

function updateHandNameLabel() {
  const visible = handCursorEnabled && !anyModalOpen();
  handNameLabelEl.hidden = !visible;
  if (!visible) return;
  const pos = handCursor.getPosition();
  // The label element's own size never changes (it's a fixed-size DOM
  // overlay, not part of the 3D hand), but its offset scales with the hand's
  // live zone scale so it stays tucked against the (possibly shrunk) hand
  // instead of floating a full-size gap below a half-size hand.
  const offsetZ = HAND_NAME_LABEL_OFFSET_Z * handCursor.getVisualScale();
  placeLabelAt(handNameLabelEl, pos.x, 0, pos.z + offsetZ);
}
updateHandNameLabel(); // position it before the first paint, not just from frame 2 onward

// ---------------------------------------------------------------------------
// Responsive layout.
//
// Desktop: source strip is a narrow LEFT column (20% width), its 6 type
// zones stacked 1 col x 6 rows; the throw board takes the 80% right.
// Mobile portrait: source strip is a TOP band (20% height), 3 cols x 2
// rows; the throw board takes the 80% bottom (thumb-friendly).
// ---------------------------------------------------------------------------

let traySlotFor = () => ({ x: 0, z: 0 });
let trayBounds = { centerX: 0, centerZ: 0, width: 1, depth: 1 };
let boardTuning = BOARD_TUNING.desktop;
let boardDragHeight = boardTuning.dieRadius * boardTuning.dragHeightRatio;
let boardDropHeight = boardTuning.dieRadius * boardTuning.dropHeightRatio;
let sourceDieRadius = boardTuning.sourceDieRadius; // live source-strip size for this breakpoint

function computeDesktopLayout(aspect) {
  // The world rect matches the viewport's aspect exactly so the camera's
  // contain-fit fills 100% of the canvas — no letterbox bands. Height is the
  // fixed dimension (dice keep a constant on-screen size as width varies).
  const totalDepth = 24;
  const totalWidth = totalDepth * aspect;
  const sourceWidth = totalWidth * SOURCE_RATIO;
  const boardWidth = totalWidth - sourceWidth;
  const sourceCenterX = -totalWidth / 2 + sourceWidth / 2;
  const boardCenterX = totalWidth / 2 - boardWidth / 2;

  return {
    totalWidth,
    totalDepth,
    sourceWidth,
    sourceDepth: totalDepth,
    sourceCenterX,
    sourceCenterZ: 0,
    boardWidth,
    boardDepth: totalDepth,
    boardCenterX,
    boardCenterZ: 0,
    zoneCols: 1,
    zoneRows: 6,
    trayOrientation: "vertical",
    boardLabelX: boardCenterX - boardWidth / 2 + 0.35,
    boardLabelZ: -totalDepth / 2 + 0.35,
    tuning: BOARD_TUNING.desktop,
  };
}

function computeMobileLayout(aspect) {
  // The world rect matches the viewport's aspect exactly (see desktop note).
  // Width is the fixed dimension on portrait; the source strip takes 20% of
  // whatever real depth the screen yields, its 3x2 zones scaling with it.
  const totalWidth = 16.5;
  const totalDepth = totalWidth / aspect;
  const sourceDepth = totalDepth * SOURCE_RATIO;
  const boardDepth = totalDepth - sourceDepth;
  const sourceCenterZ = -totalDepth / 2 + sourceDepth / 2;
  const boardCenterZ = totalDepth / 2 - boardDepth / 2;

  return {
    totalWidth,
    totalDepth,
    sourceWidth: totalWidth,
    sourceDepth,
    sourceCenterX: 0,
    sourceCenterZ,
    boardWidth: totalWidth,
    boardDepth,
    boardCenterX: 0,
    boardCenterZ,
    zoneCols: 3,
    zoneRows: 2,
    trayOrientation: "horizontal",
    boardLabelX: -totalWidth / 2 + 0.35,
    boardLabelZ: boardCenterZ - boardDepth / 2 + 0.3,
    tuning: BOARD_TUNING.mobile,
  };
}

/** The nominal (un-hovered/un-pressed) radius a die "belongs at" right now. */
function currentNominalRadius(record) {
  return dieWorldRadius(record, record.inTray ? boardTuning.dieRadius : sourceDieRadius);
}

function updateHitboxSizes() {
  const canvasWidthPx = renderer.domElement.clientWidth || 1;
  const worldUnitsPerPixel = (camera.right - camera.left) / canvasWidthPx;
  const minWorldRadius = (MIN_HIT_DIAMETER_PX / 2) * worldUnitsPerPixel;

  for (const record of records) {
    const nominal = currentNominalRadius(record);
    const worldRadius = Math.max(nominal * HITBOX_VISUAL_MULTIPLIER, minWorldRadius);
    applyHitboxRadius(record.hitbox, record.restingScale, worldRadius);
  }
}

/** Places a die at rest in a board slot, at the current breakpoint's board scale. */
function seatDieOnBoard(record, slot) {
  const scale = scaleForRadius(record.dieType, dieWorldRadius(record, boardTuning.dieRadius));
  const restY = computeRestY(record.dieType, record.dieType.standardQuaternion, scale);
  record.group.position.set(slot.x, restY, slot.z);
  record.group.quaternion.copy(record.dieType.standardQuaternion);
  record.group.scale.setScalar(scale);
  record.restingScale = scale;
  record.scaleRamp = null;
}

let lastBreakpoint = null;
let lastAspect = null;

function rebuildLayout() {
  // Must happen before the clientWidth read just below: the class is what
  // decides whether #viewport sits in the flex-row desktop stage (narrower,
  // sharing width with the log column) or fills the mobile block layout
  // (full width, log as an overlay on top) — read the size first and this
  // would measure last frame's layout instead of the one about to apply.
  syncLayoutModeClass();
  const breakpoint = getBreakpoint();
  lastBreakpoint = breakpoint;
  const aspect = viewport.clientHeight > 0 ? viewport.clientWidth / viewport.clientHeight : 1;
  lastAspect = aspect;
  const isMobile = breakpoint === "mobile";
  const layout = isMobile ? computeMobileLayout(aspect) : computeDesktopLayout(aspect);

  boardTuning = layout.tuning;
  boardDragHeight = boardTuning.dieRadius * boardTuning.dragHeightRatio;
  boardDropHeight = boardTuning.dieRadius * boardTuning.dropHeightRatio;
  sourceDieRadius = boardTuning.sourceDieRadius;

  setViewTarget({ width: layout.totalWidth, depth: layout.totalDepth, centerX: 0, centerZ: 0 });

  sourcePanel.scale.set(layout.sourceWidth, layout.sourceDepth, 1);
  sourcePanel.position.set(layout.sourceCenterX, 0, layout.sourceCenterZ);

  // Thin divider hugging the source/board seam (vertical seam on desktop,
  // horizontal on mobile), spanning only the shared edge — nothing overhangs
  // the outer border of the world rect.
  const SEAM = 0.12;
  if (layout.trayOrientation === "vertical") {
    seamDivider.scale.set(SEAM, layout.totalDepth, 1);
    seamDivider.position.set(layout.boardCenterX - layout.boardWidth / 2, 0.001, 0);
  } else {
    seamDivider.scale.set(layout.totalWidth, SEAM, 1);
    seamDivider.position.set(0, 0.001, layout.boardCenterZ - layout.boardDepth / 2);
  }

  boardPanel.scale.set(layout.boardWidth, layout.boardDepth, 1);
  boardPanel.position.set(layout.boardCenterX, 0, layout.boardCenterZ);

  trayBounds = {
    centerX: layout.boardCenterX,
    centerZ: layout.boardCenterZ,
    width: layout.boardWidth,
    depth: layout.boardDepth,
  };
  physics.setTrayBounds({ ...trayBounds, wallHeight: boardTuning.dieRadius * boardTuning.wallHeightRatio });

  traySlotFor = createSlotGrid({
    centerX: layout.boardCenterX,
    centerZ: layout.boardCenterZ,
    width: layout.boardWidth,
    depth: layout.boardDepth,
    dieRadius: boardTuning.dieRadius,
    orientation: layout.trayOrientation,
  });

  // Re-place source-strip dice (everything not currently on the board).
  const zones = buildZones(
    layout.sourceWidth,
    layout.sourceDepth,
    layout.zoneCols,
    layout.zoneRows,
    layout.sourceCenterX,
    layout.sourceCenterZ
  );

  DIE_TYPES.forEach(({ name }, i) => {
    const zone = zones[i];
    const sourceDice = records.filter((r) => r.typeName === name && !r.inTray);

    // Packing distances scale with the live source size AND this type's own
    // size correction, so a bigger D4 still gets placed without overlapping
    // its neighbors in its own zone (the floor is the true no-overlap gap).
    const typeRadius = sourceDieRadius * sizeMultiplierFor(name);
    const minDist = typeRadius * SOURCE_MIN_DISTANCE_FACTOR;
    const zoneMargin = typeRadius * SOURCE_ZONE_MARGIN_FACTOR;
    const overlapFloor = typeRadius * SOURCE_OVERLAP_FLOOR_FACTOR;
    const points = samplePointsInZone(zone, sourceDice.length, minDist, zoneMargin, overlapFloor);

    sourceDice.forEach((record, idx) => {
      const { x, z } = points[idx];
      // Resize to the breakpoint's source size (desktop grew; mobile unchanged)
      // unless the die is mid-drag — the drag ramp owns its scale then.
      if (!record.dragging && !record.scaleRamp) {
        const scale = scaleForRadius(record.dieType, typeRadius);
        record.group.scale.setScalar(scale);
        record.restingScale = scale;
      }
      const restY = computeRestY(record.dieType, record.group.quaternion, record.restingScale);
      record.originalPosition = new THREE.Vector3(x, restY, z);
      if (!record.dragging) record.group.position.copy(record.originalPosition);
    });

    zoneLabelAnchors[i].position.set(zone.centerX - zone.width / 2 + 0.2, LABEL_HEIGHT, zone.centerZ - zone.depth / 2 + 0.2);
  });

  // The board moved/resized: rehome its dice into the new area as fresh
  // resting bodies at the (possibly new) board scale for this breakpoint —
  // preserving selection + order — rather than leaving stale bodies behind.
  const boardRecords = getSelection()
    .map((entry) => recordsById.get(entry.id))
    .filter((r) => r && r.inTray);
  boardRecords.forEach((record, index) => {
    physics.removeDie(record);
    seatDieOnBoard(record, traySlotFor(index));
    physics.addDie(record, {
      position: record.group.position,
      quaternion: record.group.quaternion,
      scale: record.restingScale,
      linearDamping: boardTuning.linearDamping,
      angularDamping: boardTuning.angularDamping,
    });
    record.settled = true;
    // Re-seating puts every board die back in its standard pose, so re-read
    // rather than carrying over a value from the pose it had before.
    record.value = readRecordValue(record);
  });

  boardLabelAnchor.position.set(layout.boardLabelX, LABEL_HEIGHT, layout.boardLabelZ);
  boardLabelEl.classList.toggle("zone-label--tray", isMobile);

  // Park the hand above the board's ceiling, so no die — however hard it is
  // thrown — can ever be drawn in front of it.
  handCursor.setHeight(boardTuning.dieRadius * boardTuning.wallHeightRatio + HAND_CONFIG.cursor.heightMargin);

  // Same rectangle overTray()/drop-routing already use, so the hand's "am I
  // over the board" and a die's "which zone did I land in" always agree.
  handCursor.setZoneBounds({
    centerX: trayBounds.centerX,
    centerZ: trayBounds.centerZ,
    halfWidth: trayBounds.width / 2,
    halfDepth: trayBounds.depth / 2,
  });

  updateHitboxSizes();
  updateLabels();
}

// Roll log overlay (hidden until the first roll lands; see rollLogPanel.js).
createRollLogPanel();

// Discord webhook config (corner button + modal; see discordPanel.js).
createDiscordPanel();

rebuildLayout();

onResize(() => {
  // The world rect is built at the viewport's aspect ratio, so any real
  // aspect change needs a relayout or the contain-fit would letterbox
  // (background bands). Tiny fluctuations (mobile URL bar) don't warrant
  // resampling every die position.
  const aspect = viewport.clientHeight > 0 ? viewport.clientWidth / viewport.clientHeight : 1;
  const aspectChanged = lastAspect === null || Math.abs(aspect - lastAspect) / lastAspect > 0.01;
  if (getBreakpoint() !== lastBreakpoint || aspectChanged) {
    rebuildLayout();
  } else {
    updateHitboxSizes();
    updateLabels();
  }
});
window.addEventListener("orientationchange", rebuildLayout);

// ---------------------------------------------------------------------------
// Interaction: drag a source-strip die onto the board (physics throw); tap
// a board die to send it back. Source taps and board drags do nothing.
// ---------------------------------------------------------------------------

function overTray(x, z) {
  return (
    Math.abs(x - trayBounds.centerX) <= trayBounds.width / 2 && Math.abs(z - trayBounds.centerZ) <= trayBounds.depth / 2
  );
}

/** Starts (or retargets) a smooth scale transition toward `toScale`. */
function rampScale(record, toScale, duration = SCALE_TRANSITION_MS) {
  record.scaleRamp = { from: record.group.scale.x, to: toScale, start: performance.now(), duration };
}

function returnDieToTable(record) {
  record.value = null; // back in the source strip: it isn't showing a result
  const targetRadius = dieWorldRadius(record, sourceDieRadius);
  rampScale(record, targetRadius / record.dieType.boundingRadius, RETURN_DURATION_MS);
  animateTransform(record.group, {
    toPosition: record.originalPosition,
    toQuaternion: record.originalQuaternion,
    duration: RETURN_DURATION_MS,
    onComplete: () => {
      record.restingScale = scaleForRadius(record.dieType, targetRadius);
      updateHitboxSizes();
    },
  });
}

// Groups each throw gesture into one roll-log entry (see throwBatches.js).
// "Still in play" = has a body on the board, or is mid ballistic flight.
const throwBatcher = createThrowBatcher({
  isLive: (record) => record.inTray || record.flying,
  isSettled: (record) => record.settled && record.value !== null,
  describe: (record) => ({ typeName: record.typeName, value: record.value }),
  onRoll: (dice) => {
    const entry = addRoll(dice);
    forwardRollToDiscord(entry);
  },
});

/**
 * Fire-and-forget send of a completed roll to the configured webhook. Only
 * runs when a connection has been proven (isConnected), and swallows any
 * failure so a Discord hiccup never interrupts local play (the app keeps
 * rolling regardless — the config panel is where connection problems surface).
 */
function forwardRollToDiscord(entry) {
  if (!entry || !isConnected()) return;
  const url = getWebhookUrl();
  if (!url) return;
  // Message shape (header + one emoji line per individual die, sorted
  // D4->D20 — same per-die ordering the sidesheet uses) lives in
  // discordMessage.js; this just builds the payload and sends it.
  const payload = buildRollWebhookPayload(entry, getStoredName());
  sendWebhookPayload(url, payload).catch(() => {});
}

const beginThrow = () => throwBatcher.begin();
const endThrow = () => throwBatcher.end();
const enrollInThrow = (record) => throwBatcher.enroll(record);

/** The board rectangle shrunk by a die-radius margin — where a die can land without spawning against a wall. */
function boardInnerBounds() {
  const margin = boardTuning.dieRadius * 1.2;
  return {
    xMin: trayBounds.centerX - trayBounds.width / 2 + margin,
    xMax: trayBounds.centerX + trayBounds.width / 2 - margin,
    zMin: trayBounds.centerZ - trayBounds.depth / 2 + margin,
    zMax: trayBounds.centerZ + trayBounds.depth / 2 - margin,
  };
}

/**
 * Roll-in-the-throw-direction angular velocity: axis = up x velDir, so the
 * die tumbles forward proportionally to how hard it was flung (plus a little
 * randomness so identical throws don't look mechanical). Shared by the
 * in-board throw and the ballistic flight so both roll consistently.
 */
function rollAngvel(vx, vz, speed, factor) {
  if (speed <= 0.01) return { x: 0, y: 0, z: 0 };
  const dirX = vx / speed;
  const dirZ = vz / speed;
  const mag = speed * factor;
  return {
    x: dirZ * mag + (Math.random() - 0.5),
    y: (Math.random() - 0.5) * 2,
    z: -dirX * mag + (Math.random() - 0.5),
  };
}

function throwDieIntoTray(record, dropX, dropZ, velX, velZ) {
  const b = boardInnerBounds();
  const x = THREE.MathUtils.clamp(dropX, b.xMin, b.xMax);
  const z = THREE.MathUtils.clamp(dropZ, b.zMin, b.zMax);

  // Same gesture, `throwForceMultiplier` times the inertia — the multiplier
  // scales the launch velocity and the cap together (see BOARD_TUNING).
  const force = boardTuning.throwForceMultiplier;
  const maxSpeed = boardTuning.maxThrowSpeed * force;
  let speed = Math.hypot(velX, velZ) * force;
  let vx = velX * force;
  let vz = velZ * force;
  if (speed > maxSpeed) {
    const k = maxSpeed / speed;
    vx *= k;
    vz *= k;
    speed = maxSpeed;
  }

  const angvel = rollAngvel(vx, vz, speed, boardTuning.torqueFactor);

  const scale = scaleForRadius(record.dieType, dieWorldRadius(record, boardTuning.dieRadius));
  record.group.scale.setScalar(scale);
  record.restingScale = scale;
  record.scaleRamp = null;

  physics.addDie(record, {
    position: { x, y: boardDropHeight, z },
    quaternion: record.group.quaternion,
    scale,
    linvel: { x: vx, y: 0, z: vz },
    angvel,
    linearDamping: boardTuning.linearDamping,
    angularDamping: boardTuning.angularDamping,
  });
  record.inTray = true;
  record.settled = false;
  record.value = null; // rolling: value is in transit until it stops
  enrollInThrow(record);
  updateHitboxSizes();
}

/**
 * Maps an *outside-the-board* flick to an entry point + entry velocity.
 *
 * Entry edge = the board edge the release point is most outside of, so the
 * die arcs in over the nearest wall (matching where the gesture came from).
 * The die enters with an *inward* speed that scales with gesture force
 * (soft->flickMinInwardSpeed, hard->maxThrowSpeed) plus a lateral component
 * carried from the sideways part of the gesture (so aiming right lands it
 * rightward). Crucially, this entry speed is CAPPED — depth then *emerges*
 * from how far the die rolls at that speed, exactly like an in-board throw,
 * instead of teleporting the die deep with an unbounded velocity (which slung
 * a hard flick straight into the far wall). The entry point (release +
 * entryVel*flightTime) is clamped inside the board so the die always enters
 * in bounds regardless of how far outside it was released.
 */
function computeFlickEntry(releaseX, releaseZ, velX, velZ, speed) {
  const b = boardInnerBounds();

  const overLeft = b.xMin - releaseX;
  const overRight = releaseX - b.xMax;
  const overTop = b.zMin - releaseZ;
  const overBottom = releaseZ - b.zMax;
  const maxOver = Math.max(overLeft, overRight, overTop, overBottom);

  const forceFrac = THREE.MathUtils.clamp(
    (speed - boardTuning.flickSpeedThreshold) / (boardTuning.flickSpeedForMaxForce - boardTuning.flickSpeedThreshold),
    0,
    1
  );
  // Same throwForceMultiplier as the in-board throw, so a flick gains exactly
  // the same 25% and the two entry paths stay consistent with each other.
  const force = boardTuning.throwForceMultiplier;
  const inwardSpeed =
    THREE.MathUtils.lerp(boardTuning.flickMinInwardSpeed, boardTuning.maxThrowSpeed, forceFrac) * force;
  const cap = boardTuning.maxThrowSpeed * force;

  let entryVx;
  let entryVz;
  if (maxOver === overTop || maxOver === overBottom) {
    // Entered through top/bottom: inward runs along Z, lateral is the gesture's X.
    entryVz = maxOver === overTop ? inwardSpeed : -inwardSpeed;
    entryVx = THREE.MathUtils.clamp(velX * force * boardTuning.aimLateralFactor, -cap, cap);
  } else {
    // Entered through left/right: inward runs along X, lateral is the gesture's Z.
    entryVx = maxOver === overLeft ? inwardSpeed : -inwardSpeed;
    entryVz = THREE.MathUtils.clamp(velZ * force * boardTuning.aimLateralFactor, -cap, cap);
  }

  const T = boardTuning.flightTime;
  const entryX = THREE.MathUtils.clamp(releaseX + entryVx * T, b.xMin, b.xMax);
  const entryZ = THREE.MathUtils.clamp(releaseZ + entryVz * T, b.zMin, b.zMax);

  return { entryX, entryZ, forceFrac };
}

/**
 * Flicks a die from outside the board: it flies a kinematic ballistic arc to
 * an entry point inside the board, tumbling, then hands off to Rapier at the
 * arc's end with the arc's exact instantaneous linear + angular velocity — so
 * the flight->physics transition is seamless (no position jump, no velocity
 * discontinuity). The die rolls on from there under normal physics, going
 * deeper the harder it was flicked. CCD (enabled in DicePhysics.addDie) stops
 * a fast handoff from tunnelling the floor/walls.
 */
function flickDieIntoBoard(record, releaseX, releaseZ, velX, velZ, speed) {
  const { entryX, entryZ } = computeFlickEntry(releaseX, releaseZ, velX, velZ, speed);

  // Lock to board scale now so the collider built at handoff matches the
  // rendered size exactly (the drag ramp is usually already done anyway).
  const scale = scaleForRadius(record.dieType, dieWorldRadius(record, boardTuning.dieRadius));
  record.group.scale.setScalar(scale);
  record.restingScale = scale;
  record.scaleRamp = null;

  const startX = releaseX;
  const startZ = releaseZ;
  const startY = boardDragHeight; // die is floating at drag height when released
  const endY = boardDropHeight;

  const T = boardTuning.flightTime;
  const g = boardTuning.flightGravity;

  // Horizontal: constant velocity from release to the (clamped) entry point.
  // The clamp keeps this bounded near the capped entry speed, so the handoff
  // linvel is throw-like rather than a wall-slamming overshoot.
  const vHx = (entryX - startX) / T;
  const vHz = (entryZ - startZ) / T;
  // Vertical: an up-then-down arc that ends exactly at endY at t=T.
  const vy0 = (endY - startY + 0.5 * g * T * T) / T;

  const horizSpeed = Math.hypot(vHx, vHz);
  const angvel = rollAngvel(vHx, vHz, horizSpeed, boardTuning.flightTumbleFactor);
  const angVec = new THREE.Vector3(angvel.x, angvel.y, angvel.z);
  const angSpeed = angVec.length();
  const angAxis = angSpeed > 1e-6 ? angVec.clone().normalize() : new THREE.Vector3(1, 0, 0);

  record.flying = true;
  record.settled = false;
  record.value = null; // in flight: value is in transit until it lands and stops
  enrollInThrow(record);
  record.flight = {
    startX,
    startY,
    startZ,
    vHx,
    vHz,
    vy0,
    g,
    T,
    startTime: performance.now(),
    startQuat: record.group.quaternion.clone(),
    angAxis,
    angSpeed,
    angvel,
    scale,
  };
}

/** Advances any in-flight (kinematic arc) dice; hands each off to physics at arc's end. */
function updateFlights() {
  const now = performance.now();
  const _q = new THREE.Quaternion();

  for (const record of records) {
    if (!record.flying) continue;
    const f = record.flight;
    const t = Math.min((now - f.startTime) / 1000, f.T);

    record.group.position.set(
      f.startX + f.vHx * t,
      f.startY + f.vy0 * t - 0.5 * f.g * t * t,
      f.startZ + f.vHz * t
    );
    _q.setFromAxisAngle(f.angAxis, f.angSpeed * t);
    record.group.quaternion.multiplyQuaternions(_q, f.startQuat);

    if (t >= f.T) {
      // Hand off to Rapier with the arc's exact velocity at this instant.
      const vyEnd = f.vy0 - f.g * f.T;
      record.flying = false;
      record.flight = null;
      physics.addDie(record, {
        position: record.group.position,
        quaternion: record.group.quaternion,
        scale: f.scale,
        linvel: { x: f.vHx, y: vyEnd, z: f.vHz },
        angvel: f.angvel,
        linearDamping: boardTuning.linearDamping,
        angularDamping: boardTuning.angularDamping,
      });
      record.inTray = true;
      record.settled = false;
      updateHitboxSizes();
    }
  }
}

function setScaleFeedback(record, factor) {
  // Never fight physics, an active drag/flight, or a scale ramp in progress.
  if (!record || record.inTray || record.dragging || record.flying || record.scaleRamp) return;
  record.group.scale.setScalar(record.restingScale * factor);
}

// ---------------------------------------------------------------------------
// Hand cursor state machine (pointer devices). Two states — EMPTY and
// HOLDING — where HOLDING now carries a whole handful (0..N dice). Every
// transition is driven by a pointer gesture, classified click vs. drag by the
// same movement threshold the mobile drag mode uses (see interaction.js).
//
// On left-pointerDOWN, if the cursor is over a die NOT already in the hand,
// that die is ADDED immediately (so a press-and-drag off a die picks it up
// from the first frame). Everything else waits for pointerUP:
//
//   L-CLICK on a non-held die -> ADD it to the handful      (accumulate)
//   L-CLICK on empty, holding -> drop ALL (dead, by position)
//   L-CLICK on empty, empty   -> nothing
//   DRAG while holding        -> throw ALL (hand velocity + per-die scatter)
//   RIGHT-CLICK while holding  -> take the NEAREST die back out (fix a mis-grab)
//
// Why remove-one is the right button, not a left-click on a held die: the
// handful rides at the cursor (measured — the pointer sits inside every held
// die's hitbox), so a left-click over the hand can't be told apart from a
// left-click on "empty" that means drop-all. Rather than make one of drop-all
// / remove-one unreachable, remove-one gets its own button.
//
// Adding pulls a die out of physics and reparents it into the palm cluster;
// dropping/throwing/removing reverses that and updates the selection state,
// never leaving an orphaned body or a duplicated/oversubscribed die.
// ---------------------------------------------------------------------------

function addDieToHand(record) {
  if (record.flying) return; // mid ballistic flight: let it land first
  if (handCursor.isHeldByHand(record)) return; // already in the hand

  cancelTween(record.group);
  record.scaleRamp = null;
  record.dragging = false;

  // Coming off the board: retire its physics body so nothing is left
  // simulating a die that is now in the player's hand.
  if (record.inTray) {
    physics.removeDie(record);
    record.inTray = false;
    record.settled = false;
  }
  record.value = null; // in the hand: no result until it's rolled again
  // Marks it in-transit; also drops it from the ordered board selection.
  addHeldDie(record.id, record.typeName);

  const dieScale = scaleForRadius(record.dieType, dieWorldRadius(record, boardTuning.dieRadius));
  record.restingScale = dieScale;
  handCursor.hold(record, {
    dieWorldScale: dieScale,
    gripCurl: gripCurlForDie(record.dieType),
  });
}

/** A small random in-plane offset, radius up to `mag`. */
function scatterXZ(x, z, mag) {
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * mag;
  return { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
}

/**
 * Routes one just-released die to its destination, exactly like a single
 * drag release but from the die's OWN position (each die leaves from where it
 * sat in the cluster). `dead` forces a no-velocity drop (the click-to-drop
 * path) regardless of the hand's motion.
 */
function routeReleasedDie(record, baseX, baseZ, velX, velZ, dead) {
  const speed = Math.hypot(velX, velZ);
  if (overTray(baseX, baseZ)) {
    // Dead drop: no throw velocity, just a little positional scatter so a
    // handful doesn't land in one stack. Thrown: keep the (dispersed) velocity.
    if (dead) {
      const p = scatterXZ(baseX, baseZ, HAND_CONFIG.cursor.multiThrow.posScatter);
      throwDieIntoTray(record, p.x, p.z, 0, 0);
    } else {
      throwDieIntoTray(record, baseX, baseZ, velX, velZ);
    }
  } else if (!dead && speed >= boardTuning.flickSpeedThreshold) {
    flickDieIntoBoard(record, baseX, baseZ, velX, velZ, speed);
  } else {
    returnDieToTable(record);
  }
}

/** Per-die velocity dispersion so a thrown handful fans out, not flies as a block. */
function disperseVelocity(velX, velZ) {
  const mt = HAND_CONFIG.cursor.multiThrow;
  const speed = Math.hypot(velX, velZ);
  const mag = Math.max(mt.velScatterMin, speed * mt.velScatterFrac);
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * mag;
  return { x: velX + Math.cos(a) * r, z: velZ + Math.sin(a) * r };
}

/** Throws the whole handful: each die inherits the hand's velocity + its own scatter. */
function throwAllHeld() {
  const velocity = handCursor.getVelocity();
  const released = handCursor.releaseAll(); // detaches all, preserving world transforms
  clearHeldDice();
  beginThrow(); // one gesture => one roll-log entry, however many dice
  for (const record of released) {
    // Each die is at its own cluster world position now (already spread).
    const baseX = record.group.position.x;
    const baseZ = record.group.position.z;
    const v = disperseVelocity(velocity.x, velocity.z);
    routeReleasedDie(record, baseX, baseZ, v.x, v.z, false);
  }
  endThrow();
  // Purely decorative, and fired AFTER every die is already routed into
  // physics — it can't delay or alter the throw. Only the dice that actually
  // went into play get a streak (one sent home wasn't thrown).
  if (handCursorEnabled) {
    launchEffects.launch(released.filter((r) => r.inTray || r.flying), velocity.x, velocity.z);
  }
}

/** Drops the whole handful dead (click on empty): destination by position, no throw velocity. */
function releaseAllHeld() {
  const released = handCursor.releaseAll();
  clearHeldDice();
  beginThrow(); // dropping a handful onto the board is still one roll
  for (const record of released) {
    routeReleasedDie(record, record.group.position.x, record.group.position.z, 0, 0, true);
  }
  endThrow();
}

/** Takes one die back out of the hand and sends it home; the rest stay held. */
function removeDieFromHand(record) {
  if (!handCursor.releaseOne(record)) return;
  removeHeldDie(record.id);
  returnDieToTable(record);
}

/**
 * Right-click handler: takes the held die nearest the cursor back out (the
 * one you'd most likely be pointing at to "un-grab"). No-op if empty.
 */
const _cursorWorld = new THREE.Vector3();
const _dieWorld = new THREE.Vector3();
function removeNearestHeldDie() {
  const held = handCursor.getHeldDice();
  if (held.length === 0) return;
  const { x, z } = handCursor.getPosition();
  _cursorWorld.set(x, 0, z);
  let nearest = held[0];
  let best = Infinity;
  for (const record of held) {
    record.group.getWorldPosition(_dieWorld);
    _dieWorld.y = 0;
    const dist = _dieWorld.distanceTo(_cursorWorld);
    if (dist < best) {
      best = dist;
      nearest = record;
    }
  }
  removeDieFromHand(nearest);
}

setupInteraction({
  renderer,
  camera,
  // In hand mode, dice already in the hand are excluded from the picker: the
  // handful rides at the cursor, so if their hitboxes stayed live every click
  // would land on the cluster and you could never click "past" it to a board
  // die or to empty space. main tracks the handful itself (isHeldByHand), so
  // taking a die back out doesn't need it to be a raycast target.
  getTargets: () => records.filter((r) => !handCursor.isHeldByHand(r)).map((r) => r.hitbox),
  resolve: (object) => hitboxToRecord.get(object) || null,
  canDrag: (record) => !record.inTray && !record.dragging && !record.flying,
  getMode: () => (handCursorEnabled ? "hand" : "drag"),
  onPointerWorldMove: (x, z) => handCursor.setTarget(x, z),
  // pointerDOWN: add a die that isn't already in the hand, immediately (so a
  // press-and-drag off it throws it too). Returns true iff it added, so
  // interaction.js can pass that to onHandRelease.
  onHandPress: (record) => {
    if (record && !handCursor.isHeldByHand(record)) {
      addDieToHand(record);
      return true;
    }
    return false;
  },
  // pointerUP: resolve the whole gesture (see the state-machine comment above).
  onHandRelease: ({ added, dragged }) => {
    if (dragged) {
      if (handCursor.isHoldingAny()) throwAllHeld(); // any drag while holding throws the handful
      return;
    }
    // Click (no drag):
    if (added) return; // this press just added a die — it stays in the hand
    if (handCursor.isHoldingAny()) releaseAllHeld(); // clicked empty while holding — drop all
    // else: clicked empty while empty — nothing
  },
  // Right-click: take the die nearest the cursor back out of the hand (the
  // rest stay). See interaction.js for why this needs the secondary button.
  onHandSecondaryPress: () => removeNearestHeldDie(),
  // Hover feedback: the picker reports the grabbable die under the pointer
  // (null if none); the hand curls its fingers a little in response. The
  // "only while empty" gate lives in the hand cursor.
  onHandHoverChange: (record) => handCursor.setHover(!!record),
  onTap: (record) => {
    // Board die -> remove its body and animate home. Source die / in-flight
    // die -> nothing.
    if (!record.inTray || record.flying) return;
    physics.removeDie(record);
    record.inTray = false;
    record.settled = false;
    deselectDie(record.id);
    returnDieToTable(record);
  },
  onDragStart: (record) => {
    record.dragging = true;
    cancelTween(record.group);
    rampScale(record, scaleForRadius(record.dieType, dieWorldRadius(record, boardTuning.dieRadius)));
    dragShadow.visible = true;
  },
  onDragMove: (record, x, z) => {
    record.group.position.set(x, boardDragHeight, z);
    dragShadow.position.set(x, SHADOW_Y, z);
    dragShadow.scale.setScalar(record.group.scale.x * 1.15 * record.dieType.boundingRadius);
  },
  onDragEnd: (record, { x, z, velX, velZ, cancelled }) => {
    record.dragging = false;
    dragShadow.visible = false;

    if (cancelled) {
      returnDieToTable(record);
      return;
    }

    // Three paths on release:
    //  1. Over the board (any speed) -> immediate physics throw.
    //  2. Outside + a real flick (speed above threshold) -> ballistic flight
    //     that always lands inside the board, then physics takes over.
    //  3. Outside + no real velocity (a dead drop) -> animate back to source.
    const speed = Math.hypot(velX, velZ);
    beginThrow(); // this drag is one roll (path 3 enrolls nothing and logs nothing)
    if (overTray(x, z)) {
      throwDieIntoTray(record, x, z, velX, velZ);
    } else if (speed >= boardTuning.flickSpeedThreshold) {
      flickDieIntoBoard(record, x, z, velX, velZ, speed);
    } else {
      returnDieToTable(record);
    }
    endThrow();
  },
  onHoverChange: (prev, next) => {
    setScaleFeedback(prev, 1);
    setScaleFeedback(next, HOVER_SCALE);
  },
  onPressChange: (record, isPressed) => {
    setScaleFeedback(record, isPressed ? PRESS_SCALE : 1);
  },
});

// ---------------------------------------------------------------------------
// Frame loop: fixed-timestep physics + interpolation, settle detection,
// scale ramps (source<->board size transitions), then non-physics tweens.
// ---------------------------------------------------------------------------

function updateScaleRamps() {
  const now = performance.now();
  let anyCompleted = false;

  for (const record of records) {
    if (!record.scaleRamp) continue;
    const { from, to, start, duration } = record.scaleRamp;
    const t = Math.min((now - start) / duration, 1);
    record.group.scale.setScalar(THREE.MathUtils.lerp(from, to, easeOutCubic(t)));
    if (t >= 1) {
      record.scaleRamp = null;
      anyCompleted = true;
    }
  }

  if (anyCompleted) updateHitboxSizes();
}

let lastTime = null;

onFrame((time) => {
  const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
  lastTime = time;

  // Advance ballistic flights first so a die reaching its landing this frame
  // enters the physics world before this frame's step runs.
  updateFlights();

  const alpha = physics.step(dt);
  physics.sync(alpha);

  // A die counts as selected once its thrown body first comes to rest on
  // the board; order of settling = order added to the selection list.
  //
  // Settling is also when a die's value is read — once, off the pose it
  // actually came to rest in, not every frame. The reverse transition matters
  // too: a settled die that gets knocked back into motion goes back to "in
  // transit" (value null) and will be re-read when it stops again.
  for (const record of records) {
    if (!record.inTray) continue;
    const sleeping = physics.isSleeping(record);
    if (sleeping && !record.settled) {
      record.settled = true;
      record.value = readRecordValue(record);
      if (!isSelected(record.id)) selectDie(record.id, record.typeName);
    } else if (!sleeping && record.settled) {
      record.settled = false;
      record.value = null;
    }
  }

  throwBatcher.update();

  updateScaleRamps();
  updateTweens();
  handCursor.update(dt, time / 1000);
  updateHandNameLabel();
  // After physics.sync above, so trails read this frame's die positions.
  launchEffects.update(dt);
});

start();
