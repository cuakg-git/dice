/** Splits the table into a cols x rows grid of zones, one per die type. */
export function buildZones(tableWidth, tableDepth, cols, rows, offsetX = 0, offsetZ = 0) {
  const zoneWidth = tableWidth / cols;
  const zoneDepth = tableDepth / rows;
  const zones = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      zones.push({
        centerX: offsetX - tableWidth / 2 + zoneWidth * (col + 0.5),
        centerZ: offsetZ - tableDepth / 2 + zoneDepth * (row + 0.5),
        width: zoneWidth,
        depth: zoneDepth,
      });
    }
  }

  return zones;
}

/**
 * Rejection-samples `count` points inside a zone so no two are closer than
 * minDistance (a simple, good-enough stand-in for Poisson-disc sampling at
 * this scale). If a valid spot isn't found after enough tries, the minimum
 * distance is relaxed slightly so the loop always terminates instead of
 * hanging when a zone is packed close to capacity.
 */
export function samplePointsInZone(zone, count, minDistance, margin, hardFloor = minDistance * 0.6) {
  let effMargin = margin;
  let halfW = Math.max(zone.width / 2 - effMargin, 0.01);
  let halfD = Math.max(zone.depth / 2 - effMargin, 0.01);
  const points = [];
  let currentMin = minDistance;
  let attempts = 0;

  while (points.length < count) {
    attempts++;
    const x = zone.centerX + (Math.random() * 2 - 1) * halfW;
    const z = zone.centerZ + (Math.random() * 2 - 1) * halfD;

    const farEnough = points.every((p) => Math.hypot(p.x - x, p.z - z) >= currentMin);
    if (farEnough) {
      points.push({ x, z });
      continue;
    }

    if (attempts > 300) {
      attempts = 0;
      if (currentMin > hardFloor) {
        // First relax the comfortable spacing down toward the no-overlap floor.
        currentMin = Math.max(currentMin * 0.92, hardFloor);
      } else if (effMargin > 0.02) {
        // At the floor and still stuck (a big die in a cramped zone): let the
        // pile use more of the zone by shrinking the edge margin, rather than
        // overlapping. This is the "reduce spacing before overlap" preference.
        // The > 0.02 threshold matters: effMargin*0.6 only approaches 0
        // asymptotically, so without it the else-branch below is never reached
        // and the loop hangs — the whole reason this function must guarantee
        // termination.
        effMargin *= 0.6;
        halfW = Math.max(zone.width / 2 - effMargin, 0.01);
        halfD = Math.max(zone.depth / 2 - effMargin, 0.01);
      } else {
        // Absolute last resort — the dice genuinely don't fit without touching.
        // Place the remainder anyway so this can NEVER infinite-loop; a rare bit
        // of overlap beats a hang.
        points.push({ x, z });
      }
    }
  }

  return points;
}
