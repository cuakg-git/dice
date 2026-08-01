// Static imports (NOT template-string paths like `../assets/${type}.png`):
// Vite has to see a literal import specifier at build time to fingerprint/
// bundle the file and rewrite it to the right hashed URL in production. A
// dynamically-built path is invisible to that analysis — it works by
// accident in dev (Vite's dev server just resolves whatever path hits the
// filesystem) and then 404s in `vite build`, since nothing told Rollup to
// ever emit that file. Each import below resolves to the final asset URL
// (string) at build time, dev and prod alike.
import d4Icon from "../assets/d4.png";
import d6Icon from "../assets/d6.png";
import d8Icon from "../assets/d8.png";
import d10Icon from "../assets/d10.png";
import d12Icon from "../assets/d12.png";
import d20Icon from "../assets/d20.png";

/**
 * Single source of truth for each die type's fixed body color. Every D6 (say)
 * shares this exact color — no more per-instance random tinting — and this is
 * the one place to look up or change it (the roll log / future icons should
 * reference these same values instead of hardcoding their own).
 */
export const DICE_COLORS = {
  D4: "#CB1DCD",
  D6: "#FDF500",
  D8: "#1AC5B0",
  D10: "#37EBF3",
  D12: "#9370DB",
  D20: "#E455AE",
};

/**
 * Same idea, same keys, for each type's PNG icon (transparent background,
 * near-square but NOT forced to a fixed aspect ratio by any consumer — size
 * with a fixed height + `width: auto` + `object-fit: contain`, never with
 * both dimensions fixed, or the original proportions get distorted).
 */
export const DICE_ICONS = {
  D4: d4Icon,
  D6: d6Icon,
  D8: d8Icon,
  D10: d10Icon,
  D12: d12Icon,
  D20: d20Icon,
};

// The numbers are baked directly into each type's face texture (see
// DieBase.js/textureUtils.js) — a dark, near-black ink so it reads clearly
// against every body color above, including the light D6 (yellow) and D10
// (cyan). Matches the die outline's ink color for a consistent look.
export const DICE_NUMBER_COLOR = "#1a1f26";

/**
 * Same keys again, for Discord messages: webhook `content` is plain text, so
 * there's no way to show a PNG icon per line there (embeds only offer one
 * big image + one thumbnail per MESSAGE, not one per line) — a colored emoji
 * is the closest per-line indicator plain text actually has. Unicode doesn't
 * have a colored square/circle for every hex above, so this is the nearest
 * distinguishable approximation, mixing squares and circles as needed:
 *   D4  #CB1DCD magenta -> 🟪 purple square (closest built-in to magenta)
 *   D6  #FDF500 yellow  -> 🟨 yellow square
 *   D8  #1AC5B0 teal    -> 🟩 green square (closest built-in to teal)
 *   D10 #37EBF3 cyan    -> 🟦 blue square (closest built-in to cyan)
 *   D12 #9370DB violet  -> 🟣 purple circle (distinct from D4's square so the
 *                           two purples don't read as the same indicator)
 *   D20 #E455AE pink    -> 🔴 red circle (no pink emoji exists; red is the
 *                           nearest warm, and using a circle instead of
 *                           another square keeps it distinguishable from D8/D10)
 * This is a deliberate approximation, not a color match — see the alternate
 * per-type-embed mode noted in discordMessage.js for exact color fidelity.
 */
export const DICE_EMOJI = {
  D4: "🟪",
  D6: "🟨",
  D8: "🟩",
  D10: "🟦",
  D12: "🟣",
  D20: "🔴",
};
