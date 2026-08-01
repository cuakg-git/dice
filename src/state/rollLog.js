/**
 * Session log of completed rolls. A "roll" is one throw gesture: every die
 * launched together, recorded once they have ALL come to rest (main.js owns
 * that batching — see the throw-batch code there).
 *
 * Session-only by design: nothing is persisted between reloads.
 */

// Smallest-to-largest, so a mixed roll always reads "1d6 + 2d20", not
// whatever order the dice happened to settle in.
const TYPE_ORDER = ["D4", "D6", "D8", "D10", "D12", "D20"];

const entries = []; // newest LAST here; the panel renders it reversed
const listeners = new Set();
let nextId = 1;

/**
 * Records one completed roll from [{ typeName, value }, ...].
 * Returns the created entry (already grouped by die type and totalled).
 */
export function addRoll(dice) {
  if (!dice || dice.length === 0) return null;

  const byType = new Map();
  for (const { typeName, value } of dice) {
    if (!byType.has(typeName)) byType.set(typeName, []);
    byType.get(typeName).push(value);
  }

  const groups = [...byType.entries()]
    .sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a[0]);
      const ib = TYPE_ORDER.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([type, values]) => ({ type, values }));

  const total = dice.reduce((sum, d) => sum + d.value, 0);
  const entry = { id: nextId++, groups, total, count: dice.length };
  entries.push(entry);
  notify();
  return entry;
}

/** Oldest-first snapshot. */
export function getRolls() {
  return entries.map((e) => ({ ...e, groups: e.groups.map((g) => ({ ...g, values: g.values.slice() })) }));
}

export function clearRolls() {
  if (entries.length === 0) return;
  entries.length = 0;
  notify();
}

/** "2d20 + 1d6" — what was thrown (the discreet summary subtitle). */
export function formatDice(entry) {
  return entry.groups.map((g) => `${g.values.length}d${g.type.slice(1)}`).join(" + ");
}

/**
 * The canonical result presentation, shared verbatim by the roll-log
 * sidesheet AND the Discord message: ONE line per die type present, each
 * labelled with its type and listing that type's individual values.
 *
 *   ["d6: 3, 4", "d8: 3"]
 *
 * A type with a single die shows a single number ("d10: 5"). The panel maps
 * each string to its own stacked row; Discord joins them with "\n". Keeping
 * this the one source of both guarantees the two never drift apart.
 */
export function formatValueLines(entry) {
  return entry.groups.map((g) => `d${g.type.slice(1)}: ${g.values.join(", ")}`);
}

/** The same lines as a single newline-joined block (for Discord / plain text). */
export function formatValuesText(entry) {
  return formatValueLines(entry).join("\n");
}

/**
 * One entry per individual die actually thrown — the sidesheet's per-line
 * presentation ("D6 = 2", "D6 = 4", "D20 = 5" as three separate lines, never
 * "D6: 2, 4"). Sorted by die type (D4->D20, same order as the groups below,
 * which addRoll() already sorted by TYPE_ORDER); within a type, dice keep the
 * order their values were recorded in — nothing meaningful to sort them by
 * beyond that.
 *
 * This does NOT replace formatValueLines()/formatValuesText() above — those
 * stay exactly as they are for Discord (grouped-by-type), since only the
 * sidesheet's presentation changed here.
 */
export function perDieLines(entry) {
  const out = [];
  for (const g of entry.groups) {
    for (const value of g.values) out.push({ type: g.type, value });
  }
  return out;
}

/** Returns an unsubscribe function. */
export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notify() {
  const snapshot = getRolls();
  listeners.forEach((callback) => callback(snapshot));
}
