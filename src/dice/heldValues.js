import { HAND_CONFIG } from "../hand/handConfig.js";

/**
 * Value randomisation for dice being carried by the hand.
 *
 * While a die is held its stored value re-rolls on a timer — slowly at rest,
 * faster while the hand is being shaken, easing between the two rather than
 * switching abruptly. The hand tooltip reads this to report what you're
 * holding (see ui/handTooltip.js).
 *
 * SCOPE — this is state only, and deliberately so:
 *
 *  - It never touches PHYSICS. A held die has no body at all (main.js retires
 *    it on pickup), and a thrown die's result is read from its top face when
 *    its body finally sleeps. So a randomised value is always overwritten by
 *    the physical one and can never bias a roll.
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

export function createHeldValues({ config = HAND_CONFIG.cursor.heldValues } = {}) {
  // record -> { values, elapsed, changes }
  const entries = new Map();
  let rate = 1; // live rate multiplier, eased between 1 and the shake multiplier
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
      elapsed: -((added++ * config.phaseOffsetMs) % Math.max(config.randomizeIntervalMs, 1)),
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
   * Advances every held die's timer. `shaking` is the hand's own shake state
   * (the same signal that summons the left hand), so the two always agree.
   *
   * The rate multiplies ELAPSED TIME rather than shrinking the interval: that
   * keeps the ramp continuous, so speeding up or slowing down mid-interval can
   * never skip a beat or fire twice.
   */
  function update(dtMs, { shaking = false } = {}) {
    const target = shaking ? config.shakeRandomizeMultiplier : 1;
    if (config.shakeRampDuration > 0) {
      const step = (dtMs / config.shakeRampDuration) * (config.shakeRandomizeMultiplier - 1);
      rate = target > rate ? Math.min(target, rate + step) : Math.max(target, rate - step);
    } else {
      rate = target;
    }

    if (entries.size === 0) return;
    const interval = Math.max(config.randomizeIntervalMs, 1);

    for (const [record, entry] of entries) {
      entry.elapsed += dtMs * rate;
      // `while`, not `if`: a long frame (tab wake, GC pause) must not leave
      // the timer permanently behind.
      while (entry.elapsed >= interval) {
        entry.elapsed -= interval;
        record.value = reroll(record, entry.values);
        entry.changes++;
      }
    }
  }

  /**
   * One row per held die, in the order given, for the tooltip.
   * `changes` is what tells the tooltip a flip is due and whether this die is
   * still on its first (unmasked) value.
   */
  function getRows(heldRecords) {
    const rows = [];
    for (const record of heldRecords) {
      const entry = entries.get(record);
      if (!entry) continue;
      rows.push({ record, value: record.value, changes: entry.changes });
    }
    return rows;
  }

  /** Live rate multiplier (1 = base rhythm), so the flip can match the pace. */
  function getRate() {
    return rate;
  }

  return { add, remove, clear, update, getRows, getRate, config };
}
