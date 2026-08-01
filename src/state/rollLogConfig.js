/**
 * Display config for the roll log. Kept separate from rollLog.js (the data
 * model) so a presentation tweak never touches the recording/batching logic.
 */
export const ROLL_LOG_CONFIG = {
  // The summed total is secondary/discreet at most — individual die values
  // are always the highlighted, primary result. Off by default: a sum reads
  // as "the" result at a glance, which is exactly what this flag prevents.
  showTotal: false,
};
