import { isTouchDevice } from "../responsive.js";
import { getStoredName, subscribeName } from "../state/userName.js";
import { initNameGate, openNameModal } from "../ui/nameGate.js";

// Idempotent (guarded internally) — called here too, rather than relying on
// main.js's own call having already run first. Sibling `type="module"`
// scripts are NOT guaranteed to finish evaluating in document order once a
// top-level await is involved (main.js has one, waiting on Rapier's WASM),
// so this module can't assume the modal's form/submit listener is wired by
// the time openNameModal() below might get used.
initNameGate();

// The MOBILE hand surface used to live here: a floating widget with its own
// renderer, scene, camera and rAF loop, plus two rotation sliders, rendering
// a purely decorative hand independent of the dice board.
//
// That is all gone. The hand now lives in the MAIN dice scene on touch too
// (see main.js / HandCursor.js's anchored mode) — it had to, because dice are
// parented into its palm and a die cannot cross into a separate
// renderer/scene. Dropping this widget also removed a whole second WebGL
// context and rAF loop from mobile, which is pure win for the frame budget.
//
// What remains is the one piece that was never about the hand rig: the
// tappable name chip. It's kept in its own module (rather than folded into
// main.js) so it still has no dependency on main.js finishing its own
// Rapier-gated startup — see the top-level-await note above.

const widget = document.getElementById("hand-widget");
const nameLabel = document.getElementById("hand-name-label-mobile");

if (nameLabel) {
  nameLabel.textContent = getStoredName() || "";
  subscribeName((name) => {
    nameLabel.textContent = name || "";
  });
  nameLabel.addEventListener("click", () => openNameModal());
}

// Desktop shows the name riding along with the hand cursor instead (main.js's
// updateHandNameLabel), so this chip is touch-only.
if (widget && !isTouchDevice()) widget.style.display = "none";
