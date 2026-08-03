/**
 * Single calibration point for the hand, shared by both surfaces it appears
 * on: the mobile floating widget (handApp.js) and the desktop cursor that
 * lives in the main dice scene (HandCursor.js).
 */
export const HAND_CONFIG = {
  // Rest orientation, expressed as a fraction of a 0-360° range so it maps
  // 1:1 onto the mobile widget's sliders. Both surfaces apply these to the
  // rig root the same way, so tuning here moves both.
  restRotationFractionX: 0.05, // 18°
  restRotationFractionY: 0.55, // 198° — shows the back of the hand, as when reaching down

  outlineWidth: 0.055, // ink stroke, in hand-model units

  idle: {
    freqHz: 0.5,
    base: 0.125, // curl oscillates base ± amp => ~0.05..0.2
    amp: 0.075,
    phaseStep: 0.9, // per-finger phase offset so they don't move in lockstep
  },

  cursor: {
    // Final world scale = baseWorldScale * scaleReduction (the spec's -25%).
    baseWorldScale: 1.0,
    scaleReduction: 0.75,
    // Outline is in model units, so it scales with the hand automatically;
    // this nudges it back up a touch so the stroke still reads "thick" at
    // the reduced cursor size.
    outlineWidthMultiplier: 1.35,
    followLerpPerSecond: 18, // higher = snappier chase; framerate-independent (see update())
    heightMargin: 2, // world units the hand floats above the board's ceiling
    gripDurationMs: 175,
    // Grip closes further around a bulk-smaller die. Keyed on the die's
    // inradius/circumradius ratio (a D4 is far less "solid" than a D20 at
    // the same bounding radius), so the fingers wrap what's actually there.
    gripCurlSmallDie: 0.78,
    gripCurlLargeDie: 0.52,
    inradiusFracSmall: 0.33, // tetrahedron
    inradiusFracLarge: 0.8, // dodeca/icosahedron
    holdLiftWorld: 0.06, // extra clearance between hand and die, in world units
    holdIdleAmp: 0.012, // micro-oscillation kept while holding, so it isn't frozen
    velocityWindowMs: 100,
    velocityHistory: 6,

    // Hover feedback: while the (empty) hand hovers a grabbable die, the
    // fingers curl a little — "getting ready" to take it — then relax back
    // to the idle wave on exit. Purely visual; it never touches the raycast,
    // the grip, or the tilt. If the player clicks mid-hover, this partial
    // curl is exactly where the grip tween starts, so it flows into the grab.
    hover: {
      // MUST sit clear of the idle wave's own range or the pose is invisible:
      // idle swings base±amp = 0.125±0.075 => 0.05..0.20, so a "hover curl" of
      // 0.2 (the first value tried here) landed exactly ON the idle peak — the
      // fingers were already reaching it twice a cycle and nothing read as a
      // reaction. Keep this comfortably above 0.20 and below the grip curls
      // (0.52 large die .. 0.78 small) so it stays a partial pre-shape.
      curlAmount: 0.35, // ~26° of knuckle bend vs the idle mean's ~11°
      enterDurationMs: 140, // ramp in when hover starts
      exitDurationMs: 160, // ramp out when hover ends
      microAmp: 0.02, // small oscillation kept during hover so the pose isn't rigid
    },

    // The hand can now carry a whole handful. Held dice are laid out as a
    // small cluster in the palm (a phyllotaxis spiral so it packs evenly at
    // any count) rather than stacked at one point. All lengths are in the
    // hold anchor's LOCAL units (× the cursor's world scale ≈ 0.75 to read as
    // world units).
    cluster: {
      // Held dice shrink to this fraction of their board size so a whole
      // handful nests inside the palm instead of spilling over the fingers
      // (the palm is only ~1.6 model-units wide). This is set so the held
      // world radius stays ~0.24 regardless of the board die size — the
      // cluster layout below was tuned and verified at that size. Board dice
      // grew from 0.4 to 0.6, so this dropped from 0.6 to 0.4 to keep the
      // in-palm cluster identical (0.6*0.4 == 0.4*0.6 == 0.24). They pop back
      // to full board size the instant they're thrown/dropped.
      holdScaleMultiplier: 0.4,
      spacing: 0.24, // spiral step: bigger = looser handful. Overlap is fine (real dice nest).
      maxRadius: 0.4, // hard cap on the spiral radius so many dice can't spill past the palm
      jitter: 0.05, // random in-plane wobble per die, so the pile looks tossed-in, not gridded
      jitterZ: 0.05, // random depth wobble, so they don't all sit on one plane
      recess: 0.12, // how deep into the palm the cluster sits (the old single-die recess)
      center: { x: 0, y: -0.18 }, // bias the pile down into the palm hollow, away from the fingertips
      // The fist opens up a little for each extra die so a big handful still
      // fits: grip = maxPerDieCurl − gripOpenPerDie·(n−1), floored at gripMin.
      gripOpenPerDie: 0.06,
      gripMin: 0.3,
    },

    // Throwing/dropping a whole handful at once. Each die leaves from its own
    // cluster position (already spread), and gets extra scatter so they never
    // fly or land as one welded block.
    multiThrow: {
      posScatter: 0.5, // world-unit radius of random position scatter added per die on release
      velScatterFrac: 0.3, // random velocity added per die, as a fraction of the hand's release speed
      velScatterMin: 2.0, // ...but at least this many world u/s, so even a gentle throw fans out
    },

    // Throw ANTICIPATION (animation principle: anticipation -> action ->
    // reaction). The action/reaction halves already exist in physics; this is
    // the wind-up that precedes them.
    //
    // TIMING CONTRACT — the whole point: every millisecond of this plays
    // DURING the user's gesture, never after the release. releaseAll() is
    // synchronous and hands the dice back the same frame it's called, so
    // nothing here can gate it; the wind-up state just decays afterwards as
    // follow-through. See HandCursor.js's throw-anim state machine.
    //
    // The two velocity anchors below are deliberately the SAME numbers the
    // throw physics already keys on (BOARD_TUNING.desktop in main.js:
    // flickSpeedThreshold 6, flickSpeedForMaxForce 26). So the hand starts
    // charging exactly when the gesture becomes fast enough to count as a
    // throw, and reads fully charged exactly when the gesture is already
    // producing maximum throw force — the visual and the mechanic agree
    // instead of drifting apart.
    throwAnim: {
      intentVelocity: 6, // world u/s: hand is holding + moving this fast => start charging
      fullVelocity: 26, // world u/s at which the wind-up reads at full strength (capped there)

      // The wind-up needs its OWN velocity estimate rather than borrowing the
      // tilt's: tilt.tiltSmoothing (9/s) has a ~111ms time constant, which is
      // the whole length of the charge ramp — by the time the ramp finished,
      // that estimate had only caught ~2/3 of the real gesture speed, so hard
      // throws under-read and never qualified for the micro-hold. 25/s (~40ms)
      // settles well inside the ramp while still filtering per-frame jitter.
      velocitySmoothing: 25, // 1/s, EMA rate for the throw-gesture speed

      windupDurationMs: 120, // charge ramp (fast: it has to land inside a flick)
      recoverDurationMs: 200, // ramp back down (slowing without releasing, and follow-through after a throw)

      maxAngleDeg: 20, // peak cock-back rotation, opposite the gesture direction
      backDistance: 0.3, // peak recoil translation, in rig units (x0.75 cursor scale => ~0.22 world)
      extraCurl: 0.18, // fingers clamp down this much harder at full charge
      scaleContraction: 0.96, // the hand "gathers itself" slightly (1 = no contraction)

      // Micro-hold ("moving hold") at the top of the charge: the pose nearly
      // freezes for a beat, which is what makes the release read as powerful.
      // Only for genuinely hard throws — a gentle toss skips it entirely so
      // it never feels like the hand is hesitating.
      holdDurationMs: 80,
      holdMinVelocity: 16, // world u/s: below this, no hold at all
      holdMicroAmp: 0.006, // radians of jitter during the freeze, so it isn't dead

      // The left ("batting") hand opening and getting out of the way as the
      // dice leave — turns the shake into part of the throw instead of a
      // disconnected gesture.
      leftReleaseDurationMs: 150,
      leftReleaseOpenCurl: 0.05, // fingers splay to nearly flat as it lets go
      leftReleaseOffset: { x: -0.5, y: -0.9, z: -0.4 }, // extra shove down/out, on top of the normal exit
    },

    // FOLLOW-THROUGH: the reaction half of anticipation -> action -> reaction.
    // On release the right hand keeps rotating in the direction the throw
    // went, mimicking a real right hand's forearm rotation over a table.
    //
    // The rig's longitudinal (wrist->fingertip) axis is local +Y, so
    // supination/pronation is literally a rotation about local Y — the same
    // axis a real forearm rotates about. At rest the palm faces DOWN (world
    // -Y, measured: palm normal ~(-0.29, -0.91, -0.29)), i.e. we see the back
    // of the hand.
    //
    // The two Y magnitudes are deliberately ASYMMETRIC, which is the whole
    // reason a single max angle wouldn't work: rotating far enough in EITHER
    // direction eventually shows the palm, so a symmetric max would make left
    // and right throws look the same. A real right hand also has asymmetric
    // range here — from palm-down, supinating ~160 deg turns the palm fully
    // up, while pronating only has ~70 deg before the wrist stops, leaving the
    // palm hidden. That asymmetry IS the left/right read.
    followThrough: {
      supinationDeg: 160, // throw LEFT: forearm supinates, palm ends up (interior visible)
      pronationDeg: 70, // throw RIGHT: forearm pronates, palm stays hidden (back visible)
      maxRotationXDeg: 55, // up/down component: hand tips to follow the gesture

      minSpeed: 6, // below this it's a deposit, not a throw => no follow-through at all
      fullSpeed: 26, // rotation reaches full magnitude here (same anchors as the wind-up)

      durationMs: 250, // rotate out (easeOutCubic: fast start, decelerating)
      holdDurationMs: 180, // sit at the peak pose before unwinding
      returnDurationMs: 420, // period of the damped settle back to rest
      returnDamping: 0.6, // <1 = slightly underdamped, so it settles instead of snapping back

      // The camera is top-down, so which way a roll "reads" can invert
      // depending on the angle — flip these if the sense looks backwards.
      invertX: false,
      invertY: false,
    },

    // RELEASE RESISTANCE: right after a real throw the hand briefly stops
    // chasing the pointer at full speed, so it can't sail past the die it
    // just launched — a real hand decelerates while the object flies on.
    //
    // Implemented by scaling `followLerpPerSecond` down for a moment and
    // easing it back, NOT by freezing or queueing input: the target still
    // updates every frame, the hand just closes the gap more slowly, so
    // nothing is ever "swallowed" and there's no latency anywhere.
    //
    // Kept deliberately SHORT. A long window doesn't read as weight, it
    // reads as the app having hung — the hand must never feel disconnected
    // from the mouse. It also aborts the instant a die is grabbed.
    //
    // RECOVERY SHAPE — a plain easeOutCubic (front-loaded: most recovery in
    // the first third) was tried first and measured fine on paper but read
    // as nothing in practice: by the time the eye registers the throw, the
    // hand had already re-attached. Fixed by holding flat at full resistance
    // for `sustainFraction` of the window, THEN easing back over what's
    // left — easeInOutCubic for that portion, so the join at the end of the
    // plateau has zero slope on both sides (no kink) and the return itself
    // still decelerates into normal tracking instead of snapping onto it.
    // `sustainFraction` is exposed here specifically so this shape can be
    // retuned by eye without touching code — 0 degenerates to a pure ease
    // across the whole window, closer to 1 makes the release read as a
    // held pause that then snaps back.
    releaseResistance: {
      enabled: true,
      durationMs: 1100, // whole window, from fully damped back to fully responsive
      // Follow rate is multiplied by this for the sustained portion of the
      // window (0.08 => ~1/12 the usual responsiveness) and eases back to 1
      // over the rest.
      strength: 0.08,
      // Fraction of the window held flat at `strength` before recovery
      // starts (see RECOVERY SHAPE above).
      sustainFraction: 0.55,
      // Scale the effect by throw force, so a gentle lob barely drags and a
      // hard fling drags properly. Uses the same speed anchors as the
      // follow-through, so the two beats always agree about how hard the
      // throw was.
      scalesWithForce: true,
      minSpeed: 6, // below this it's a deposit: no resistance at all
      fullSpeed: 26, // at/above this the resistance is applied in full
      // With scalesWithForce, a minimum-force throw still gets this fraction
      // of the window, so the transition from "no effect" to "effect" isn't a
      // hard step right at the threshold.
      minForceFraction: 0.35,
    },

    // ZONE SCALE: the hand shrinks while it's over the source strip (the six
    // crowded die groupings) so it doesn't block the view of the pile or hurt
    // grab precision, and returns to full size over the throw board.
    //
    // Purely visual — a multiplier on the pivot's own scale, applied in
    // HandCursor.js's update(). It never touches hit-testing: die hitboxes
    // are sized independently in main.js from the board/source die radii, so
    // a smaller hand still grabs exactly where it visually appears to.
    //
    // Zone membership is checked against the hand's OWN rendered position,
    // not the raw pointer — otherwise, during a release-resistance drag, the
    // hand could still be shrinking/growing to match a pointer position it
    // hasn't visually reached yet, which would desync the size change from
    // where the hand actually looks like it's standing.
    zoneScale: {
      originZoneHandScale: 0.5, // scale while over the source strip
      handScaleTransitionDuration: 180, // ms, eased (easeOutCubic)
      // World units of dead zone straddling the board edge: the hand must
      // move this far past the boundary (in either direction) before the
      // OTHER size is triggered, so resting right on the seam can't flicker
      // between sizes.
      zoneHysteresisMargin: 0.5,
    },

    // UI-ZONE FADE: hides the hand while the pointer is over page UI (the
    // corner buttons, the roll-log panel — see index.html's `data-ui-zone`
    // attribute and main.js's overUIZone tracking), so the native OS cursor
    // can take over for clicking/scrolling. Skipped while a die is held: the
    // hand stays put so its cargo doesn't disappear along with it.
    //
    // Implemented as a scale tween down to `hiddenScale` (not exactly 0 —
    // that would give the pivot's transform a zero determinant) rather than a
    // true opacity fade: the hand's ink-outline material is a MODULE-level
    // singleton shared with the mobile widget's own hand instance (both
    // Hand.js consumers are loaded in the same page, see index.html) —
    // animating its opacity here would leak into that unrelated instance. A
    // fast shrink reads the same as a fade for a solid flat-shaded shape and
    // touches nothing outside this rig.
    uiFade: {
      transitionDuration: 100, // ms, eased (easeOutCubic)
      hiddenScale: 0.001,
    },

    // ANCHORED MODE (touch). The same rig, but with no pointer to chase: the
    // hand parks at a fixed anchor and dice travel TO it. A finger drag moves
    // it (that's the throw gesture), and letting go eases it back.
    //
    // Nothing else in the rig needed porting for this: tilt, wind-up,
    // micro-hold, shake/left-hand, follow-through and the release velocity all
    // read `pivot.position` deltas per frame, so they behave identically
    // whether the pivot is being moved by a cursor or by a finger.
    anchored: {
      // Where the hand parks, as a fraction of the board's half-depth from the
      // board centre (+ = toward the bottom edge). Bottom-centre is
      // thumb-reachable, sits clear of the top source strip, and dice thrown
      // "up" the board roll away from the hand instead of under it.
      anchorZFraction: 0.82,
      // Eases back to the anchor once the finger lets go. Deliberately slower
      // than the drag-follow rate so the return reads as a settle rather than
      // a snap — and this is the rate the release-resistance window damps,
      // which is how "the hand spends itself after throwing" is expressed
      // here instead of as resistance against chasing a pointer.
      returnLerpPerSecond: 6,
      // Minimum radius for grabbing the hand, in CSS px, converted to world
      // units against the live camera. 44px is the accessibility floor for a
      // touch target's full size; this is the RADIUS, so the grab area is
      // comfortably above it even when the hand renders smaller.
      touchRadiusPx: 52,
      // Tap-to-hand flight: the die leaves physics and arcs into the palm.
      travelDurationMs: 360,
      travelArcHeight: 2.4, // world units of bulge at the midpoint of the arc
    },

    // HELD-DIE VALUES: while the hand is carrying dice their value "spins" —
    // the stored value re-rolls on a timer, faster while the hand is being
    // shaken, and a tooltip above the hand reports it.
    //
    // STATE AND PRESENTATION ONLY. Nothing here touches geometry or physics:
    // a thrown die's result is still whatever its top face reads when the
    // body finally sleeps (main.js's settle loop), so randomising cannot
    // influence a roll. The die is deliberately NOT rotated to match the
    // randomised value — see the note on `maskRandomizedValues` below and the
    // module comment in dice/heldValues.js.
    heldValues: {
      // --- Rhythm at rest ---------------------------------------------
      idleFlipIntervalMs: 1100, // unhurried: this is the "nothing is happening yet" pace
      // Staggers the handful so ten dice never re-roll on the same frame.
      phaseOffsetMs: 90,
      // Masked mode (default): values ALTERNATE between the real number and
      // "?" while at rest, so the tooltip neither gives the roll away nor sits
      // permanently blanked. Turn this off to watch the real numbers tumble.
      maskRandomizedValues: true,
      // How many masked flips per revealed one. 1 = strict alternation
      // (number, ?, number, ?...). Chosen over a separate mask *interval*
      // deliberately: tying the alternation to the flip COUNT keeps it locked
      // to the split-flap, whereas an independent ms clock would drift against
      // it and leave the flap changing mid-rotation.
      maskAlternateRatio: 1,
      splitFlapDuration: 260, // ms per character flip (clamped to fit the live interval)
      // Beyond this many dice the tooltip stops growing and compacts the
      // remainder into a single "+N más" line.
      maxRows: 6,

      // --- Crescendo while shaking ------------------------------------
      // Shaking doesn't jump to a fixed speed: the flip interval ramps from
      // `shakeFlipStartMs` down to `shakeFlipMinMs` over `crescendoDuration`,
      // so it reads as something winding up rather than switching on. Letting
      // go unwinds the same ramp over `shakeDecelDuration`.
      shakeFlipStartMs: 420, // interval the moment a shake is detected
      shakeFlipMinMs: 90, // fastest it will ever get (the ceiling of the charge)
      crescendoDuration: 2600, // ms of sustained shaking to reach full charge
      // "easeIn" | "linear" | "easeInOut". easeIn holds back early and rushes
      // late, which is what actually reads as a crescendo — linear feels like
      // a machine ramping.
      crescendoCurve: "easeIn",
      shakeDecelDuration: 900, // ms to fall back to the resting rhythm

      // --- Throw force bonus -------------------------------------------
      // The SAME crescendo progress that drives the visual layers below also
      // multiplies the die's launch impulse — read once, at the instant of
      // release (see main.js's throwAllHeld). Deliberately not a second,
      // independent "charge" concept: it reuses getCharge()'s live value, so
      // what the crescendo shows on screen (the jitter/glow/flip speed) is
      // ALWAYS exactly what the throw is about to get. A separate decay timer
      // for the force would let the two drift apart — e.g. the tooltip
      // visibly calmed down while the throw still came out at full power —
      // so there is no `chargeDecayDuration` here: `shakeDecelDuration` above
      // already decays charge smoothly toward 0 the moment shaking stops, and
      // that single decay now governs both the visuals and the force bonus.
      chargeForceMultiplierMax: 2.5, // launch impulse at full charge, relative to no charge at all
      // "linear" (default): half the charge gives ~half the bonus, as asked.
      // The visual crescendo uses easeIn instead — different job, different
      // curve — but reuses the same CURVES table, so a matching easeIn/
      // easeInOut force feel is a one-line change if it calibrates better.
      chargeForceCurve: "linear",

      // --- Tooltip migration ------------------------------------------
      // On shake the tooltip leaves the hand for a fixed spot and reflows from
      // a vertical list to a horizontal row; both are interpolated over this.
      tooltipMigrationDuration: 420,
      migratedYFraction: 0.86, // desktop: fraction of viewport height for the parked spot
      // Mobile parks it higher: the hand itself is anchored at the bottom
      // centre there, so 0.86 would drop the tooltip on top of it.
      migratedYFractionMobile: 0.7,

      // --- "Charging" layers ------------------------------------------
      // All four scale with the SAME crescendo progress so they read as one
      // phenomenon, and each can be switched off on its own to calibrate which
      // ones actually earn their place. Defaults are deliberately restrained —
      // with the hand shaking and the flaps racing there is already a lot
      // moving, and these are meant to be felt more than noticed.
      chargeShakeEnabled: true,
      chargeShakeAmount: 2.5, // px of jitter at full charge (the primary "about to burst" cue)
      chargeScaleEnabled: true,
      chargeScaleAmount: 0.12, // +12% at full charge
      chargeGlowEnabled: true,
      chargeGlowAmount: 0.55, // 0..1 strength of the halo at full charge
      chargeTemperatureEnabled: true,
      // Warm shift applied ONLY to the tooltip's own background. Never to the
      // rows: each die is identified by its type colour (DICE_COLORS — D4
      // magenta, D6 yellow...), and tinting those would destroy the one cue
      // telling you which die is which, especially once they're in a row.
      chargeTemperatureAmount: 0.5, // 0..1 blend toward the warm end at full charge
    },

    // PLATFORM OVERRIDES: only values that genuinely must differ on touch.
    // Shallow-merged over everything above by createHandCursor({ platform }),
    // so all the animation logic and its tuning stay single-sourced.
    mobile: {
      // The hand is a touch TARGET here, not a cursor, so it reads bigger:
      // scaled for mobile's 16.5-unit-wide world and its larger dice
      // (0.8 radius vs desktop's 0.6).
      baseWorldScale: 1.0,
      scaleReduction: 1.3,
    },
  },

  // Desktop-only two-hand "dice cup" formed while the player shakes a held
  // die. Modeled on the real gesture: both hands HOLLOWED (fingers part-
  // flexed), meeting at their pinky edges at the BOTTOM of the cup, palms
  // angled toward each other in a V that encloses the die, fingertips of the
  // two hands converging at the top seam, thumbs crossing at the front. So
  // this is NOT "left hand appears under the right": while the shake is
  // active the RIGHT hand also rolls out of its rest pose into its half of
  // the cup, and the mirrored LEFT hand couples in as the other half. Both
  // halves blend in/out with the same eased 0..1 coupling, so the cup forms
  // and dissolves smoothly.
  //
  // All positions/rotations live in the tilt group's model frame (the
  // pre-flatten rig frame): +X = screen-right, +Y = fingers/screen-up,
  // +Z = toward the camera. Units are hand-model units (palm is 1.6 wide).
  // Every rotation below was SOLVED numerically in the live scene against
  // target palm-normal / finger-axis frames (grid search over Eulers,
  // verified by render), not eyeballed — resulting world frames:
  //   right palm normal (-0.71, 0.69, 0.09), left (0.71, 0.70, 0.12)
  //   => palms "look" at each other at ~90° (dot ≈ 0), the V of the cup,
  //   both tilted up toward the camera; finger axes (∓0.1, 0.05, -0.99)
  //   point screen-up and converge; pinky edges meet at the bottom seam
  //   (gap ≈ 0.26 world units, palm-edge to palm-edge).
  cup: {
    right: {
      // Extra rotation blended ON TOP of the right hand's rest pose (on the
      // manoCopaDerecha wrapper, so the rest rotation itself is never
      // rewritten). Rolls the hand so its palm — at rest facing down at the
      // board — turns to face center-left and up: the right half of the V.
      rotationDeg: { x: -135, y: 55, z: 140 },
      // Where the right half sits relative to the cursor pivot (tilt-model
      // units): a touch screen-right so the hollow stays centered.
      offset: { x: 0.2, y: 0, z: 0 },
      // Hollow-cup finger flex (0=pulgar, 1..4=índice..meñique), blended in
      // over the grip curl while cupped. ~0.45 = half-closed cup wall; the
      // thumb curls further (0.65) so it folds over the front seam.
      pose: [0.65, 0.42, 0.45, 0.45, 0.42],
      // Delta on the thumb's base splay while cupped (positive = folds the
      // thumb in from its splayed rest toward the seam). This is the fine
      // knob for the thumb meeting/crossing at the front.
      thumbSplayDeg: 20,
    },
    left: {
      // The mirrored rig's orientation (absolute on its own wrapper — the
      // rig itself is scale.x = -1). Palm faces center-right and up: the
      // left half of the V, meeting the right at the bottom seam.
      rotationDeg: { x: 10, y: 45, z: -34 },
      // Relative to the cursor pivot: mirror side of the right half, a hair
      // lower on screen and deeper (-z) so its pinky edge tucks under the
      // right hand's at the bottom of the cup, and its palm plane clears
      // the D20 (measured clearance 0.40 world = one die radius).
      offset: { x: -0.35, y: -0.05, z: -0.25 },
      // Same hollow as the right; thumb also folded over the front.
      pose: [0.65, 0.42, 0.45, 0.45, 0.42],
      thumbSplayDeg: 20,
    },
    // Couple-in animation for the left hand: starts at left.offset +
    // entrance.offset (lower and further under), scaled by entrance.scale,
    // and slides/grows into place with easeOutCubic. The right hand's roll
    // into the V uses the same eased coupling, so both halves arrive (and
    // leave) together — the cup is never instantaneous.
    entrance: {
      offset: { x: -0.2, y: -0.4, z: -0.3 },
      scale: 0.6,
    },
  },

  // Shake detection that summons/dismisses the left hand. A shake = the
  // pointer swinging left/right (horizontal velocity flipping sign) several
  // times in a short window, each swing fast enough to count. A fast move in
  // a straight line never flips sign, so it never triggers. Two-level
  // hysteresis (harder to start than to sustain, on both the per-swing speed
  // and the swing count) keeps it from flickering at the boundary.
  shake: {
    velocityThreshold: 7, // world u/s: |vx| for a swing to register (to appear)
    velocityReleaseThreshold: 3, // lower bar to keep swings counting once visible
    directionChanges: 3, // sign flips within the window needed to appear
    directionChangesRelease: 1, // once below this (for releaseDelayMs) it retracts
    windowMs: 450, // rolling window the sign flips are counted over
    releaseDelayMs: 180, // grace time under the release bar before retracting
    couplingMs: 200, // slide+scale entrance/exit duration
  },

  // Desktop-only "weight" tilt: leans the hand in the direction/speed of its
  // own motion, then settles back to upright when the pointer stops. Lives
  // on a group of its own (see HandCursor.js) so it can never touch the
  // rest orientation above.
  tilt: {
    maxTiltXDeg: 14, // cap for the up/down (pitch) lean
    maxTiltYDeg: 16, // cap for the left/right (yaw) lean
    velocityToTilt: 1.3, // degrees of tilt per (world unit/s) of smoothed hand speed
    tiltSmoothing: 9, // 1/s: EMA rate for the velocity estimate AND the active-tracking angle chase
    returnSpeed: 7, // rad/s-ish natural frequency of the idle return spring
    damping: 0.6, // damping ratio of the idle return spring; <1 = gentle overshoot, 1 = critical
    idleThreshold: 0.5, // world units/s below which the pointer counts as "stopped"
    holdingTiltMultiplier: 0.5, // amplitude scale while a die is in hand
    invertTiltX: false,
    invertTiltY: false,
  },
};

/** Rest rotation in degrees, derived from the 0-360° fractions above. */
export function restRotationDegrees() {
  return {
    x: HAND_CONFIG.restRotationFractionX * 360,
    y: HAND_CONFIG.restRotationFractionY * 360,
  };
}
