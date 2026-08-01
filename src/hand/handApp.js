import * as THREE from "three";
import { createHand } from "./Hand.js";
import { HAND_CONFIG, restRotationDegrees } from "./handConfig.js";
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

// The MOBILE hand surface: a floating widget with its own renderer, scene,
// camera and rAF loop, fully independent from the dice board's pipeline.
// Deliberately NOT imported from main.js so neither module can affect the
// other's startup (main.js awaits Rapier WASM; the hand needs none of it).
//
// On pointer devices the hand instead becomes the cursor inside the main
// scene (see HandCursor.js), so this widget hides itself and never starts
// its render loop — the two surfaces never run at once. The split is on
// input type, matching main.js's handCursorEnabled.

const widget = document.getElementById("hand-widget");
const container = document.getElementById("hand-canvas");
const rotYSlider = document.getElementById("hand-rot-y");
const rotXSlider = document.getElementById("hand-rot-x");
const nameLabel = document.getElementById("hand-name-label-mobile");

// The name label just below the hand: reflects whatever is stored (kept in
// sync if it's ever changed — see the click handler below), and tapping it
// reopens the same modal main.js wires on desktop (nameGate.js is a small,
// side-effect-free module shared by both entry scripts, so importing it here
// doesn't create any dependency on main.js itself finishing its own setup —
// see the top-level-await note above for why that separation matters).
if (nameLabel) {
  nameLabel.textContent = getStoredName() || "";
  subscribeName((name) => {
    nameLabel.textContent = name || "";
  });
  nameLabel.addEventListener("click", () => openNameModal());
}

const scene = new THREE.Scene(); // no background => transparent over the app

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
camera.position.set(0, 0.55, 6.2);
camera.lookAt(0, 0.45, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

// Toon shading only needs a key + soft fill; steps come from the gradient map.
scene.add(new THREE.AmbientLight(0xffffff, 1.05));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
keyLight.position.set(2.5, 4, 5);
scene.add(keyLight);

const hand = createHand({ outlineWidth: HAND_CONFIG.outlineWidth });
hand.root.position.y = -0.35;
scene.add(hand.root);

// Console affordance (per spec): poke the rig directly, e.g.
// window.hand.setFingerCurl(1, 1) closes the index finger into a fist curl.
// _view is for inspection tooling (force a render, tweak the camera).
window.hand = hand;
window.hand._view = { renderer, scene, camera };

function resize() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
new ResizeObserver(resize).observe(container);

function applySliderRotation() {
  hand.root.rotation.y = THREE.MathUtils.degToRad(Number(rotYSlider.value));
  hand.root.rotation.x = THREE.MathUtils.degToRad(Number(rotXSlider.value));
}
rotYSlider.addEventListener("input", applySliderRotation);
rotXSlider.addEventListener("input", applySliderRotation);

// Sliders start at the shared rest orientation (set from JS, not markup, so
// the sliders and the hand can't drift apart from the config).
const rest = restRotationDegrees();
rotXSlider.value = String(Math.round(rest.x));
rotYSlider.value = String(Math.round(rest.y));
applySliderRotation();

const idle = HAND_CONFIG.idle;

function frame(time) {
  const t = time / 1000;
  for (let i = 0; i < hand.fingerCount; i++) {
    hand.setFingerCurl(i, idle.base + idle.amp * Math.sin(2 * Math.PI * idle.freqHz * t + i * idle.phaseStep));
  }
  renderer.render(scene, camera);
}

if (isTouchDevice()) {
  resize();
  renderer.setAnimationLoop(frame);
} else {
  widget.style.display = "none";
}
