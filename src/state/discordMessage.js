import { perDieLines, formatDice } from "./rollLog.js";
import { ROLL_LOG_CONFIG } from "./rollLogConfig.js";
import { DICE_EMOJI } from "../dice/diceColors.js";

/**
 * Builds the Discord presentation of a roll. Kept separate from both
 * rollLog.js (platform-agnostic data + the sidesheet's own formatting) and
 * discordWebhook.js (generic send/validate/persist plumbing), so this is the
 * one place that knows what a Discord MESSAGE should look like.
 *
 * One line per individual die (perDieLines — the exact same per-die,
 * sorted-by-type ordering the sidesheet uses), each with a colored emoji
 * indicator since Discord's `content` is plain text and embeds only offer
 * one image/thumbnail per MESSAGE, not one icon per line (see DICE_EMOJI's
 * own doc comment in diceColors.js for the color->emoji mapping rationale).
 */
function formatDiscordDieLines(entry) {
  return perDieLines(entry).map(({ type, value }) => `${DICE_EMOJI[type] || "⬜"} ${type} = ${value}`);
}

/**
 * The full webhook JSON body for one roll. Currently always the plain-
 * content form below; this is the seam to switch to a per-type-embed mode
 * later (one embed per die type, its `color` field set to that type's real
 * hex from DICE_COLORS, for exact color fidelity instead of the emoji
 * approximation) — WITHOUT touching discordWebhook.js's sender, which just
 * POSTs whatever payload object it's handed. To add that mode: build an
 * `embeds` array here (grouped by type, one embed per type with `color` =
 * parseInt(DICE_COLORS[type].slice(1), 16) and a description listing that
 * type's values) and return `{ content: header, embeds }` instead. Not
 * implemented now — content-only, per spec.
 */
export function buildRollWebhookPayload(entry, who) {
  const header = `${who ? `🎲 ${who}` : "🎲"} — ${formatDice(entry)}`;
  const lines = [header, ...formatDiscordDieLines(entry)];
  if (ROLL_LOG_CONFIG.showTotal) lines.push(`total ${entry.total}`);
  // A real "\n" character (not the two-character "\\n"), so JSON.stringify
  // encodes it as the escape sequence Discord decodes back into an actual
  // line break — the same mechanism as pressing Shift+Enter in the client.
  return { content: lines.join("\n") };
}
