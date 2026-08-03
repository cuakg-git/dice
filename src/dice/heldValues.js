import { HAND_CONFIG } from "../hand/handConfig.js";

/**
 * Value randomisation for dice being carried by the hand.
 *
 * While a die is held its stored value re-rolls on a timer — slowly at rest,
 * faster while the hand is being shaken, easing between the two rather than
 * switching abruptly. The hand tooltip reads this to report what you're
 * holding (see ui/handTooltip.js).
 *
 * SCOPE — two things live here, and they touch physics very differently:
 *
 *  - The RANDOMISED VALUE (per die) is presentation only. A held die has no
 *    body at all (main.js retires it on pickup), and a thrown die's RESULT is
 *    read from its top face when its body finally sleeps. So a randomised
 *    value is always overwritten by the physical one and can never bias which
 *    number a roll lands on.
 *
 *  - The CHARGE LEVEL (one shared 0..1 progress, see getCharge()) is the
 *    deliberate exception: it also derives a launch-FORCE multiplier
 *    (forceMultiplier()) that main.js applies to the throw's velocity at
 *    release. This changes how hard the roll is thrown, never what it rolls
 *    — the outcome is still exactly whatever face physics settles on. It
 *    reuses getCharge() rather than tracking a second charge for force, so
 *    what the crescendo visibly shows is always what the throw is about to
 *    get — see handConfig.js's chargeForceMultiplierMax for why there's no
 *    separate decay timer for it either.
 *
 *  - It never touches the die's GEOMETRY. The die is NOT rotated to bring the
 *    randomised number face-up. Held dice are shrunk to nest in the palm and
 *    sit overlapping under the fingers, so the faces are largely occluded —
 *    spinning them to match would be near-invisible work every 700ms. Worse,
 *    it would imply the die is "showing" a result, when the whole point is
 *    that the outcome isn't decided until it's thrown. The randomised value
 *    lives in state and in the tooltip; the die itself just sits in the palm.
 *
 * Values are drawn from the die type's OWN number table, so they're valid for
 * that shape by construction (1-4 for a D4, 1-20 for a D20, whatever a D10
 * actually prints) with no hardcoded ranges to drift out of sync.
 */

/** Every distinct value this die type can show, from its own table. */
export function possibleValues(dieType) {
  // Same source the reader uses: "vertex" dice (the D4) are read at their
  // apex corner, everything else at a face. See dieValue.js.
  const raw = dieType.valueFace === "vertex" ? dieType.vertices.map((v) => v.number) : dieType.numbers;
  return [...new Set(raw)];
}

const CURVES = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

// Fraction of the charge spent travelling from the RESTING interval up to
// `shakeFlipStartMs`. Small on purpose: detecting a shake should land on the
// starting speed almost at once — that's the "kick" — and the whole rest of
// the ramp is the crescendo proper.
//
// Measured in CHARGE, not in eased charge. Putting it in eased space looked
// equivalent but wasn't: with an easeIn curve the early charge barely moves
// the eased value, so `shakeFlipStartMs` took ~1.3s of shaking to arrive and
// stopped meaning "the speed on detection" at all. In charge space it lands
// in ONSET_FRACTION * crescendoDuration, which is what the name promises.
// The curve then applies to the start->floor segment alone, where the
// crescendo actually lives.
//
// Keeping it non-zero is also what makes the ramp continuous, so letting go
// decelerates all the way back to rest with no step at the end.
const ONSET_FRACTION = 0.12;

export function createHeldValues({ config = HAND_CONFIG.cursor.heldValues } = {}) {
  // record -> { values, elapsed, changes }
  const entries = new Map();
  // 0 = at rest, 1 = fully wound up. Everything the crescendo drives (flip
  // rhythm, masking, migration, all four charge layers) is a function of this
  // single number, which is what makes them read as one phenomenon.
  let charge = 0;
  let added = 0; // running count, only used to stagger phase offsets

  /** A fresh value for this die, never repeating the one it's already on. */
  function reroll(record, values) {
    if (values.length <= 1) return values[0];
    let next = record.value;
    // Bounded by construction: at least two distinct values exist here.
    while (next === record.value) next = values[(Math.random() * values.length) | 0];
    return next;
  }

  function add(record) {
    if (entries.has(record)) return;
    const values = possibleValues(record.dieType);
    entries.set(record, {
      values,
      // Negative start = this die waits a little longer for its first re-roll,
      // so a handful staggers instead of flipping in lockstep.
      elapsed: -((added++ * config.phaseOffsetMs) % Math.max(config.idleFlipIntervalMs, 1)),
      // 0 means "still showing its original value" — the tooltip shows that
      // one for real even in masked mode.
      changes: 0,
    });
  }

  function remove(record) {
    entries.delete(record);
  }

  function clear() {
    entries.clear();
  }

  /**
   * The flip interval for the current charge, in ms.
   *
   * Piecewise over the eased charge so all three anchors mean what they say
   * and the curve stays continuous end to end:
   *   charge 0                -> idleFlipIntervalMs   (resting pace)
   *   charge ONSET_FRACTION   -> shakeFlipStartMs     (the kick on detection)
   *   charge 1                -> shakeFlipMinMs       (fully wound up)
   */
  function flipIntervalMs() {
    if (charge <= 0) return Math.max(config.idleFlipIntervalMs, 1);
    if (charge < ONSET_FRACTION) {
      // The detection kick: straight from the resting pace to the start speed,
      // linear in charge so it arrives promptly rather than being flattened by
      // the crescendo curve.
      const t = charge / ONSET_FRACTION;
      return config.idleFlipIntervalMs + (config.shakeFlipStartMs - config.idleFlipIntervalMs) * t;
    }
    // The crescendo proper: start speed -> floor, shaped by the curve.
    const t = (charge - ONSET_FRACTION) / (1 - ONSET_FRACTION);
    const eased = (CURVES[config.crescendoCurve] || CURVES.easeIn)(t);
    return config.shakeFlipStartMs + (config.shakeFlipMinMs - config.shakeFlipStartMs) * eased;
  }

  /**
   * Advances the crescendo and every held die's timer. `shaking` is the hand's
   * own shake state (the same signal that summons the left hand), so the
   * winding-up and the two-handed cup are always the same gesture.
   *
   * The interval is recomputed per die per step rather than scaling elapsed
   * time, so a charge that changes mid-interval simply changes when the next
   * flip is due — it can never skip a beat or fire twice.
   */
  function update(dtMs, { shaking = false } = {}) {
    if (shaking) {
      charge = config.crescendoDuration > 0 ? Math.min(1, charge + dtMs / config.crescendoDuration) : 1;
    } else {
      charge = config.shakeDecelDuration > 0 ? Math.max(0, charge - dtMs / config.shakeDecelDuration) : 0;
    }

    if (entries.size === 0) return;

    for (const [record, entry] of entries) {
      entry.elapsed += dtMs;
      // `while`, not `if`: a long frame (tab wake, GC pause) must not leave
      // the timer permanently behind. Re-read the interval each pass so a
      // steepening crescendo takes effect immediately.
      let interval = Math.max(flipIntervalMs(), 1);
      while (entry.elapsed >= interval) {
        entry.elapsed -= interval;
        record.value = reroll(record, entry.values);
        entry.changes++;
        interval = Math.max(flipIntervalMs(), 1);
      }
    }
  }

  /**
   * Whether a given flip should read as "?" rather than its number.
   *
   * At rest the two ALTERNATE (`maskAlternateRatio` masked flips per revealed
   * one), so the tooltip neither gives the roll away nor sits permanently
   * blanked. While winding up nothing is masked: the numbers race, because at
   * that point the crescendo IS the content.
   */
  function isMasked(changes) {
    if (!config.maskRandomizedValues) return false;
    if (charge > 0) return false;
    if (changes <= 0) return false; // the very first value is always real
    const ratio = Math.max(config.maskAlternateRatio, 0);
    if (ratio <= 0) return false;
    // One revealed slot followed by `ratio` masked ones, repeating.
    return (changes - 1) % (ratio + 1) !== ratio;
  }

  /**
   * One row per held die, in the order given, for the tooltip. `changes` tells
   * the tooltip a flip is due; `masked` is the rendering decision, resolved
   * here so the rhythm and what it reveals stay in one place.
   */
  function getRows(heldRecords) {
    const rows = [];
    for (const record of heldRecords) {
      const entry = entries.get(record);
      if (!entry) continue;
      rows.push({
        record,
        value: record.value,
        changes: entry.changes,
        masked: isMasked(entry.changes),
      });
    }
    return rows;
  }

  /** 0..1 crescendo progress — drives every "charging" layer in the tooltip. */
  function getCharge() {
    return charge;
  }

  /**
   * The launch-force bonus for the CURRENT charge: 1 at charge 0 (no shaking
   * => no penalty and no bonus — charging is an option, never a requirement
   * to throw at normal force), rising to `chargeForceMultiplierMax` at charge
   * 1. Meant to be read once, at the instant of release — see main.js's
   * throwAllHeld, which captures this before clear() resets the handful.
   */
  function forceMultiplier() {
    const curve = CURVES[config.chargeForceCurve] || CURVES.linear;
    return 1 + (config.chargeForceMultiplierMax - 1) * curve(charge);
  }

  return { add, remove, clear, update, getRows, getCharge, forceMultiplier, flipIntervalMs, config };
}
