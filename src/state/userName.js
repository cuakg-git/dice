/**
 * The player's display name: a single string, kept in localStorage only (no
 * accounts, no backend — see nameGate.js for the modal that collects it).
 */
const STORAGE_KEY = "dice.userName";
export const MAX_NAME_LENGTH = 20;

/** Trims and caps length; never returns null/undefined (empty string at worst). */
export function sanitizeName(raw) {
  return (raw ?? "").trim().slice(0, MAX_NAME_LENGTH);
}

/** A name is valid once sanitized it's non-empty — rejects "" and "   ". */
export function isValidName(raw) {
  return sanitizeName(raw).length > 0;
}

/** The stored name, or null if none is saved yet (first run, or storage unavailable). */
export function getStoredName() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    // Private-mode/disabled storage: treat as "nothing saved" so the app
    // still works for the session (the modal will just reappear next load).
    return null;
  }
}

const listeners = new Set();

/** Sanitizes, persists, and returns the clean name; notifies subscribers. */
export function setStoredName(raw) {
  const clean = sanitizeName(raw);
  try {
    localStorage.setItem(STORAGE_KEY, clean);
  } catch {
    /* non-fatal: the name still works for this session via the in-memory notify below */
  }
  listeners.forEach((callback) => callback(clean));
  return clean;
}

/** Fires with the new name whenever it's (re)set. Returns an unsubscribe function. */
export function subscribeName(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
