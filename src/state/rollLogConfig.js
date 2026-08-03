/**
 * Display config for the roll log. Kept separate from rollLog.js (the data
 * model) so a presentation tweak never touches the recording/batching logic.
 */
export const ROLL_LOG_CONFIG = {
  // Adds one extra "Total: X" line AFTER every individual die line, only for
  // rolls of 2+ dice (a single die's total is just its own value — showing
  // it again would be redundant, not informative). It's additive, never a
  // replacement: the per-die lines stay the primary content in both the
  // sidesheet and the Discord message: see rollLogPanel.js's render() and
  // discordMessage.js's buildRollWebhookPayload().
  showTotal: true,
};
