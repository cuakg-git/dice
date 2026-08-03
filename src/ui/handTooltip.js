import { HAND_CONFIG } from "../hand/handConfig.js";

/**
 * The status tooltip that sits above the hand while it's carrying dice: one
 * "Tenés un X" line per die, with each value flipping split-flap style
 * (airport departure board) whenever the randomiser re-rolls it.
 *
 * The flip is FRAME-DRIVEN, not a CSS animation or a setTimeout: every row
 * carries a progress value advanced by the same clock as everything else. That
 * matters because the re-roll rate more than doubles while the hand is shaken,
 * so flips have to be able to start at any moment and are clamped to fit
 * inside the current interval. A timer- or keyframe-based version can overlap
 * itself at the fast rate and visibly jam; this one cannot, because a new flip
 * simply resets the same progress value.
 *
 * Rows are reconciled against the held dice by identity, so a die entering or
 * leaving the handful never restarts anyone else's animation.
 */
export function createHandTooltip({ parent, config = HAND_CONFIG.cursor.heldValues }) {
  const el = document.createElement("div");
  el.className = "hand-tooltip";
  el.hidden = true;
  parent.appendChild(el);

  const list = document.createElement("div");
  list.className = "hand-tooltip__rows";
  el.append(list);

  // Optional trailing line (mobile's "Drag me to roll"), kept INSIDE the
  // tooltip rather than as a second floating element: it appears under exactly
  // the same condition (the hand is holding something), so sharing one
  // positioned box means the two can never overlap or fight for space.
  const footer = document.createElement("div");
  footer.className = "hand-tooltip__footer";
  footer.hidden = true;
  el.append(footer);

  const overflow = document.createElement("div");
  overflow.className = "hand-tooltip__more";
  overflow.hidden = true;
  el.append(overflow);

  // record -> { row, flap, seenChanges, flipStart, nextText, text }
  const rows = new Map();

  function makeRow(record) {
    const row = document.createElement("div");
    row.className = "hand-tooltip__row";

    const lead = document.createElement("span");
    lead.textContent = "Tenés un ";

    // Only this span flips; the surrounding text stays put, which is what
    // makes it read as a single flap in a fixed frame rather than the whole
    // line animating.
    const flap = document.createElement("span");
    flap.className = "hand-tooltip__flap";

    row.append(lead, flap);
    return { row, flap };
  }

  /** What a row should read, honouring the masking mode. */
  function textFor(entry) {
    // The first value each die shows is always real; only re-rolls are hidden,
    // and only when masking is on.
    if (config.maskRandomizedValues && entry.changes > 0) return "?";
    return String(entry.value);
  }

  /**
   * Reconciles the visible rows against the current handful.
   * `footerText` is optional trailing copy (null/"" hides it).
   */
  function sync(entries, footerText) {
    const visible = entries.slice(0, Math.max(config.maxRows, 1));

    // Drop rows whose die is no longer held.
    const live = new Set(visible.map((e) => e.record));
    for (const [record, state] of rows) {
      if (live.has(record)) continue;
      state.row.remove();
      rows.delete(record);
    }

    visible.forEach((entry, index) => {
      let state = rows.get(entry.record);
      if (!state) {
        const { row, flap } = makeRow(entry.record);
        state = { row, flap, seenChanges: entry.changes, flipStart: -1, nextText: null, text: textFor(entry) };
        flap.textContent = state.text;
        rows.set(entry.record, state);
      } else if (entry.changes !== state.seenChanges) {
        // A re-roll landed: start (or restart) the flip. Restarting is safe
        // and is exactly what should happen if the rate outruns the animation.
        state.seenChanges = entry.changes;
        const next = textFor(entry);
        // In masked mode every re-roll reads "?" — flip anyway, since the
        // flap moving IS the signal that the value changed.
        state.nextText = next;
        state.flipStart = performance.now();
      }
      // Keep DOM order matching the handful order.
      if (list.children[index] !== state.row) list.insertBefore(state.row, list.children[index] || null);
    });

    const hidden = entries.length - visible.length;
    overflow.hidden = hidden <= 0;
    if (hidden > 0) overflow.textContent = `+${hidden} más`;

    footer.hidden = !footerText;
    if (footerText) footer.textContent = footerText;

    if (el.hidden) el.hidden = false;
  }

  /**
   * Advances the flips. `rate` is the randomiser's live multiplier, used to
   * shorten the flip so it always finishes inside the current interval — this
   * is what keeps it fluid at the shaken rate instead of overlapping itself.
   */
  function update(nowMs, rate = 1) {
    if (el.hidden) return;
    const interval = config.randomizeIntervalMs / Math.max(rate, 0.001);
    const duration = Math.max(Math.min(config.splitFlapDuration, interval * 0.6), 60);

    for (const state of rows.values()) {
      if (state.flipStart < 0) continue;
      const t = Math.min((nowMs - state.flipStart) / duration, 1);

      // First half folds the flap edge-on, second half unfolds the new
      // character from the opposite side — the character is swapped exactly at
      // the midpoint, while it's invisible at 90 degrees.
      if (t < 0.5) {
        state.flap.style.transform = `rotateX(${t * 2 * 90}deg)`;
      } else {
        if (state.nextText !== null) {
          state.text = state.nextText;
          state.flap.textContent = state.text;
          state.nextText = null;
        }
        state.flap.style.transform = `rotateX(${-90 + (t - 0.5) * 2 * 90}deg)`;
      }

      if (t >= 1) {
        state.flap.style.transform = "";
        state.flipStart = -1;
      }
    }
  }

  function place(x, y) {
    el.style.transform = `translate(${x}px, ${y}px)`;
  }

  function hide() {
    if (el.hidden) return;
    el.hidden = true;
    for (const state of rows.values()) state.row.remove();
    rows.clear();
  }

  return { sync, update, place, hide, el };
}
