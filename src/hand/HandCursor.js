import * as THREE from "three";
import { createHand } from "./Hand.js";
import { HAND_CONFIG, restRotationDegrees } from "./handConfig.js";
import { easeOutCubic } from "../animation.js";

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

  // The right hand's half of the dice cup: while the shake is active this
  // wrapper blends from identity toward cup.right's rotation/offset, rolling
  // the hand (die and all — the die rides holdAnchor inside) into the V of
  // the cup. Sitting BETWEEN tiltGroup and hand.root it leaves the rest
  // rotation on hand.root untouched, same contract as the tilt itself.
  const cupRight = new THREE.Group();
  cupRight.name = "manoCopaDerecha";
  cupRight.add(hand.root);
  tiltGroup.add(cupRight);

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

    // Exponential smoothing: framerate-independent, so the chase feels the
    // same at 60 and 144 fps (a raw per-frame lerp would not).
    if (hasTarget && dt > 0) {
      const alpha = 1 - Math.exp(-c.followLerpPerSecond * dt);
      pivot.position.x += (target.x - pivot.position.x) * alpha;
      pivot.position.z += (target.y - pivot.position.z) * alpha;
    }
    pivot.position.y = height;

    clockMs += dt * 1000;
    history.push({ x: pivot.position.x, z: pivot.position.z, t: clockMs });
    if (history.length > c.velocityHistory) history.shift();

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

      // Left hand couples in while shaking a full hand, out otherwise (which
      // also covers letting the dice go: empty hand flips wantVisible false).
      const wantVisible = shakeActive && heldDice.length > 0;
      if (wantVisible && leftState !== "visible") leftState = "entering";
      else if (!wantVisible && (leftState === "visible" || leftState === "entering")) leftState = "exiting";

      const step = (dt * 1000) / shakeCfg.couplingMs;
      if (leftState === "entering") {
        coupling = Math.min(1, coupling + step);
        if (coupling >= 1) leftState = "visible";
      } else if (leftState === "exiting") {
        coupling = Math.max(0, coupling - step);
        if (coupling <= 0) leftState = "hidden";
      }

      couplingEased = easeOutCubic(coupling);
      const e = couplingEased;

      leftAnim.visible = leftState !== "hidden";
      if (leftAnim.visible) {
        leftAnim.position.set(
          THREE.MathUtils.lerp(leftEntrance.x, leftAcople.x, e),
          THREE.MathUtils.lerp(leftEntrance.y, leftAcople.y, e),
          THREE.MathUtils.lerp(leftEntrance.z, leftAcople.z, e)
        );
        leftAnim.scale.setScalar(THREE.MathUtils.lerp(cupCfg.entrance.scale, 1, e));
      }

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
      hand.setFingerCurl(i, curl);
    }

    // Left hand keeps its hollowed pose with a whisper of motion, only while
    // it's actually on screen — no cost when it's put away.
    if (leftAnim.visible) {
      for (let i = 0; i < leftHand.fingerCount; i++) {
        const micro = c.holdIdleAmp * Math.sin(2 * Math.PI * idle.freqHz * timeSeconds + i * idle.phaseStep);
        leftHand.setFingerCurl(i, cupCfg.left.pose[i] + micro);
      }
    }
  }

  function getShakeState() {
    return { shakeActive, leftState, coupling, leftVisible: leftAnim.visible };
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
