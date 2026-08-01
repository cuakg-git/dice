const SPACING_FACTOR = 2.6;
const MARGIN_FACTOR = 3.2; // leaves room for the tray's label near its start edge

/**
 * Builds a slot-index -> {x, z} function for the selection tray. Dice fill
 * in selection order:
 *  - "vertical" (desktop, left sidebar): top-to-bottom in a column, then
 *    continue in the next column to the right.
 *  - "horizontal" (mobile, bottom tray): left-to-right in a row, then
 *    continue in the next row below.
 */
export function createSlotGrid({ centerX, centerZ, width, depth, dieRadius, orientation = "vertical" }) {
  const spacing = dieRadius * SPACING_FACTOR;
  const margin = dieRadius * MARGIN_FACTOR;

  if (orientation === "horizontal") {
    const usableWidth = Math.max(width - spacing, spacing);
    const perRow = Math.max(1, Math.floor(usableWidth / spacing));
    const startX = centerX - width / 2 + spacing / 2;
    const startZ = centerZ - depth / 2 + margin;

    return function slotFor(index) {
      const row = Math.floor(index / perRow);
      const col = index % perRow;
      return { x: startX + spacing * col, z: startZ + spacing * row };
    };
  }

  const usableDepth = Math.max(depth - margin - dieRadius, spacing);
  const rowsPerColumn = Math.max(1, Math.floor(usableDepth / spacing));
  const startZ = centerZ - depth / 2 + margin;
  const startX = centerX - width / 2 + spacing / 2;

  return function slotFor(index) {
    const col = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    return { x: startX + spacing * col, z: startZ + spacing * row };
  };
}
