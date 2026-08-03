import * as THREE from "three";
import { createHand } from "./Hand.js";
import { HAND_CONFIG, restRotationDegrees } from "./handConfig.js";
import { easeOutCubic, easeInOutCubic } from "../animation.js";

/**
 * The desktop hand-cursor: the hand rig living in the main dice scene,
 * chasing the pointer above the board and able to carry one die.
 *
 * It is deliberately NOT a raycast target — main.js only ever hands dice
 * hitboxes to the picker — so the hand can never click itself or shadow a
 * die underneath it.
 */
export function createHandCursor({ scene, config = HAND_CONFIG }) {
  const c = config.cursor;
  const scale = c.baseWorldScale * c.scaleReduction;

  const hand = createHand({ outlineWidth: config.outlineWidth * c.outlineWidthMultiplier });
  const rest = restRotationDegrees();
  hand.root.rotation.set(THREE.MathUtils.degToRad(rest.x), THREE.MathUtils.degToRad(rest.y), 0);

  // Tilt lives on its own group, wrapping hand.root: the rest orientation
  // above, and every finger/grip pose inside hand.root, are never written to
  // by the tilt code — it only ever touches tiltGroup.rotation, and "back to
  // rest" for tilt simply means tiltGroup.rotation = (0,0,0), not some
  // recomputed absolute value.
  const tiltGroup = new THREE.Group();
  tiltGroup.name = "manoTilt";

  // Throw wind-up: yet another wrapper, one level ABOVE the cup, carrying the
  // cock-back rotation + recoil offset + slight contraction. Same layering
  // contract as tilt and cup — it only ever writes its OWN transform, so tilt
  // (parent), cup roll (child) and the rest pose (grandchild) all keep
  // working untouched and simply compose. It wraps the right hand ONLY, not
  // leftAnim: when you throw out of a two-handed cup the hands separate (the
  // throwing hand goes back, the other opens away), which is exactly the
  // motion the left hand's own release animation provides.
  const windupGroup = new THREE.Group();
  windupGroup.name = "manoCarga";
  tiltGroup.add(windupGroup);

  // Follow-through: the reaction beat, one more layer under the wind-up. Its
  // own group for the same reason every other layer has one — it writes only
  // its own rotation, so tilt (grandparent), wind-up (parent), cup roll
  // (child) and the rest pose (grandchild) all keep working and simply
  // compose. Sitting UNDER the wind-up is what makes the sequence read as one
  // continuous motion: as the wind-up unwinds after release, this rotation is
  // already spinning out from within it rather than fighting it.
  const followGroup = new THREE.Group();
  followGroup.name = "manoFollowThrough";
  windupGroup.add(followGroup);

  // The right hand's half of the dice cup: while the shake is active this
  // wrapper blends from identity toward cup.right's rotation/offset, rolling
  // the hand (die and all — the die rides holdAnchor inside) into the V of
  // the cup. Sitting BETWEEN the wind-up group and hand.root it leaves the
  // rest rotation on hand.root untouched, same contract as the tilt itself.
  const cupRight = new THREE.Group();
  cupRight.name = "manoCopaDerecha";
  cupRight.add(hand.root);
  followGroup.add(cupRight);

  // --- Left (mirror) hand: the other half of the dice cup -----------------
  // Built once and parked invisible under the SAME tilt group, so it rides
  // the right hand's pointer-follow and lean for free; only its couple-in /
  // couple-out offset+scale animates, on a wrapper of its own.
  const cupCfg = config.cup;
  const leftHand = createHand({
    outlineWidth: config.outlineWidth * c.outlineWidthMultiplier,
    mirrored: true,
  });
  cupCfg.left.pose.forEach((v, i) => leftHand.setFingerCurl(i, v));

  const leftRest = new THREE.Group();
  leftRest.name = "manoIzquierdaPose";
  leftRest.rotation.set(
    THREE.MathUtils.degToRad(cupCfg.left.rotationDeg.x),
    THREE.MathUtils.degToRad(cupCfg.left.rotationDeg.y),
    THREE.MathUtils.degToRad(cupCfg.left.rotationDeg.z)
  );
  leftRest.add(leftHand.root);

  // This wrapper carries the entrance/exit transform (position + uniform
  // scale), kept off leftRest so the cup orientation stays clean.
  const leftAnim = new THREE.Group();
  leftAnim.name = "manoIzquierda";
  leftAnim.add(leftRest);
  leftAnim.visible = false;

  const leftAcople = cupCfg.left.offset;
  const leftEntrance = {
    x: leftAcople.x + cupCfg.entrance.offset.x,
    y: leftAcople.y + cupCfg.entrance.offset.y,
    z: leftAcople.z + cupCfg.entrance.offset.z,
  };

  // Right-half blend targets (identity -> these, by the eased coupling).
  const cupRightQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(cupCfg.right.rotationDeg.x),
      THREE.MathUtils.degToRad(cupCfg.right.rotationDeg.y),
      THREE.MathUtils.degToRad(cupCfg.right.rotationDeg.z)
    )
  );
  const cupRightOffset = new THREE.Vector3(cupCfg.right.offset.x, cupCfg.right.offset.y, cupCfg.right.offset.z);
  const IDENTITY_QUAT = new THREE.Quaternion();
  const ZERO_VEC = new THREE.Vector3();

  // Thumb splay fine-tuning for the front of the cup: each rig's thumb base
  // keeps its authored splay at rest, and folds in by thumbSplayDeg as the
  // cup forms (same eased coupling as everything else).
  const thumbBaseRight = hand.root.getObjectByName("pulgarBase");
  const thumbBaseLeft = leftHand.root.getObjectByName("pulgarBase");
  const thumbRestZ = thumbBaseRight.rotation.z; // same authored value in both rigs
  const thumbSplayRight = THREE.MathUtils.degToRad(cupCfg.right.thumbSplayDeg);
  const thumbSplayLeft = THREE.MathUtils.degToRad(cupCfg.left.thumbSplayDeg);

  const pivot = new THREE.Group();
  pivot.name = "manoCursor";
  // The rig models a hand standing upright (fingers +Y, palm +Z), but the
  // scene camera is orthographic looking straight down. -90° about X tips it
  // flat: fingers head to -Z (screen "up", since camera.up is (0,0,-1)) and
  // the palm turns to +Y, facing the camera.
  pivot.rotation.x = -Math.PI / 2;
  pivot.scale.setScalar(scale);
  pivot.add(tiltGroup);
  tiltGroup.add(leftAnim);
  pivot.visible = false;
  scene.add(pivot);

  let height = 8;
  const target = new THREE.Vector2(0, 0);
  let hasTarget = false;

  // Everything time-based runs off this frame-driven clock rather than
  // performance.now(), so the grip tween and the release velocity always
  // agree with the dt the caller is stepping us by.
  let clockMs = 0;

  // Grip animation state: a single 0..1 curl applied to all five fingers.
  let gripFrom = 0;
  let gripTo = 0;
  let gripStart = -1;
  let gripDuration = c.gripDurationMs;
  let currentGrip = 0;

  // Hover-feedback state: `hoverTarget` is set from outside (main forwards the
  // picker's result); `hoverBlend` eases 0..1 toward it and drives how far the
  // empty hand leans into the "disposition" pose. `lastEmptyRestCurl` records
  // where the empty fingers sit each frame, so a grab can start its grip tween
  // from exactly there (no jump from hover-pose into the fist).
  const hoverCfg = c.hover;
  let hoverTarget = false;
  let hoverBlend = 0;
  let lastEmptyRestCurl = config.idle.base;

  const heldDice = []; // records currently carried, in the order grabbed

  const history = []; // hand world positions, for release velocity

  // --- Tilt state -----------------------------------------------------
  const tiltCfg = config.tilt;
  const maxTiltX = THREE.MathUtils.degToRad(tiltCfg.maxTiltXDeg);
  const maxTiltY = THREE.MathUtils.degToRad(tiltCfg.maxTiltYDeg);
  const velocityToTiltRad = THREE.MathUtils.degToRad(tiltCfg.velocityToTilt);
  const tiltSignX = tiltCfg.invertTiltX ? -1 : 1;
  const tiltSignY = tiltCfg.invertTiltY ? -1 : 1;

  let prevPivotX = 0;
  let prevPivotZ = 0;
  let smoothedVelX = 0;
  let smoothedVelZ = 0;
  let tiltAngleX = 0;
  let tiltAngleY = 0;
  let tiltSpringVelX = 0; // angular velocity of the idle-return spring
  let tiltSpringVelY = 0;

  // --- Shake detection + left-hand coupling ---------------------------
  const shakeCfg = config.shake;
  const swingChanges = []; // clockMs timestamps of significant horizontal reversals
  let lastSwingSign = 0; // sign of the last swing that cleared the speed bar
  let shakeActive = false; // hysteretic: harder to arm than to sustain
  let belowReleaseSince = -1;
  let leftState = "hidden"; // hidden | entering | visible | exiting
  let coupling = 0; // 0..1 couple-in progress
  let couplingEased = 0; // easeOutCubic(coupling), shared with the finger blend
  // Set when the dice leave while the left hand is on screen: turns the
  // normal shake-ended retreat into the faster "open the hands and let go"
  // release (see releaseAll + the left-hand block in update).
  let leftReleasing = false;
  let leftOpenBlend = 0; // 0..1 how far the left fingers have splayed open on release

  // --- Throw anticipation (wind-up / micro-hold) ----------------------
  // State machine:
  //   idle -> winding -> [hold] -> charged -> recovering -> idle
  // "charged" is full wind-up held while the gesture continues; "hold" is the
  // brief near-freeze at the top of the charge that only fast throws get.
  // Any state drops straight to "recovering" the moment the gesture slows
  // (user changed their mind) or the dice actually leave (follow-through).
  const throwCfg = c.throwAnim;
  const windupMaxAngle = THREE.MathUtils.degToRad(throwCfg.maxAngleDeg);
  let windupState = "idle";
  let windupAmount = 0; // 0..1 ramp progress
  let windupIntensity = 0; // 0..1 from gesture speed — how strong the pose reads
  let windupPeakSpeed = 0; // max speed seen this gesture, decides hold eligibility
  let windupDirX = 0; // gesture direction in the rig's local screen frame...
  let windupDirY = 0; // ...(local X = world X, local Y = world -Z)
  let holdStartMs = 0;
  let windupCurlAdd = 0; // extra finger clamp this frame, applied in the finger loop
  let throwVelX = 0; // dedicated fast EMA of the gesture velocity (see config note)
  let throwVelZ = 0;

  // --- Follow-through (reaction) --------------------------------------
  // idle -> rotating -> holding -> returning -> idle. Targets are captured
  // once, from the release velocity, then played out open-loop — the gesture
  // is over by then, so nothing here reads live input.
  const ftCfg = c.followThrough;
  let ftState = "idle";
  let ftProgress = 0; // 0..1 raw ramp during "rotating"
  let ftAmount = 0; // applied 0..1 (eased on the way out, sprung on the way back)
  let ftVel = 0; // spring velocity for the damped return
  let ftHoldStart = 0;
  let ftTargetY = 0; // captured supination/pronation angle (radians)
  let ftTargetX = 0; // captured up/down tip angle (radians)

  // --- Release resistance ---------------------------------------------
  // A short window after a real throw where the hand chases the pointer more
  // slowly, so it lags behind the die instead of overtaking it. Purely a
  // multiplier on the follow rate — the target keeps updating normally, so
  // no input is ever dropped or delayed.
  const resistCfg = c.releaseResistance;
  let resistElapsed = 0; // ms into the window
  let resistDuration = 0; // 0 = not resisting
  let resistStrength = 1; // follow-rate multiplier at the START of the window

  /**
   * Arms the resistance window from the throw's own velocity. Same speed
   * gate as the follow-through, so a no-velocity deposit arms nothing.
   */
  function startReleaseResistance(velX, velZ) {
    if (!resistCfg.enabled) return false;
    const speed = Math.hypot(velX, velZ);
    if (speed < resistCfg.minSpeed) return false;

    let force = 1;
    if (resistCfg.scalesWithForce) {
      const span = Math.max(resistCfg.fullSpeed - resistCfg.minSpeed, 1e-4);
      const t = THREE.MathUtils.clamp((speed - resistCfg.minSpeed) / span, 0, 1);
      // Lerp from a floor rather than from 0, so crossing the threshold isn't
      // a visible on/off step.
      force = THREE.MathUtils.lerp(resistCfg.minForceFraction, 1, t);
    }

    resistDuration = resistCfg.durationMs * force;
    // Weaker throws also drag less hard, not just for less time.
    resistStrength = THREE.MathUtils.lerp(1, resistCfg.strength, force);
    resistElapsed = 0;
    return true;
  }

  /**
   * 0..1 recovery fraction at `elapsedMs` into a `durationMs` window: flat at
   * 0 (full resistance) through `sustainFraction`, then an easeInOutCubic
   * climb to 1. The plateau is what makes the drag actually readable — a
   * curve that starts recovering immediately is mostly gone before the eye
   * catches it. easeInOutCubic (not easeOutCubic) for the climb so the join
   * where the plateau ends has zero slope on both sides, and the hand still
   * decelerates INTO full speed rather than snapping onto it.
   */
  function resistanceRecovery(elapsedMs, durationMs, sustainFraction) {
    const t = elapsedMs / durationMs;
    if (t <= sustainFraction) return 0;
    const span = Math.max(1 - sustainFraction, 1e-4);
    return easeInOutCubic((t - sustainFraction) / span);
  }

  /** Drops the window immediately (grabbing a die must never feel blocked). */
  function clearReleaseResistance() {
    resistDuration = 0;
    resistElapsed = 0;
    resistStrength = 1;
  }

  // --- Zone scale: smaller over the source strip, full size over the board.
  // `zoneBounds` is the board rectangle (fed in from main.js, the same one
  // that decides where a released die lands), null until the caller sets it.
  // `inOriginZone` is the last resolved side of the hysteresis gap, so
  // straddling the boundary can't flip it back and forth every frame.
  const zoneCfg = c.zoneScale;
  let zoneBounds = null;
  let inOriginZone = false;
  let zoneScaleFrom = 1;
  let zoneScaleTo = 1;
  let zoneScaleStart = 0;
  let zoneScaleCurrent = 1;

  /** Board rectangle the hand's own position is checked against each frame. */
  function setZoneBounds(bounds) {
    zoneBounds = bounds;
  }

  /** Starts (or redirects, from wherever it currently sits) the size tween. */
  function startZoneScale(toScale) {
    if (toScale === zoneScaleTo) return; // already headed there
    zoneScaleFrom = zoneScaleCurrent;
    zoneScaleTo = toScale;
    zoneScaleStart = clockMs;
  }

  /**
   * Resolves which zone the hand's own rendered position is in, with a dead
   * zone straddling the board edge: growing back to full size requires being
   * `zoneHysteresisMargin` world units INSIDE the board, shrinking requires
   * being that far OUTSIDE it. Whichever side was last resolved holds for
   * anything in between, so resting on the seam can't flicker.
   */
  function updateZoneScale() {
    if (zoneBounds) {
      const m = zoneCfg.zoneHysteresisMargin;
      const dx = Math.abs(pivot.position.x - zoneBounds.centerX);
      const dz = Math.abs(pivot.position.z - zoneBounds.centerZ);
      if (inOriginZone) {
        const clearlyOverBoard = dx <= zoneBounds.halfWidth - m && dz <= zoneBounds.halfDepth - m;
        if (clearlyOverBoard) {
          inOriginZone = false;
          startZoneScale(1);
        }
      } else {
        const clearlyOverSource = dx > zoneBounds.halfWidth + m || dz > zoneBounds.halfDepth + m;
        if (clearlyOverSource) {
          inOriginZone = true;
          startZoneScale(zoneCfg.originZoneHandScale);
        }
      }
    }

    const duration = zoneCfg.handScaleTransitionDuration;
    const t = duration > 0 ? THREE.MathUtils.clamp((clockMs - zoneScaleStart) / duration, 0, 1) : 1;
    zoneScaleCurrent = THREE.MathUtils.lerp(zoneScaleFrom, zoneScaleTo, easeOutCubic(t));
  }

  // --- UI-zone fade: shrinks the hand toward invisible while the pointer is
  // over page UI, unless a die is held (see handConfig.js's uiFade block for
  // why this is a scale tween and not a true opacity fade). Composes with
  // zoneScale on the same final pivot.scale write below, so either can be
  // mid-transition without the two fighting over the pivot's transform.
  const uiCfg = c.uiFade;
  let uiHidden = false;
  let uiFadeFrom = 1;
  let uiFadeTo = 1;
  let uiFadeStart = 0;
  let uiFadeCurrent = 1;

  /** Redirects (from wherever the tween currently sits) toward shown/hidden. */
  function setUIHidden(hidden) {
    hidden = !!hidden;
    if (hidden === uiHidden) return;
    uiHidden = hidden;
    uiFadeFrom = uiFadeCurrent;
    uiFadeTo = hidden ? uiCfg.hiddenScale : 1;
    uiFadeStart = clockMs;
  }

  function updateUIFade() {
    const duration = uiCfg.transitionDuration;
    const t = duration > 0 ? THREE.MathUtils.clamp((clockMs - uiFadeStart) / duration, 0, 1) : 1;
    uiFadeCurrent = THREE.MathUtils.lerp(uiFadeFrom, uiFadeTo, easeOutCubic(t));
  }

  /** 1 = fully shown, `uiCfg.hiddenScale` = fully hidden; for the native-cursor decision in main.js. */
  function getUIFade() {
    return uiFadeCurrent;
  }

  /**
   * Captures the follow-through pose from the throw's own velocity vector.
   * Direction picks the sense of each axis, speed picks the magnitude.
   * Returns false (and arms nothing) for a no-velocity deposit.
   */
  function startFollowThrough(velX, velZ) {
    const speed = Math.hypot(velX, velZ);
    if (speed < ftCfg.minSpeed) return false;

    const span = Math.max(ftCfg.fullSpeed - ftCfg.minSpeed, 1e-4);
    const mag = THREE.MathUtils.clamp((speed - ftCfg.minSpeed) / span, 0, 1);
    const dirX = velX / speed; // +1 = throw screen-right
    const dirZ = velZ / speed; // +1 = throw screen-down

    // Longitudinal axis (local Y): left throw supinates a long way (palm ends
    // up), right throw pronates a short way (palm stays hidden). -dirX gives
    // left a positive roll; the per-side magnitude is what distinguishes them.
    const sideMax = dirX < 0 ? ftCfg.supinationDeg : ftCfg.pronationDeg;
    ftTargetY = -dirX * mag * THREE.MathUtils.degToRad(sideMax) * (ftCfg.invertY ? -1 : 1);
    // Screen-vertical component tips the hand along the gesture; up and down
    // land on opposite signs by construction.
    ftTargetX = -dirZ * mag * THREE.MathUtils.degToRad(ftCfg.maxRotationXDeg) * (ftCfg.invertX ? -1 : 1);

    ftState = "rotating";
    ftProgress = 0;
    ftAmount = 0;
    ftVel = 0;
    return true;
  }

  function setVisible(visible) {
    pivot.visible = visible;
  }

  function setHeight(y) {
    height = y;
    pivot.position.y = y;
  }

  /** Where the hand should chase to, in world XZ (from the pointer ray). */
  function setTarget(x, z) {
    target.set(x, z);
    if (!hasTarget) {
      // First sight of the pointer: teleport rather than sweep in from origin.
      pivot.position.set(x, height, z);
      hasTarget = true;
    }
  }

  /**
   * Hover feedback toggle, driven from main with the same picker result the
   * grab uses. Just records intent; the eased blend + the "only while empty"
   * gate live in update(), so this can't fight the grip or the tilt.
   */
  function setHover(on) {
    hoverTarget = !!on;
  }

  function startGrip(toCurl, durationMs = c.gripDurationMs) {
    gripFrom = currentGrip;
    gripTo = toCurl;
    gripDuration = durationMs;
    gripStart = clockMs;
  }

  const clusterCfg = c.cluster;

  /** Deterministic [-0.5, 0.5) hash so a die's jitter is stable across re-layouts. */
  function jitterAt(seed) {
    const s = Math.sin(seed * 127.1) * 43758.5453;
    return (s - Math.floor(s)) - 0.5;
  }

  /**
   * Positions every held die in the palm as a phyllotaxis spiral: die 0 at
   * the centre, the rest fanned out by golden angle so the pile packs evenly
   * at any count, capped at maxRadius so a big handful can't spill out. Each
   * die keeps a stable per-slot jitter so the pile looks tossed-in. All in
   * the hold anchor's local space; the anchor rides inside the palm, so the
   * whole pile inherits the hand's motion (and the cup roll) for free.
   */
  function layoutCluster() {
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < heldDice.length; i++) {
      const rec = heldDice[i];
      const r = Math.min(clusterCfg.spacing * Math.sqrt(i), clusterCfg.maxRadius);
      const th = i * golden;
      const x = clusterCfg.center.x + Math.cos(th) * r + jitterAt(i * 3 + 1) * clusterCfg.jitter;
      const y = clusterCfg.center.y + Math.sin(th) * r + jitterAt(i * 3 + 2) * clusterCfg.jitter;
      const z = -clusterCfg.recess + jitterAt(i * 3 + 3) * clusterCfg.jitterZ;
      rec.group.position.set(x, y, z);
      rec.group.quaternion.copy(rec.dieType.standardQuaternion);
      // Held dice are shrunk so a handful fits the palm; they're restored to
      // board size by the throw/drop/return paths the moment they leave.
      rec.group.scale.setScalar((rec._holdWorldScale * clusterCfg.holdScaleMultiplier) / scale);
    }
  }

  /** Fist closes on the tightest single die, opening a little per extra die. */
  function aggregateGrip() {
    if (heldDice.length === 0) return 0;
    let maxCurl = 0;
    for (const rec of heldDice) maxCurl = Math.max(maxCurl, rec._holdGripCurl);
    const open = clusterCfg.gripOpenPerDie * (heldDice.length - 1);
    return THREE.MathUtils.clamp(maxCurl - open, clusterCfg.gripMin, 1);
  }

  /**
   * Adds a die to the handful. Its Object3D is reparented under the palm's
   * hold anchor with a *local* transform, so from then on it just inherits
   * the hand's motion — no per-frame copying, no drift out of the palm.
   * `dieWorldScale` is world-space, so it's divided by the cursor's own scale
   * to land in the anchor's local units.
   */
  function hold(record, { dieWorldScale, gripCurl }) {
    if (heldDice.includes(record)) return;
    // Grabbing outranks the post-throw drag: the moment the player reaches for
    // another die the hand must track at full speed again, or the interaction
    // feels blocked. Cheap and unconditional — clearing an inactive window is
    // a no-op.
    clearReleaseResistance();
    const wasEmpty = heldDice.length === 0;
    hand.holdAnchor.add(record.group);
    record._holdWorldScale = dieWorldScale;
    record._holdGripCurl = gripCurl;
    heldDice.push(record);
    layoutCluster();
    // First grab: begin the grip tween from wherever the fingers already are
    // (idle, or partway into the hover pose), so hover flows into the grab
    // with no snap. Later adds keep the current grip.
    if (wasEmpty) currentGrip = lastEmptyRestCurl;
    startGrip(aggregateGrip());
  }

  /**
   * Takes ONE die back out of the hand, re-attaching it to the scene with
   * `attach()` (preserving its world transform, so no visible jump). The rest
   * of the pile stays and re-packs. Returns the removed record (or null).
   */
  function releaseOne(record) {
    const idx = heldDice.indexOf(record);
    if (idx === -1) return null;
    heldDice.splice(idx, 1);
    scene.attach(record.group);
    layoutCluster();
    startGrip(heldDice.length ? aggregateGrip() : 0);
    return record;
  }

  /**
   * Empties the whole hand at once. Each die is re-attached to the scene
   * (world transform preserved — they scatter from their cluster positions),
   * and returned in grab order so the caller can route each to its
   * destination. The hand opens back up.
   */
  function releaseAll() {
    const out = heldDice.slice();
    for (const rec of out) scene.attach(rec.group);
    heldDice.length = 0;
    startGrip(0);
    // Anticipation/reaction bookkeeping ONLY — deliberately after the dice are
    // already detached and about to be returned. These lines just flip state
    // that the next update() reads; none of them waits on an animation, so the
    // dice leave on this very call no matter what the wind-up was doing.
    // Whatever charge was built simply decays from here while the
    // follow-through spins out on its own layer.
    if (windupState !== "idle") windupState = "recovering";
    if (leftAnim.visible) leftReleasing = true;
    // Reads the hand's own measured velocity — the SAME source main.js passes
    // to the throw — so the rotation always matches where the dice actually
    // went. A no-velocity deposit arms nothing (startFollowThrough bails).
    const relVel = getVelocity();
    startFollowThrough(relVel.x, relVel.z);
    // Same velocity, same gate: the drag-behind and the wrist rotation are two
    // halves of one "the hand spends itself" beat, so they arm together and
    // run over the same window.
    startReleaseResistance(relVel.x, relVel.z);
    return out;
  }

  function isHoldingAny() {
    return heldDice.length > 0;
  }

  function isHeldByHand(record) {
    return heldDice.includes(record);
  }

  function getHeldDice() {
    return heldDice.slice();
  }

  /** Release velocity in world units/s, measured on the hand itself. */
  function getVelocity() {
    if (history.length < 2) return { x: 0, z: 0 };
    const newest = history[history.length - 1];
    let oldest = history[0];
    for (let i = history.length - 1; i >= 0; i--) {
      if (newest.t - history[i].t <= c.velocityWindowMs) oldest = history[i];
      else break;
    }
    const dt = (newest.t - oldest.t) / 1000;
    if (dt <= 0) return { x: 0, z: 0 };
    return { x: (newest.x - oldest.x) / dt, z: (newest.z - oldest.z) / dt };
  }

  function getPosition() {
    return { x: pivot.position.x, z: pivot.position.z };
  }

  function update(dt, timeSeconds) {
    if (!pivot.visible) return;

    // Post-throw resistance: scales the follow rate down, holds it there for
    // most of the window, then eases back to normal (see resistanceRecovery
    // above for why it's a plateau-then-ease rather than a straight ease).
    let followRate = c.followLerpPerSecond;
    if (resistDuration > 0) {
      resistElapsed += dt * 1000;
      if (resistElapsed >= resistDuration) {
        clearReleaseResistance();
      } else {
        const recovered = resistanceRecovery(resistElapsed, resistDuration, resistCfg.sustainFraction);
        followRate *= THREE.MathUtils.lerp(resistStrength, 1, recovered);
      }
    }

    // Exponential smoothing: framerate-independent, so the chase feels the
    // same at 60 and 144 fps (a raw per-frame lerp would not).
    if (hasTarget && dt > 0) {
      const alpha = 1 - Math.exp(-followRate * dt);
      pivot.position.x += (target.x - pivot.position.x) * alpha;
      pivot.position.z += (target.y - pivot.position.z) * alpha;
    }
    pivot.position.y = height;

    clockMs += dt * 1000;
    history.push({ x: pivot.position.x, z: pivot.position.z, t: clockMs });
    if (history.length > c.velocityHistory) history.shift();

    updateZoneScale();
    updateUIFade();
    // Held dice are parented under the palm, inside this same pivot, so they
    // pick up both factors automatically through the transform hierarchy —
    // nothing else needs to touch their scale for them to shrink/grow/fade in
    // lockstep (see hold()/layoutCluster()'s local-space math).
    pivot.scale.setScalar(scale * zoneScaleCurrent * uiFadeCurrent);

    // Grip tween.
    if (gripStart >= 0) {
      const t = Math.min((clockMs - gripStart) / gripDuration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      currentGrip = THREE.MathUtils.lerp(gripFrom, gripTo, eased);
      if (t >= 1) gripStart = -1;
    }

    // --- Tilt: purely additive lean on tiltGroup, driven by the hand's own
    // (smoothed) motion. Never touches hand.root's rest rotation.
    if (dt > 0) {
      const rawVelX = (pivot.position.x - prevPivotX) / dt;
      const rawVelZ = (pivot.position.z - prevPivotZ) / dt;
      prevPivotX = pivot.position.x;
      prevPivotZ = pivot.position.z;

      // Shake = horizontal velocity flipping sign several times quickly. Uses
      // the RAW per-frame vx (not the tilt's smoothed one) so a genuine
      // side-to-side reversal isn't averaged away; reads position only, so it
      // can't perturb the tilt or the release-velocity history. A straight
      // fast move keeps one sign => never accumulates flips => never triggers.
      const speedBar = shakeActive ? shakeCfg.velocityReleaseThreshold : shakeCfg.velocityThreshold;
      if (Math.abs(rawVelX) > speedBar) {
        const sign = rawVelX > 0 ? 1 : -1;
        if (lastSwingSign !== 0 && sign !== lastSwingSign) swingChanges.push(clockMs);
        lastSwingSign = sign;
      }
      while (swingChanges.length && clockMs - swingChanges[0] > shakeCfg.windowMs) swingChanges.shift();
      const changeCount = swingChanges.length;

      if (!shakeActive) {
        if (heldDice.length && changeCount >= shakeCfg.directionChanges) {
          shakeActive = true;
          belowReleaseSince = -1;
        }
      } else if (!heldDice.length || changeCount < shakeCfg.directionChangesRelease) {
        if (belowReleaseSince < 0) belowReleaseSince = clockMs;
        if (clockMs - belowReleaseSince >= shakeCfg.releaseDelayMs) shakeActive = false;
      } else {
        belowReleaseSince = -1;
      }

      // EMA over raw per-frame velocity: absorbs mouse jitter before it ever
      // reaches the tilt target, framerate-independent.
      const velAlpha = 1 - Math.exp(-tiltCfg.tiltSmoothing * dt);
      smoothedVelX += (rawVelX - smoothedVelX) * velAlpha;
      smoothedVelZ += (rawVelZ - smoothedVelZ) * velAlpha;

      const speed = Math.hypot(smoothedVelX, smoothedVelZ);
      const idleNow = speed < tiltCfg.idleThreshold;
      const holdMul = heldDice.length ? tiltCfg.holdingTiltMultiplier : 1;

      if (idleNow) {
        // Damped spring back to exactly 0 — a slight underdamped overshoot
        // reads as weight settling, not a dead stop.
        const stiffness = tiltCfg.returnSpeed * tiltCfg.returnSpeed;
        const dampCoeff = 2 * tiltCfg.damping * tiltCfg.returnSpeed;

        const forceX = -stiffness * tiltAngleX - dampCoeff * tiltSpringVelX;
        tiltSpringVelX += forceX * dt;
        tiltAngleX += tiltSpringVelX * dt;

        const forceY = -stiffness * tiltAngleY - dampCoeff * tiltSpringVelY;
        tiltSpringVelY += forceY * dt;
        tiltAngleY += tiltSpringVelY * dt;

        // Snap once settled so "at rest" is exactly (0,0), not an
        // asymptotic sliver — matters since the rest pose must be pixel-
        // identical every time the hand goes idle.
        if (Math.abs(tiltAngleX) < 5e-4 && Math.abs(tiltSpringVelX) < 1e-3) {
          tiltAngleX = 0;
          tiltSpringVelX = 0;
        }
        if (Math.abs(tiltAngleY) < 5e-4 && Math.abs(tiltSpringVelY) < 1e-3) {
          tiltAngleY = 0;
          tiltSpringVelY = 0;
        }
      } else {
        // Screen-right/-down map to world +X/+Z under this top-down camera;
        // moving right yaws the hand one way, moving down pitches it one way.
        const targetTiltY = THREE.MathUtils.clamp(smoothedVelX * velocityToTiltRad, -maxTiltY, maxTiltY) * tiltSignY * holdMul;
        const targetTiltX = THREE.MathUtils.clamp(smoothedVelZ * velocityToTiltRad, -maxTiltX, maxTiltX) * tiltSignX * holdMul;

        const angleAlpha = 1 - Math.exp(-tiltCfg.tiltSmoothing * dt);
        tiltAngleX += (targetTiltX - tiltAngleX) * angleAlpha;
        tiltAngleY += (targetTiltY - tiltAngleY) * angleAlpha;
        // Fresh spring velocity whenever motion resumes/stops, so the next
        // idle phase always settles from rest instead of inheriting stale energy.
        tiltSpringVelX = 0;
        tiltSpringVelY = 0;
      }

      tiltGroup.rotation.x = tiltAngleX;
      tiltGroup.rotation.y = tiltAngleY;

      // --- Throw anticipation ------------------------------------------
      // Its own fast EMA over the same raw per-frame velocity the tilt and
      // shake read (see velocitySmoothing in config for why the tilt's slower
      // one can't be reused). Writes only windupGroup, so tilt/cup/rest/idle
      // are all untouched.
      const throwAlpha = 1 - Math.exp(-throwCfg.velocitySmoothing * dt);
      throwVelX += (rawVelX - throwVelX) * throwAlpha;
      throwVelZ += (rawVelZ - throwVelZ) * throwAlpha;
      const throwSpeed = Math.hypot(throwVelX, throwVelZ);

      const throwIntent = heldDice.length > 0 && throwSpeed >= throwCfg.intentVelocity;

      // Track the gesture direction while charging, but NOT during the hold —
      // freezing it is what makes the hold read as a held pose rather than a
      // pose that keeps drifting with the mouse.
      if (throwIntent && throwSpeed > 1e-4 && windupState !== "hold") {
        windupDirX = throwVelX / throwSpeed;
        windupDirY = -throwVelZ / throwSpeed; // local Y is world -Z (screen up)
        // Proportional to gesture speed, capped: a hard flick reads much
        // more loaded than a lazy one, but never past the authored maximum.
        const span = Math.max(throwCfg.fullVelocity - throwCfg.intentVelocity, 1e-4);
        windupIntensity = THREE.MathUtils.clamp((throwSpeed - throwCfg.intentVelocity) / span, 0, 1);
      }

      const windStep = throwCfg.windupDurationMs > 0 ? (dt * 1000) / throwCfg.windupDurationMs : 1;
      const recoverStep = throwCfg.recoverDurationMs > 0 ? (dt * 1000) / throwCfg.recoverDurationMs : 1;

      if (windupState === "idle") {
        if (throwIntent) {
          windupState = "winding";
          windupPeakSpeed = throwSpeed;
        }
      } else if (windupState === "winding") {
        windupPeakSpeed = Math.max(windupPeakSpeed, throwSpeed);
        if (!throwIntent) {
          windupState = "recovering"; // slowed without releasing: unwind gracefully
        } else {
          windupAmount = Math.min(1, windupAmount + windStep);
          if (windupAmount >= 1) {
            // Only a genuinely hard throw earns the micro-hold.
            const earnsHold = windupPeakSpeed >= throwCfg.holdMinVelocity && throwCfg.holdDurationMs > 0;
            windupState = earnsHold ? "hold" : "charged";
            holdStartMs = clockMs;
          }
        }
      } else if (windupState === "hold") {
        if (!throwIntent) windupState = "recovering";
        else if (clockMs - holdStartMs >= throwCfg.holdDurationMs) windupState = "charged";
      } else if (windupState === "charged") {
        windupPeakSpeed = Math.max(windupPeakSpeed, throwSpeed);
        if (!throwIntent) windupState = "recovering";
      } else if (windupState === "recovering") {
        windupAmount = Math.max(0, windupAmount - recoverStep);
        if (throwIntent && heldDice.length > 0) {
          windupState = "winding"; // picked the gesture back up mid-unwind
        } else if (windupAmount <= 0) {
          windupState = "idle";
          windupPeakSpeed = 0;
          windupIntensity = 0;
        }
      }

      // How strongly the pose reads right now: ramp progress x gesture
      // strength. easeOutCubic front-loads it so the charge is visible almost
      // immediately rather than creeping in over the full duration.
      const windupBlend = easeOutCubic(windupAmount) * windupIntensity;
      const lean = windupMaxAngle * windupBlend;
      // A near-freeze still needs a pulse of life, or it reads as a dropped
      // frame instead of a held beat.
      const holdMicro =
        windupState === "hold" ? Math.sin(clockMs * 0.06) * throwCfg.holdMicroAmp : 0;

      // Cock BACK = rotate so the fingertips travel opposite the gesture.
      // About local Z: fingertips swing across the screen plane (horizontal
      // gestures). About local X: fingertips rear up toward the camera
      // (vertical gestures). Recoil translates the whole hand the other way.
      windupGroup.rotation.z = lean * windupDirX + holdMicro;
      windupGroup.rotation.x = lean * windupDirY;
      windupGroup.position.x = -windupDirX * throwCfg.backDistance * windupBlend;
      windupGroup.position.y = -windupDirY * throwCfg.backDistance * windupBlend;
      windupGroup.scale.setScalar(THREE.MathUtils.lerp(1, throwCfg.scaleContraction, windupBlend));
      windupCurlAdd = throwCfg.extraCurl * windupBlend;

      // --- Follow-through ----------------------------------------------
      // Pure playback of the pose captured at release; never reads live
      // input, so it can't be perturbed by whatever the pointer does after
      // the throw. Writes only followGroup.
      if (ftState === "rotating") {
        ftProgress = Math.min(1, ftProgress + (dt * 1000) / Math.max(ftCfg.durationMs, 1e-4));
        ftAmount = easeOutCubic(ftProgress); // fast out, decelerating — a motion spending itself
        if (ftProgress >= 1) {
          ftState = "holding";
          ftHoldStart = clockMs;
        }
      } else if (ftState === "holding") {
        ftAmount = 1;
        if (clockMs - ftHoldStart >= ftCfg.holdDurationMs) {
          ftState = "returning";
          ftVel = 0;
        }
      } else if (ftState === "returning") {
        // Damped spring back to 0 rather than an eased ramp: returnDamping < 1
        // gives a little overshoot, so the hand *settles* instead of snapping
        // to rest. Framerate-independent (integrated against dt).
        const omega = (2 * Math.PI) / Math.max(ftCfg.returnDurationMs / 1000, 1e-4);
        ftVel += (-omega * omega * ftAmount - 2 * ftCfg.returnDamping * omega * ftVel) * dt;
        ftAmount += ftVel * dt;
        if (Math.abs(ftAmount) < 1e-3 && Math.abs(ftVel) < 1e-2) {
          ftAmount = 0;
          ftVel = 0;
          ftState = "idle";
        }
      }

      followGroup.rotation.y = ftTargetY * ftAmount;
      followGroup.rotation.x = ftTargetX * ftAmount;

      // Left hand couples in while shaking a full hand, out otherwise (which
      // also covers letting the dice go: empty hand flips wantVisible false).
      const wantVisible = shakeActive && heldDice.length > 0;
      if (wantVisible && leftState !== "visible") leftState = "entering";
      else if (!wantVisible && (leftState === "visible" || leftState === "entering")) leftState = "exiting";

      // Letting the dice go gets its own, faster exit than "the shake just
      // petered out" — the retreat has to land with the throw, not trail it.
      const exitMs = leftReleasing ? throwCfg.leftReleaseDurationMs : shakeCfg.couplingMs;
      const enterStep = (dt * 1000) / shakeCfg.couplingMs;
      const exitStep = (dt * 1000) / Math.max(exitMs, 1e-4);
      if (leftState === "entering") {
        coupling = Math.min(1, coupling + enterStep);
        if (coupling >= 1) leftState = "visible";
      } else if (leftState === "exiting") {
        coupling = Math.max(0, coupling - exitStep);
        if (coupling <= 0) {
          leftState = "hidden";
          leftReleasing = false; // fully off screen: back to the normal retreat next time
        }
      }

      couplingEased = easeOutCubic(coupling);
      const e = couplingEased;

      // Linear (not eased) so the opening starts the instant the dice leave —
      // easeOutCubic on the way down is back-loaded, which would delay the
      // visible "hands open" past the moment it's meant to punctuate.
      const leftOpen = leftReleasing ? 1 - coupling : 0;

      leftAnim.visible = leftState !== "hidden";
      if (leftAnim.visible) {
        const rel = throwCfg.leftReleaseOffset;
        leftAnim.position.set(
          THREE.MathUtils.lerp(leftEntrance.x, leftAcople.x, e) + rel.x * leftOpen,
          THREE.MathUtils.lerp(leftEntrance.y, leftAcople.y, e) + rel.y * leftOpen,
          THREE.MathUtils.lerp(leftEntrance.z, leftAcople.z, e) + rel.z * leftOpen
        );
        leftAnim.scale.setScalar(THREE.MathUtils.lerp(cupCfg.entrance.scale, 1, e));
      }
      leftOpenBlend = leftOpen; // consumed by the left finger loop below

      // Right half rolls into (and back out of) the cup with the same eased
      // coupling, so both halves of the V arrive/leave in step. At e=0 this
      // is exactly identity — the wrapper is inert outside the shake.
      cupRight.quaternion.slerpQuaternions(IDENTITY_QUAT, cupRightQuat, e);
      cupRight.position.lerpVectors(ZERO_VEC, cupRightOffset, e);

      // Thumbs fold in over the front seam as the cup forms; back to the
      // authored splay when it dissolves.
      thumbBaseRight.rotation.z = thumbRestZ + thumbSplayRight * e;
      thumbBaseLeft.rotation.z = thumbRestZ + thumbSplayLeft * e;
    }

    // Hover feedback only means anything with an empty hand — a hover while
    // carrying a handful must not curl the fingers (they're busy holding).
    // Framerate-independent: ramp toward the target over the configured ms.
    const hoverActive = hoverTarget && heldDice.length === 0;
    const hoverDur = hoverActive ? hoverCfg.enterDurationMs : hoverCfg.exitDurationMs;
    const hoverStep = hoverDur > 0 ? (dt * 1000) / hoverDur : 1;
    hoverBlend = hoverActive
      ? Math.min(1, hoverBlend + hoverStep)
      : Math.max(0, hoverBlend - hoverStep);

    const idle = config.idle;
    // The empty hand's resting curl this frame, minus the per-finger micro:
    // the idle wave crossfaded toward the disposition pose by hoverBlend. A
    // first grab starts its grip tween here so the hover flows into the fist.
    lastEmptyRestCurl = THREE.MathUtils.lerp(idle.base, hoverCfg.curlAmount, hoverBlend);
    for (let i = 0; i < hand.fingerCount; i++) {
      const phase = 2 * Math.PI * idle.freqHz * timeSeconds + i * idle.phaseStep;
      const micro = c.holdIdleAmp * Math.sin(phase);
      let curl;
      if (heldDice.length) {
        // Firm hold, with only a whisper of motion so it doesn't look frozen.
        curl = currentGrip + micro;
      } else {
        // Empty: the base is the idle wave (or the tail of a release-open
        // tween), crossfaded toward the subtle "disposition" pose while
        // hovering a grabbable die. hoverBlend=0 leaves the idle untouched.
        const idleBase = gripStart >= 0 ? currentGrip : idle.base + idle.amp * Math.sin(phase);
        const hoverPose = hoverCfg.curlAmount + hoverCfg.microAmp * Math.sin(phase);
        curl = THREE.MathUtils.lerp(idleBase, hoverPose, hoverBlend);
      }
      // While the cup is (partly) formed, relax from the tight grip toward
      // the hollow half-open cup wall — the die is enclosed by BOTH palms
      // now, so the right hand doesn't need to clench it alone.
      if (couplingEased > 0) curl = THREE.MathUtils.lerp(curl, cupCfg.right.pose[i] + micro, couplingEased);
      // Wind-up clamps down LAST, on top of whatever pose won above, so the
      // "grip tightens before the throw" beat still reads even mid-cup (where
      // the cup blend would otherwise have flattened it away).
      if (windupCurlAdd > 0) curl = Math.min(1, curl + windupCurlAdd);
      hand.setFingerCurl(i, curl);
    }

    // Left hand keeps its hollowed pose with a whisper of motion, only while
    // it's actually on screen — no cost when it's put away.
    if (leftAnim.visible) {
      for (let i = 0; i < leftHand.fingerCount; i++) {
        const micro = c.holdIdleAmp * Math.sin(2 * Math.PI * idle.freqHz * timeSeconds + i * idle.phaseStep);
        let curl = cupCfg.left.pose[i] + micro;
        // Releasing: splay open as it pulls away — the visible "let go".
        if (leftOpenBlend > 0) curl = THREE.MathUtils.lerp(curl, throwCfg.leftReleaseOpenCurl, leftOpenBlend);
        leftHand.setFingerCurl(i, curl);
      }
    }
  }

  function getShakeState() {
    return { shakeActive, leftState, coupling, leftVisible: leftAnim.visible };
  }

  /** Throw-anticipation state, for tuning/verification. */
  function getThrowAnimState() {
    return {
      state: windupState,
      amount: windupAmount,
      intensity: windupIntensity,
      peakSpeed: windupPeakSpeed,
      curlAdd: windupCurlAdd,
      leftReleasing,
      leftOpen: leftOpenBlend,
      rotZ: windupGroup.rotation.z,
      rotX: windupGroup.rotation.x,
      offsetX: windupGroup.position.x,
      offsetY: windupGroup.position.y,
    };
  }

  /** Release-resistance state, for tuning/verification. */
  function getResistanceState() {
    const active = resistDuration > 0;
    return {
      active,
      elapsedMs: resistElapsed,
      durationMs: resistDuration,
      startStrength: resistStrength,
      // The follow-rate multiplier being applied right now (1 = normal).
      currentFactor: active
        ? THREE.MathUtils.lerp(resistStrength, 1, resistanceRecovery(resistElapsed, resistDuration, resistCfg.sustainFraction))
        : 1,
    };
  }

  /** Live zone-scale multiplier (1 = full size), e.g. for scaling UI that tracks the hand. */
  function getVisualScale() {
    return zoneScaleCurrent;
  }

  /** Zone-scale state, for tuning/verification. */
  function getZoneState() {
    return { inOriginZone, scale: zoneScaleCurrent, targetScale: zoneScaleTo };
  }

  /** Follow-through state, for tuning/verification. */
  function getFollowThroughState() {
    return {
      state: ftState,
      amount: ftAmount,
      targetY: ftTargetY,
      targetX: ftTargetX,
      rotY: followGroup.rotation.y,
      rotX: followGroup.rotation.x,
    };
  }

  return {
    pivot,
    hand,
    leftHand,
    cupRight,
    // Live blend targets + config, exposed so the cup can be recalibrated at
    // runtime (mutate in place, then bake the numbers back into handConfig).
    cupRightQuat,
    cupRightOffset,
    config,
    tiltGroup,
    windupGroup,
    followGroup,
    scale,
    setVisible,
    setHeight,
    setTarget,
    setHover,
    hold,
    releaseOne,
    releaseAll,
    isHoldingAny,
    isHeldByHand,
    getHeldDice,
    getVelocity,
    getPosition,
    getShakeState,
    getThrowAnimState,
    getFollowThroughState,
    getResistanceState,
    setZoneBounds,
    getVisualScale,
    getZoneState,
    setUIHidden,
    getUIFade,
    update,
  };
}

/**
 * How tightly the hand should close on a given die. Keyed on the die's
 * inradius/circumradius ratio rather than its bounding radius: every die
 * shares one bounding radius on the board, but a tetrahedron is far less
 * bulky than an icosahedron at that same radius, so it needs a deeper curl
 * for the fingers to actually reach it.
 */
export function gripCurlForDie(dieType, config = HAND_CONFIG) {
  const c = config.cursor;
  const frac = inradiusFraction(dieType);
  const t = THREE.MathUtils.clamp(
    (frac - c.inradiusFracSmall) / (c.inradiusFracLarge - c.inradiusFracSmall),
    0,
    1
  );
  return THREE.MathUtils.lerp(c.gripCurlSmallDie, c.gripCurlLargeDie, t);
}

/** Distance from the die's centre to a face plane, as a fraction of its bounding radius. */
export function inradiusFraction(dieType) {
  const frame = dieType.frames[0];
  return Math.abs(frame.centroid.dot(frame.normal)) / (dieType.boundingRadius || 1);
}
