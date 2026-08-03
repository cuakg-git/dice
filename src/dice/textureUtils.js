import * as THREE from "three";

/**
 * Draws every face number of a die type into one shared atlas texture (a
 * gridSize x gridSize grid of cells), used as the die's actual albedo `map` —
 * the background is filled with the die type's own fixed body color, and the
 * numbers are painted on top in a dark ink, so contrast is BAKED IN rather
 * than relying on additive lighting tricks (which can only brighten, never
 * darken — no good for keeping numbers legible on a light body color like a
 * yellow D6). Orientation per face is handled by the UV mapping (see
 * polyhedronUtils.js buildFaceFrames/remapUVsToAtlas) — the canvas itself
 * just draws each number upright and centered in its cell.
 */
export function createNumberAtlasTexture({ numbers, gridSize, bgColor = "#000000", textColor = "#ffffff", cellSize = 128 }) {
  const canvasSize = gridSize * cellSize;
  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(cellSize * 0.42)}px system-ui, sans-serif`;

  numbers.forEach((number, i) => {
    const col = i % gridSize;
    const row = Math.floor(i / gridSize);
    const cx = col * cellSize + cellSize / 2;
    const cy = row * cellSize + cellSize / 2 + cellSize * 0.02;
    ctx.fillText(String(number), cx, cy);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Same atlas idea, but for VERTEX-numbered dice (the D4): instead of one
 * number centred per face, each face gets one number beside each of its
 * corners. Deliberately a separate function rather than a mode flag on the
 * one above, so the five face-numbered dice keep running through byte-
 * identical code.
 *
 * `faceLabels[f]` is a list of `{ u, v, number }` in that face's own 0..1
 * tile space (from numbersFromVertices). Two transforms turn those into
 * canvas pixels:
 *
 *  - u -> x directly, but v -> (1 - v): the texture is sampled with the
 *    default flipY, so tile V=1 is the TOP of the cell while canvas y grows
 *    downward. Getting this backwards would mirror every face vertically.
 *  - the label is pulled from the corner toward the face centre by
 *    `cornerInset`, so a digit sits *inside* the triangle with margin instead
 *    of straddling an edge.
 *
 * Each digit is also rotated so its "up" points from the face centre out
 * toward its corner. That's the real-D4 convention: whichever corner is the
 * apex, the numbers around it read upright to someone looking at it.
 *
 * `cornerInset`/`fontScale` defaults are NOT eyeballed: they're the solution
 * to a small joint-optimization over the real face-corner geometry (see the
 * task's tuning notes) — as a label moves toward its vertex (`cornerInset`
 * up), its clearance from that vertex's two edges shrinks while its distance
 * from the OTHER two labels on the same face grows, in opposite directions.
 * 0.36/0.24 is the crossover where neither constraint is looser than the
 * other, which is the largest font that clips no edge and overlaps no label —
 * pushing `cornerInset` higher (closer to the vertex, the naive "more room"
 * instinct) actually makes edge clipping happen SOONER, not later.
 */
export function createCornerNumberAtlasTexture({
  faceLabels,
  gridSize,
  bgColor = "#000000",
  textColor = "#ffffff",
  cellSize = 128,
  cornerInset = 0.36,
  fontScale = 0.24,
}) {
  const canvasSize = gridSize * cellSize;
  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // 900 (heaviest), not the 700 the other 5 dice use: at small on-screen
  // sizes, stroke weight buys more perceived legibility than the same
  // fontScale at a lighter weight — cheaper than the last few percent of
  // size the geometry has no room left to give.
  ctx.font = `900 ${Math.round(cellSize * fontScale)}px system-ui, sans-serif`;

  faceLabels.forEach((labels, f) => {
    const col = f % gridSize;
    const row = Math.floor(f / gridSize);
    const originX = col * cellSize;
    const originY = row * cellSize;

    for (const { u, v, number } of labels) {
      // Tile -> cell-local pixels (v flipped: tile V=1 is the cell's top).
      const cornerX = u * cellSize;
      const cornerY = (1 - v) * cellSize;
      const centreX = 0.5 * cellSize;
      const centreY = 0.5 * cellSize;

      const x = originX + centreX + (cornerX - centreX) * cornerInset;
      const y = originY + centreY + (cornerY - centreY) * cornerInset;

      // Point the digit's up-axis at its corner. Canvas text's up is -y, and
      // ctx.rotate is clockwise, so this angle sends (0,-1) onto the outward
      // direction.
      const dx = cornerX - centreX;
      const dy = cornerY - centreY;
      const angle = Math.atan2(dx, -dy);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillText(String(number), 0, 0);
      ctx.restore();
    }
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
