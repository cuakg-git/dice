import { createHand } from "./Hand.js";
import { loadHandTemplate, buildHandFromTemplate } from "./glbHandSkin.js";
import manoOrcoUrl from "../assets/mano_orco.glb";

/**
 * The hand-skin registry: "default" is the original procedural rig
 * (Hand.js), always available, no preload needed. Every other entry names a
 * GLB built per RIG_SPEC.md — add new skins here as they're modeled.
 */
const SKINS = {
  orco: { url: manoOrcoUrl },
};

const resolvedTemplates = new Map(); // skin id -> Object3D (populated by preloadHandSkin)

const DEFAULT_PRELOAD_TIMEOUT_MS = 8000;

/**
 * Preloads a skin's GLB so createHandSkin() can build it SYNCHRONOUSLY
 * later — createHandCursor()'s contract is synchronous (it builds the whole
 * scene graph in one call), and a GLB load is inherently async, so this has
 * to happen and be awaited BEFORE createHandCursor() if config.cursor.skin
 * names a GLB skin. No-op for "default"/undefined: the procedural rig needs
 * nothing preloaded.
 *
 *   await preloadHandSkin(config.cursor.skin);
 *   const handCursor = createHandCursor({ scene, config, platform });
 *
 * Bounded by `timeoutMs` (default 8s) so a stalled fetch can never hang a
 * caller's boot sequence forever — rejects instead of hanging past that.
 * Callers still need their own fallback for the rejection (main.js falls
 * back to the "default" skin and logs loudly; see there for the pattern).
 * The underlying network request itself isn't aborted on timeout — it's
 * left to finish or fail on its own via loadHandTemplate()'s own memoized
 * promise — so a slow-but-eventually-successful load still populates the
 * cache for any later retry, it just won't hold up THIS call.
 */
export async function preloadHandSkin(skin, { timeoutMs = DEFAULT_PRELOAD_TIMEOUT_MS } = {}) {
  if (!skin || skin === "default") return;
  const entry = SKINS[skin];
  if (!entry) throw new Error(`preloadHandSkin: skin desconocido "${skin}"`);
  if (resolvedTemplates.has(skin)) return;

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`preloadHandSkin: "${skin}" no cargó dentro de ${timeoutMs}ms`)), timeoutMs)
  );
  resolvedTemplates.set(skin, await Promise.race([loadHandTemplate(entry.url), timeout]));
}

/**
 * Drop-in replacement for createHand() that can source geometry from either
 * the procedural builder or a preloaded GLB skin, chosen by `skin`. Same
 * synchronous contract, same return shape: { root, holdAnchor,
 * setFingerCurl, setPose, fingerCount }.
 *
 * `skin: "default"` (or omitted) is a PURE PASSTHROUGH to createHand() — no
 * new computation on that path, so the procedural rig's calibrated behavior
 * is provably unchanged when no skin is configured.
 */
export function createHandSkin({ skin = "default", outlineWidth, mirrored } = {}) {
  if (!skin || skin === "default") {
    return createHand({ outlineWidth, mirrored });
  }
  const template = resolvedTemplates.get(skin);
  if (!template) {
    throw new Error(
      `createHandSkin: el skin "${skin}" no fue precargado. Llamá y esperá ` +
        `preloadHandSkin("${skin}") antes de createHandCursor().`
    );
  }
  return buildHandFromTemplate(template, { outlineWidth, mirrored });
}
