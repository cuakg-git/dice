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
