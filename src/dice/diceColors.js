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

// The numbers are baked directly into each type's face texture (see
// DieBase.js/textureUtils.js) — a dark, near-black ink so it reads clearly
// against every body color above, including the light D6 (yellow) and D10
// (cyan). Matches the die outline's ink color for a consistent look.
export const DICE_NUMBER_COLOR = "#1a1f26";
