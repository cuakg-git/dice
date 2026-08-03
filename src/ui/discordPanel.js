import {
  analyzeInput,
  getState,
  saveWebhookUrl,
  markConnected,
  clearWebhook,
  subscribe,
  sendTestMessage,
} from "../state/discordWebhook.js";

// Module-level (not per-instance) open-state, mirroring nameGate.js's
// isModalOpen()/subscribeModalOpen() exactly — main.js combines both to
// decide when the native cursor should be visible and the 3D hand hidden
// (see main.js's anyModalOpen()). createDiscordPanel() is only ever
// instantiated once, so a singleton here costs nothing.
let modalOpen = false;
const openListeners = new Set();
function setModalOpen(next) {
  if (modalOpen === next) return;
  modalOpen = next;
  openListeners.forEach((callback) => callback(modalOpen));
}
export function isDiscordModalOpen() {
  return modalOpen;
}
export function subscribeDiscordModalOpen(callback) {
  openListeners.add(callback);
  return () => openListeners.delete(callback);
}

/**
 * Wires the Discord webhook config modal (static markup in index.html).
 *
 * The whole flow is one field + one button ("Probar y conectar"): validate →
 * save → send a real test message → report. No channel/server/id fields are
 * ever asked for — only the URL, per the brief.
 *
 * Opening/closing is via the corner #discord-button; the overlay is topmost so
 * it blocks the board underneath just by existing (same pattern as nameGate).
 * The native cursor being visible inside it is now handled centrally in
 * main.js (removing body.hand-cursor-active while ANY modal is open — see
 * that file and style.css), not by this modal's own CSS.
 */
export function createDiscordPanel() {
  const els = {
    button: document.getElementById("discord-button"),
    buttonLabel: document.getElementById("discord-button-label"),
    overlay: document.getElementById("discord-modal-overlay"),
    close: document.getElementById("discord-close"),
    form: document.getElementById("discord-form"),
    input: document.getElementById("discord-url-input"),
    urlError: document.getElementById("discord-url-error"),
    test: document.getElementById("discord-test"),
    disconnect: document.getElementById("discord-disconnect"),
    feedback: document.getElementById("discord-feedback"),
    status: document.getElementById("discord-status"),
    statusText: document.getElementById("discord-status-text"),
    help: document.getElementById("discord-help"),
  };
  if (!els.overlay || !els.form || !els.input) return { destroy() {} };

  // --- small helpers -------------------------------------------------------

  function showUrlError(message) {
    els.urlError.textContent = message;
    els.urlError.hidden = false;
  }
  function clearUrlError() {
    els.urlError.hidden = true;
  }
  function showFeedback(message, kind /* "ok" | "error" | "pending" */) {
    els.feedback.textContent = message;
    els.feedback.dataset.kind = kind;
    els.feedback.hidden = false;
  }
  function clearFeedback() {
    els.feedback.hidden = true;
  }

  /** Reflects the persisted connection state everywhere it's shown. */
  function renderState() {
    const { url, connected } = getState();

    // Corner button: a quiet ✓ once connected.
    els.button.dataset.connected = connected ? "1" : "0";
    if (els.buttonLabel) els.buttonLabel.textContent = connected ? "Discord ✓" : "Discord";

    // In-panel status pill.
    if (connected) {
      els.status.dataset.state = "connected";
      els.statusText.textContent = "Discord conectado ✓";
    } else if (url) {
      els.status.dataset.state = "saved";
      els.statusText.textContent = "Guardado — todavía sin probar";
    } else {
      els.status.dataset.state = "disconnected";
      els.statusText.textContent = "Sin conectar";
    }

    els.disconnect.hidden = !url;
  }

  // --- open / close --------------------------------------------------------

  function open() {
    const { url } = getState();
    if (url && !els.input.value) els.input.value = url; // prefill what's saved
    // First-timers see the steps expanded; returning connected users don't
    // need them in the way.
    els.help.open = !getState().connected;
    clearUrlError();
    clearFeedback();
    renderState();
    els.overlay.hidden = false;
    setModalOpen(true);
    requestAnimationFrame(() => els.input.focus());
  }
  function close() {
    els.overlay.hidden = true;
    setModalOpen(false);
  }

  els.button.addEventListener("click", open);
  els.close.addEventListener("click", close);
  // Click on the dimmed backdrop (not the modal card) closes it.
  els.overlay.addEventListener("click", (event) => {
    if (event.target === els.overlay) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.overlay.hidden) close();
  });

  // --- forgiving input -----------------------------------------------------

  // Re-validate on paste/typing so a wrong paste is flagged immediately, but
  // only surface the error once there's actually something typed (don't nag an
  // empty field). The heavy lifting (trim/newlines/quotes) is in analyzeInput.
  function validateLive() {
    clearFeedback();
    const raw = els.input.value;
    if (raw.trim() === "") {
      clearUrlError();
      return;
    }
    const result = analyzeInput(raw);
    if (result.ok) clearUrlError();
    else showUrlError(result.message);
  }
  els.input.addEventListener("input", validateLive);
  // On paste, wait a tick for the value to land, then normalise the field to
  // the cleaned URL so the user visibly sees the junk removed.
  els.input.addEventListener("paste", () => {
    requestAnimationFrame(() => {
      const result = analyzeInput(els.input.value);
      if (result.ok) {
        els.input.value = result.url; // show the tidied URL
        clearUrlError();
      } else {
        validateLive();
      }
    });
  });

  // --- test & connect (single primary action) ------------------------------

  let testing = false;
  async function testAndConnect(event) {
    event.preventDefault();
    if (testing) return;

    const result = analyzeInput(els.input.value);
    if (!result.ok) {
      showUrlError(result.message);
      els.input.focus();
      return;
    }
    clearUrlError();

    // Save immediately so a valid URL is never lost, even if the test fails.
    els.input.value = result.url;
    saveWebhookUrl(result.url);
    renderState();

    testing = true;
    els.test.disabled = true;
    showFeedback("Enviando un mensaje de prueba…", "pending");

    const outcome = await sendTestMessage(result.url);

    testing = false;
    els.test.disabled = false;

    if (outcome.ok) {
      markConnected(true);
      renderState();
      showFeedback("¡Listo! Revisá tu canal de Discord, deberías ver el mensaje de prueba.", "ok");
    } else {
      markConnected(false);
      renderState();
      // outcome.message is already human and jargon-free (see discordWebhook).
      showFeedback(outcome.message, "error");
    }
  }
  els.form.addEventListener("submit", testAndConnect);

  els.disconnect.addEventListener("click", () => {
    clearWebhook();
    els.input.value = "";
    clearUrlError();
    clearFeedback();
    renderState();
  });

  // Keep the corner button + status in sync if state changes elsewhere.
  const unsubscribe = subscribe(renderState);
  renderState();

  return {
    open,
    destroy() {
      unsubscribe();
    },
  };
}
