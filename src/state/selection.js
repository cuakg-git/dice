/**
 * Central selection state, decoupled from rendering. Two parts:
 *
 *  - `selection`: the ordered list of dice that have come to rest on the
 *    throw board, in the order they settled. This is what "the player has
 *    chosen" means, and what the future "roll selected dice" feature reads.
 *  - `held`: the ordered collection of dice currently carried in the hand
 *    cursor (0..N). They are in transit — no longer in the source strip, not
 *    yet on the board — so they are tracked separately rather than muddying
 *    the ordered list. Picking a settled die up removes it from `selection`
 *    and adds it here; throwing/dropping/removing does the reverse.
 *
 * Rendering code (main.js) subscribes to reflect changes visually.
 */
const selection = [];
const held = []; // ordered [{ id, type }, ...], the handful in the hand
const listeners = new Set();

/** Ordered snapshot: [{ id, type }, ...] in the order dice settled on the board. */
export function getSelection() {
  return selection.slice();
}

export function isSelected(id) {
  return selection.some((entry) => entry.id === id);
}

export function selectDie(id, type) {
  if (isSelected(id)) return;
  selection.push({ id, type });
  notify();
}

export function deselectDie(id) {
  const index = selection.findIndex((entry) => entry.id === id);
  if (index === -1) return;
  selection.splice(index, 1);
  notify();
}

/** Ordered snapshot of the handful in the hand: [{ id, type }, ...]. */
export function getHeldDice() {
  return held.map((entry) => ({ ...entry }));
}

export function isHeld(id) {
  return held.some((entry) => entry.id === id);
}

/**
 * Adds a die to the handful in the hand. A die can't be both held and
 * settled on the board, so this also drops it from the ordered selection.
 * No-op if it's already held (can't grab the same die twice).
 */
export function addHeldDie(id, type) {
  if (isHeld(id)) return;
  const index = selection.findIndex((entry) => entry.id === id);
  if (index !== -1) selection.splice(index, 1);
  held.push({ id, type });
  notify();
}

/** Removes one die from the handful (when it's taken back out of the hand). */
export function removeHeldDie(id) {
  const index = held.findIndex((entry) => entry.id === id);
  if (index === -1) return;
  held.splice(index, 1);
  notify();
}

/** Empties the whole handful (on release/throw-all). */
export function clearHeldDice() {
  if (held.length === 0) return;
  held.length = 0;
  notify();
}

/** Returns an unsubscribe function. Callback receives the new snapshot. */
export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notify() {
  const snapshot = getSelection();
  listeners.forEach((callback) => callback(snapshot));
}
