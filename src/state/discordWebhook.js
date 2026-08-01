/**
 * Discord webhook: storage + the forgiving parse/validate/clean logic, plus a
 * minimal sender used by the "Probar" button and by roll-forwarding.
 *
 * Everything here is framework-free and DOM-free so it can be unit-tested and
 * reused; the panel UI (discordPanel.js) is a thin shell over it.
 *
 * NOTE: the brief assumed the send logic already existed — it did not in this
 * codebase, so `sendMessage`/`sendTestMessage` below are new and deliberately
 * self-contained. If a real sender already lives elsewhere, swap those two
 * functions for it; nothing else here depends on their internals.
 */

const URL_KEY = "dice.discordWebhookUrl";
const CONNECTED_KEY = "dice.discordConnected"; // "1" once a test send succeeded

// The canonical webhook shape, matched ANYWHERE in the pasted text so a user
// can paste "mi webhook: https://..." and we still find it. Accepts:
//  - discord.com AND the legacy discordapp.com
//  - the canary/ptb subdomains
//  - an optional /api/vN version segment
// id = digits, token = base64url-ish (letters, digits, _ and -).
const WEBHOOK_RE =
  /https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d+)\/([\w-]+)/i;

// Cheap shape checks for the specific-error branches (order matters in analyze).
const INVITE_RE = /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)/i;
const CHANNEL_RE = /discord(?:app)?\.com\/channels\//i;
const LOOKS_LIKE_URL_RE = /^(https?:\/\/|www\.)|\.[a-z]{2,}(\/|$)/i;

/**
 * Strips the junk that rides along with a copy/paste: surrounding whitespace,
 * newlines, wrapping quotes/backticks/angle-brackets, and a trailing ">" or
 * stray punctuation. Internal whitespace is dropped too (a URL never contains
 * any), which repairs a link that got wrapped across lines on copy.
 */
export function cleanPastedUrl(raw) {
  let s = String(raw ?? "");
  s = s.trim();
  s = s.replace(/[\s]+/g, ""); // kill newlines/tabs/spaces anywhere
  s = s.replace(/^[<"'`“”‘’]+/, ""); // leading quotes/brackets (incl. smart quotes)
  s = s.replace(/[>"'`“”‘’]+$/, ""); // trailing quotes/brackets
  return s;
}

/**
 * Classifies a pasted string. Always returns an object with `ok`; on failure
 * it carries a specific, human, actionable `reason` + `message` (never a bare
 * "invalid"). On success it returns the cleaned canonical `url` plus id/token.
 */
export function analyzeInput(raw) {
  const cleaned = cleanPastedUrl(raw);

  if (cleaned.length === 0) {
    return { ok: false, reason: "empty", message: "Pegá la URL de tu webhook para continuar." };
  }

  const match = cleaned.match(WEBHOOK_RE);
  if (match) {
    return { ok: true, url: match[0], id: match[1], token: match[2] };
  }

  // Specific, actionable errors — most-recognizable shapes first.
  if (INVITE_RE.test(cleaned)) {
    return {
      ok: false,
      reason: "invite",
      message:
        "Eso es un enlace de invitación al servidor, no un webhook. Necesitás crear un webhook en Configuración del servidor → Integraciones → Webhooks.",
    };
  }

  if (CHANNEL_RE.test(cleaned)) {
    return {
      ok: false,
      reason: "channel",
      message: "Eso es el enlace de un canal, no un webhook. Seguí los pasos para crear un webhook.",
    };
  }

  // Looks like it's trying to be a Discord webhook (or any Discord/URL link)
  // but is missing the id or the token: it's incomplete/cut off.
  const looksLikeWebhookAttempt = /discord(?:app)?\.com\/api\/webhooks/i.test(cleaned) || /webhooks\//i.test(cleaned);
  const looksLikeUrl = LOOKS_LIKE_URL_RE.test(cleaned) || /discord(?:app)?\.com/i.test(cleaned);

  if (looksLikeWebhookAttempt || (looksLikeUrl && /discord/i.test(cleaned))) {
    return {
      ok: false,
      reason: "incomplete",
      message: "La URL parece incompleta. Asegurate de copiar la URL completa con 'Copiar URL del webhook'.",
    };
  }

  if (looksLikeUrl) {
    // A real URL, but not a Discord one at all — same fix as "incomplete":
    // copy the full webhook URL from Discord.
    return {
      ok: false,
      reason: "incomplete",
      message: "La URL parece incompleta. Asegurate de copiar la URL completa con 'Copiar URL del webhook'.",
    };
  }

  return {
    ok: false,
    reason: "not_url",
    message: "Eso no parece una URL. Copiá la URL completa desde Discord.",
  };
}

// --- Persistence -----------------------------------------------------------

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: config just won't persist across reloads */
  }
}
function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

const listeners = new Set();
function notify() {
  const snap = getState();
  listeners.forEach((cb) => cb(snap));
}

export function getWebhookUrl() {
  return safeGet(URL_KEY);
}

export function isConnected() {
  return safeGet(CONNECTED_KEY) === "1" && !!safeGet(URL_KEY);
}

export function getState() {
  return { url: getWebhookUrl(), connected: isConnected() };
}

/** Saves a (already-validated) url. Saving a NEW url resets the connected flag. */
export function saveWebhookUrl(url) {
  const prev = safeGet(URL_KEY);
  safeSet(URL_KEY, url);
  if (prev !== url) safeRemove(CONNECTED_KEY); // a changed url must re-prove itself
  notify();
}

export function markConnected(connected) {
  if (connected) safeSet(CONNECTED_KEY, "1");
  else safeRemove(CONNECTED_KEY);
  notify();
}

export function clearWebhook() {
  safeRemove(URL_KEY);
  safeRemove(CONNECTED_KEY);
  notify();
}

export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// --- Sending ---------------------------------------------------------------

/**
 * POSTs an arbitrary Discord webhook JSON body (`{ content }`, `{ embeds }`,
 * or both). Returns a plain result — never throws — with a user-facing
 * `message` on failure that carries NO technical jargon (no "CORS",
 * "payload", "endpoint"). Discord answers a good send with 204.
 *
 * Generic on purpose: this is the one place that talks to `fetch`, so a
 * future message shape (e.g. discordMessage.js's noted per-type-embed mode)
 * is just a different `payload` object handed in here — nothing about
 * sending itself has to change.
 */
export async function sendWebhookPayload(url, payload) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Network error / blocked request — the user doesn't need to know which.
    return { ok: false, message: "No pudimos enviar el mensaje. Revisá que la URL sea correcta y volvé a intentar." };
  }

  if (res.ok) return { ok: true };

  if (res.status === 429) {
    return { ok: false, message: "Discord nos pidió esperar un momento. Probá de nuevo en unos segundos." };
  }
  // 401/403/404/... — almost always a wrong or deleted webhook.
  return { ok: false, message: "No pudimos enviar el mensaje. Revisá que la URL sea correcta y volvé a intentar." };
}

/** Convenience wrapper for a plain-text send (used by the "Probar" test message). */
export function sendMessage(url, content) {
  return sendWebhookPayload(url, { content });
}

const TEST_MESSAGE = "✅ ¡Tu dice roller está conectado! Las tiradas van a aparecer acá.";

export function sendTestMessage(url) {
  return sendMessage(url, TEST_MESSAGE);
}
