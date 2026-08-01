import { getStoredName, setStoredName, isValidName } from "../state/userName.js";

/**
 * Wires the "what's your name" modal (static markup in index.html) and
 * tracks whether it's open, so main.js can gate the desktop hand-cursor
 * (hidden while the modal is up — see the module doc below) without this
 * module needing to know anything about the 3D scene.
 *
 * Blocking interaction with the app underneath is NOT this module's job: the
 * overlay is a `position: fixed` element covering the whole viewport with
 * default (auto) pointer-events, so on both desktop and mobile it physically
 * intercepts every click/tap before it can reach the canvas underneath —
 * no separate "is the app blocked" flag needed anywhere else.
 *
 * The native cursor reappearing over the modal is likewise handled entirely
 * in CSS (`#name-modal-overlay` and its children force `cursor: auto`,
 * overriding the `cursor: none` the rest of the page gets from
 * `html.hand-cursor-mode`) — this module only needs to hide the 3D hand
 * itself, which main.js does by reacting to subscribeModalOpen().
 */

let wired = false;
let open = false;
const openListeners = new Set();

function setOpen(next) {
  if (open === next) return;
  open = next;
  openListeners.forEach((callback) => callback(open));
}

export function isModalOpen() {
  return open;
}

/** Fires with the new open/closed state on every change. Returns an unsubscribe function. */
export function subscribeModalOpen(callback) {
  openListeners.add(callback);
  return () => openListeners.delete(callback);
}

/**
 * Opens the modal to CHANGE the existing name (e.g. tapping the name label).
 * Pre-fills the input with the current name — confirming without editing it
 * is a no-op rename, which doubles as a lightweight "cancel".
 */
export function openNameModal() {
  const overlay = document.getElementById("name-modal-overlay");
  const input = document.getElementById("name-modal-input");
  if (!overlay || !input) return;

  input.value = getStoredName() || "";
  overlay.hidden = false;
  setOpen(true);
  // Focus after the overlay is actually shown/painted, so it reliably takes
  // focus, with the caret at the end of any pre-filled text.
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function closeNameModal() {
  const overlay = document.getElementById("name-modal-overlay");
  if (overlay) overlay.hidden = true;
  setOpen(false);
}

/**
 * Wires the modal's DOM once (safe to call more than once — only the first
 * call does anything). Shows it immediately if no name is stored yet.
 * Call this as early as possible so the modal appears without waiting on
 * anything else the app needs to load (physics, etc).
 */
export function initNameGate() {
  if (wired) return;
  wired = true;

  const overlay = document.getElementById("name-modal-overlay");
  const form = document.getElementById("name-modal-form");
  const input = document.getElementById("name-modal-input");
  const error = document.getElementById("name-modal-error");
  if (!overlay || !form || !input || !error) return;

  form.addEventListener("submit", (event) => {
    // A <form> submits on Enter from its (only) text input for free — this
    // one listener covers both "click the button" and "press Enter".
    event.preventDefault();
    if (!isValidName(input.value)) {
      error.hidden = false;
      input.focus();
      return;
    }
    error.hidden = true;
    setStoredName(input.value);
    closeNameModal();
  });

  // Clear a rejected-empty-name error as soon as the user starts fixing it,
  // instead of leaving it stuck until the next submit attempt.
  input.addEventListener("input", () => {
    if (!error.hidden) error.hidden = true;
  });

  if (!getStoredName()) {
    overlay.hidden = false;
    setOpen(true);
    requestAnimationFrame(() => input.focus());
  }
}
