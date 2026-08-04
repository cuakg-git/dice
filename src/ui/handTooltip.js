import { HAND_CONFIG } from "../hand/handConfig.js";
import { DICE_COLORS } from "../dice/diceColors.js";

/**
 * The status tooltip for the dice in the hand: one "Tenés un X" row per die,
 * each value flipping split-flap style (airport board) as the randomiser
 * re-rolls it.
 *
 * It has two poses, and slides continuously between them:
 *
 *   AT REST   — a vertical list parked above the hand, flipping slowly, values
 *               alternating between the real number and "?".
 *   CHARGING  — shaken: the list migrates to a fixed spot on screen, reflows
 *               into a horizontal row, stops masking, and winds up.
 *
 * Everything is FRAME-DRIVEN rather than CSS-animated, for one reason: the
 * flip interval sweeps continuously from ~1100ms to ~90ms as the crescendo
 * builds. Keyframes or timers set up for one pace overlap themselves at
 * another and visibly jam; a progress value re-read every frame simply can't.
 *
 * The same applies to the vertical->horizontal reflow. `flex-direction` isn't
 * an animatable property, so rows are absolutely positioned and their
 * coordinates are interpolated between the two layouts each frame — that turns
 * an un-animatable property change into a real, continuous motion.
 *
 * COLOUR CONTRACT: each row carries its die type's identifying colour
 * (DICE_COLORS — D4 magenta, D6 yellow...). The "heat" of charging is applied
 * ONLY to the tooltip's own background, never to those chips: once the rows
 * are side by side, that colour is the only thing telling you which die is
 * which, and tinting it would throw that away.
 */
/**
 * Padding + border of the tooltip box, read ONCE from its actual CSS rather
 * than hardcoded — so this can never drift out of sync with style.css. Cheap
 * to call once; would be a per-frame layout read (and a real cost at 60fps)
 * if done every frame, which is why it's cached instead.
 */
function readBoxExtra(element) {
  if (typeof getComputedStyle !== "function") return { x: 20, y: 14 }; // matches style.css's padding/border
  const s = getComputedStyle(element);
  const x = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) + parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth);
  const y = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) + parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
  return { x: Number.isFinite(x) ? x : 20, y: Number.isFinite(y) ? y : 14 };
}

export function createHandTooltip({ parent, config = HAND_CONFIG.cursor.heldValues }) {
  const el = document.createElement("div");
  el.className = "hand-tooltip";
  el.hidden = true;
  parent.appendChild(el);
  // Read once at creation, not per frame — see readBoxExtra's own note. Padding
  // is a static CSS declaration, so display:none at this point doesn't matter:
  // its VALUE resolves regardless of whether the box is actually laid out yet.
  const boxExtra = readBoxExtra(el);

  const list = document.createElement("div");
  list.className = "hand-tooltip__rows";
  el.append(list);

  const overflow = document.createElement("div");
  overflow.className = "hand-tooltip__more";
  overflow.hidden = true;
  el.append(overflow);

  // Trailing lines live INSIDE the tooltip rather than as separate floating
  // elements: they appear under the same condition (the hand is holding
  // something) and in the same place (above the hand), so sharing one
  // positioned box means they can never overlap or fight for space.
  const hint = document.createElement("div");
  hint.className = "hand-tooltip__hint";
  hint.hidden = true;
  el.append(hint);

  const footer = document.createElement("div");
  footer.className = "hand-tooltip__footer";
  footer.hidden = true;
  el.append(footer);

  // record -> { row, flap, seenChanges, flipStart, nextText, text }
  const rows = new Map();
  let order = []; // render order, so layout and DOM agree
  let migration = 0; // 0 = parked above the hand (vertical), 1 = migrated (horizontal)
  // Cached row metrics. Every row is the same shape ("Tenés un " + a
  // fixed-width flap + a chip), so one measurement covers them all — and it's
  // only re-taken when the row set changes, never per frame.
  let rowW = 0;
  let rowH = 0;
  let metricsDirty = true;
  // The list's own (unscaled) content size at the CURRENT migration progress —
  // set by layout() every frame, read by the centring math in update().
  let contentW = 0;
  let contentH = 0;

  function makeRow(record) {
    const row = document.createElement("div");
    row.className = "hand-tooltip__row";

    // The die's identifying colour. Never touched by the charge layers.
    const chip = document.createElement("span");
    chip.className = "hand-tooltip__chip";
    chip.style.background = DICE_COLORS[record.typeName] || "#999";

    const lead = document.createElement("span");
    lead.className = "hand-tooltip__lead";
    lead.textContent = "Tenés un ";

    // Only this span flips; the text around it stays put, which is what makes
    // it read as one flap in a fixed frame rather than the whole line moving.
    const flap = document.createElement("span");
    flap.className = "hand-tooltip__flap";

    row.append(chip, lead, flap);
    return { row, flap };
  }

  const textFor = (entry) => (entry.masked ? "?" : String(entry.value));

  /** Reconciles the visible rows against the current handful. */
  function sync(entries, { hintText = null, footerText = null } = {}) {
    const visible = entries.slice(0, Math.max(config.maxRows, 1));

    const live = new Set(visible.map((e) => e.record));
    for (const [record, state] of rows) {
      if (live.has(record)) continue;
      state.row.remove();
      rows.delete(record);
      metricsDirty = true;
    }

    visible.forEach((entry, index) => {
      let state = rows.get(entry.record);
      if (!state) {
        const { row, flap } = makeRow(entry.record);
        state = { row, flap, seenChanges: entry.changes, flipStart: -1, nextText: null, text: textFor(entry) };
        flap.textContent = state.text;
        rows.set(entry.record, state);
        metricsDirty = true;
      } else if (entry.changes !== state.seenChanges) {
        // A re-roll landed: start (or restart) the flip. Restarting is exactly
        // right if the crescendo has outrun the previous animation.
        state.seenChanges = entry.changes;
        state.nextText = textFor(entry);
        state.flipStart = performance.now();
      }
      if (list.children[index] !== state.row) list.insertBefore(state.row, list.children[index] || null);
    });

    order = visible.map((e) => rows.get(e.record)).filter(Boolean);

    const extra = entries.length - visible.length;
    overflow.hidden = extra <= 0;
    if (extra > 0) overflow.textContent = `+${extra} más`;

    hint.hidden = !hintText;
    if (hintText) hint.textContent = hintText;
    footer.hidden = !footerText;
    if (footerText) footer.textContent = footerText;

    if (el.hidden) {
      el.hidden = false;
      metricsDirty = true;
    }
  }

  /** One layout read, taken only when the row set actually changed. */
  function measure() {
    if (!metricsDirty || order.length === 0) return;
    const probe = order[0].row;
    rowW = probe.offsetWidth || rowW;
    rowH = probe.offsetHeight || rowH;
    metricsDirty = false;
  }

  /** Advances the flips at whatever pace the crescendo currently dictates. */
  function updateFlips(nowMs, flipIntervalMs) {
    // Never let a flip outlast the gap to the next one, or they overlap and
    // the flap appears to stall. 60ms floor keeps it visible at full charge.
    const duration = Math.max(Math.min(config.splitFlapDuration, flipIntervalMs * 0.6), 60);

    for (const state of rows.values()) {
      if (state.flipStart < 0) continue;
      const t = Math.min((nowMs - state.flipStart) / duration, 1);

      // First half folds the flap edge-on; the character is swapped exactly at
      // the midpoint while it's invisible at 90 degrees, then unfolds.
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

  /**
   * Interpolates every row between the vertical (stacked) and horizontal
   * (side-by-side) layouts, and sizes the container to match.
   */
  function layout(availableWidth) {
    measure();
    if (order.length === 0 || rowW === 0) return 1;

    const gap = 10;
    const n = order.length;
    const vW = rowW;
    const vH = rowH * n;
    const hW = rowW * n + gap * (n - 1);
    const hH = rowH;

    order.forEach((state, i) => {
      const vx = 0;
      const vy = i * rowH;
      const hx = i * (rowW + gap);
      const hy = 0;
      state.row.style.transform = `translate(${vx + (hx - vx) * migration}px, ${vy + (hy - vy) * migration}px)`;
    });

    contentW = vW + (hW - vW) * migration;
    contentH = vH + (hH - vH) * migration;
    list.style.width = `${contentW}px`;
    list.style.height = `${contentH}px`;

    // A row of N "Tenés un X" entries is wide, and on a phone it would run off
    // both edges. Scaling the whole box to fit keeps the reflow continuous —
    // unlike shortening the rows, which would jump and invalidate the metrics.
    const fullW = contentW + boxExtra.x;
    return availableWidth > 0 ? Math.min(1, availableWidth / fullW) : 1;
  }

  /**
   * Places the box so a specific ANCHOR POINT on it — not its top-left corner
   * — lands exactly at (targetX, targetY) on screen, and applies the four
   * charging layers on top of that same placement.
   *
   * The position is computed directly in pixels rather than leaning on CSS's
   * `translate: -50%` percentage trick (the previous approach): with
   * `transform-origin` at the box's own centre (the CSS default, made
   * explicit in style.css), `scale()` never moves that centre — only
   * `translate()` does — so this maths is exact and independent of the
   * current scale. The old version mixed a CSS `translate: -50%` with a JS
   * `transform: translate() scale()`, AND flipped which CSS rule was active
   * via a class toggled at a hard 50% migration threshold while the target
   * point itself moved continuously — two systems computing overlapping
   * offsets on different schedules, which is what actually produced the
   * off-centre result.
   *
   * `anchorYFraction` is where the pin point sits vertically on the box: 1 =
   * bottom edge (rest, pinned above the hand), 0.5 = centre (migrated), and
   * everything between is interpolated continuously as migration progresses,
   * so there is no threshold anywhere for it to jump at. Horizontal is always
   * 0.5 — centred in both poses — so it needs no fraction at all, and is
   * therefore exactly viewport-centred independent of row count or scale.
   */
  function place(targetX, targetY, anchorYFraction, scale, charge) {
    const boxW = contentW + boxExtra.x;
    const boxH = contentH + boxExtra.y;

    let jitterX = 0;
    let jitterY = 0;
    if (config.chargeShakeEnabled && charge > 0) {
      const amp = config.chargeShakeAmount * charge;
      jitterX = (Math.random() * 2 - 1) * amp;
      jitterY = (Math.random() * 2 - 1) * amp;
    }

    // Horizontal: always centre-anchored, so the box's own centre lands at
    // targetX regardless of scale — translate by targetX - boxW/2.
    const px = targetX - boxW / 2;
    // Vertical: the anchored point is `anchorYFraction` down the SCALED box
    // (bottom edge at rest, centre once migrated), offset from the box's own
    // centre by (anchorYFraction - 0.5) * boxH * scale.
    const py = targetY - (anchorYFraction - 0.5) * boxH * scale - boxH / 2;

    el.style.transform = `translate(${px + jitterX}px, ${py + jitterY}px) scale(${scale})`;

    // The remaining charging layers: glow and background temperature. Neither
    // touches position, so they're independent of the maths above.
    if (config.chargeGlowEnabled) {
      const g = config.chargeGlowAmount * charge;
      el.style.boxShadow =
        g > 0.001 ? `0 2px 10px rgba(28, 34, 43, 0.1), 0 0 ${12 + 22 * g}px rgba(255, 150, 60, ${0.5 * g})` : "";
    } else {
      el.style.boxShadow = "";
    }

    if (config.chargeTemperatureEnabled) {
      // Warm shift on the BACKGROUND only — never the per-type chips.
      const t = config.chargeTemperatureAmount * charge;
      const g2 = Math.round(255 + (232 - 255) * t);
      const b = Math.round(255 + (198 - 255) * t);
      el.style.background = `rgba(255, ${g2}, ${b}, ${0.82 + 0.12 * t})`;
    } else {
      el.style.background = "";
    }
  }

  /**
   * One call per frame: advances migration, flips, layout and the charge
   * layers, and positions the box between the hand and its parked spot.
   */
  function update(
    nowMs,
    dtMs,
    { charge = 0, shaking = false, flipIntervalMs = 1000, handPoint, parkedPoint, viewportWidth = 0 }
  ) {
    if (el.hidden) return;

    // Migration is its own tween, not the crescendo: how fast the box travels
    // is a separate question from how wound-up it is.
    const dur = Math.max(config.tooltipMigrationDuration, 1);
    migration = shaking ? Math.min(1, migration + dtMs / dur) : Math.max(0, migration - dtMs / dur);
    // Ease so it leaves and arrives softly instead of tracking linearly.
    const m = migration < 0.5 ? 4 * migration ** 3 : 1 - Math.pow(-2 * migration + 2, 3) / 2;

    updateFlips(nowMs, flipIntervalMs);
    const fitScale = layout(viewportWidth);

    // Target point interpolates from the hand to the parked spot; the anchor
    // FRACTION (which part of the box sits on that point) interpolates over
    // the exact same `m`, continuously — no threshold, so there is nothing
    // for the two to disagree about mid-transition (see place()'s doc comment
    // for what that threshold caused before).
    const x = handPoint.x + (parkedPoint.x - handPoint.x) * m;
    const y = handPoint.y + (parkedPoint.y - handPoint.y) * m;
    const anchorYFraction = 1 - 0.5 * m; // 1 = bottom edge (rest) -> 0.5 = centre (migrated)

    const grow = config.chargeScaleEnabled ? 1 + config.chargeScaleAmount * charge : 1;
    // Fit scale and charge growth multiply: the box may never outgrow the
    // viewport, however hard it's being charged.
    place(x, y, anchorYFraction, grow * fitScale, charge);
  }

  function hide() {
    if (el.hidden) return;
    el.hidden = true;
    for (const state of rows.values()) state.row.remove();
    rows.clear();
    order = [];
    migration = 0;
    metricsDirty = true;
    el.style.boxShadow = "";
    el.style.background = "";
  }

  return { sync, update, hide, el, getMigration: () => migration };
}
