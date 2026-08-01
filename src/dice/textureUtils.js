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
