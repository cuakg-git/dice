import { getRolls, clearRolls, subscribe, formatDice, perDieLines } from "../state/rollLog.js";
import { ROLL_LOG_CONFIG } from "../state/rollLogConfig.js";
import { DICE_ICONS } from "../dice/diceColors.js";

const OPEN_KEY = "dice.rollLogOpen"; // session-remembered open/closed state

/**
 * The "Tiradas" sidesheet: a right-edge panel that slides in over the scene
 * (CSS `.is-open` toggles a transform, so opening/closing never resizes the
 * 3D viewport underneath — the physics is untouched). A corner toggle button
 * (grouped next to the Discord button) opens/closes it; so do a close ✕ inside
 * and the Escape key.
 *
 * Content is the same rolls the log already records, newest first. Within a
 * roll, every INDIVIDUAL die gets its own line (icon + type + value) sorted
 * by die type — "D6 = 2" / "D6 = 4" / "D20 = 5" as three separate lines, never
 * grouped into "D6: 2, 4". This is deliberately its own presentation
 * (perDieLines) rather than reusing formatValueLines — that one still backs
 * the Discord message, which keeps its grouped-by-type format unchanged.
 * A roll of 2+ dice gets one more line after those, "Total: X" (see render()'s
 * ROLL_LOG_CONFIG.showTotal branch) — additive, never replacing the per-die
 * lines above it.
 */
export function createRollLogPanel({ root = document.getElementById("roll-log") } = {}) {
  if (!root) return { destroy() {} };

  const list = root.querySelector("#roll-log-list");
  const empty = root.querySelector("#roll-log-empty");
  const clearButton = root.querySelector("#roll-log-clear");
  const closeButton = root.querySelector("#roll-log-close");
  const toggle = document.getElementById("roll-log-toggle");

  // --- open / close --------------------------------------------------------

  function isOpen() {
    return root.classList.contains("is-open");
  }
  function setOpen(open) {
    root.classList.toggle("is-open", open);
    toggle?.setAttribute("aria-expanded", String(open));
    try {
      sessionStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* session persistence is a nicety; ignore if storage is unavailable */
    }
  }

  toggle?.addEventListener("click", () => setOpen(!isOpen()));
  closeButton?.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) setOpen(false);
  });

  clearButton?.addEventListener("click", () => clearRolls());

  // --- rendering -----------------------------------------------------------

  function render(rolls) {
    empty.hidden = rolls.length > 0;
    list.textContent = "";

    // Newest at the top.
    for (let i = rolls.length - 1; i >= 0; i--) {
      const entry = rolls[i];

      const item = document.createElement("li");
      item.className = "roll-log__item";

      // Discreet summary subtitle: "2d6 + 1d8".
      const dice = document.createElement("div");
      dice.className = "roll-log__dice";
      dice.textContent = formatDice(entry);
      item.append(dice);

      // Primary content: one row per INDIVIDUAL die (never grouped), already
      // sorted D4->D20 by perDieLines().
      const lines = document.createElement("div");
      lines.className = "roll-log__lines";
      for (const { type, value } of perDieLines(entry)) {
        const line = document.createElement("div");
        line.className = "roll-log__line";

        // The real per-type PNG (transparent background), not a color swatch.
        // Decorative — the label text right next to it already names the
        // type — so it's alt="" and aria-hidden rather than announced twice.
        const icon = document.createElement("img");
        icon.className = "roll-log__die-icon";
        icon.alt = "";
        icon.setAttribute("aria-hidden", "true");
        icon.decoding = "async";
        const iconSrc = DICE_ICONS[type];
        if (iconSrc) {
          icon.src = iconSrc;
          // Fallback: if the image can't actually load for some reason, drop
          // it rather than show a broken-image box — the label + value text
          // alone are still a complete, legible line.
          icon.addEventListener("error", () => {
            icon.hidden = true;
          });
        } else {
          icon.hidden = true;
        }

        const label = document.createElement("span");
        label.className = "roll-log__die-label";
        label.textContent = type;

        const eq = document.createElement("span");
        eq.className = "roll-log__die-eq";
        eq.textContent = "=";

        const valueEl = document.createElement("span");
        valueEl.className = "roll-log__die-value";
        valueEl.textContent = value;

        line.append(icon, label, eq, valueEl);
        lines.append(line);
      }
      item.append(lines);

      // Trailing total (ROLL_LOG_CONFIG.showTotal): only for 2+ dice — a
      // single die's total is just its own value, already shown above.
      if (ROLL_LOG_CONFIG.showTotal && entry.count >= 2) {
        const total = document.createElement("div");
        total.className = "roll-log__total";
        total.textContent = `Total: ${entry.total}`;
        item.append(total);
      }

      list.append(item);
    }
  }

  render(getRolls());
  const unsubscribe = subscribe(render);

  // Restore the remembered open state (default closed).
  let wasOpen = false;
  try {
    wasOpen = sessionStorage.getItem(OPEN_KEY) === "1";
  } catch {
    /* ignore */
  }
  setOpen(wasOpen);

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    destroy() {
      unsubscribe();
    },
  };
}
