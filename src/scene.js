import * as THREE from "three";

const CAMERA_HEIGHT = 30;

/**
 * Sets up the renderer/camera/scene/lights for a pure top-down ("zenithal")
 * view of a world-space rectangle. Kept independent from dice/table/sidebar
 * layout so those can change freely — callers describe what to frame via
 * setViewTarget() and this handles fitting it to the viewport on any aspect
 * ratio.
 */
export function createScene(container, { antialias = true } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef1f5);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  // Looking straight down (target directly below the camera) is a
  // degenerate case for the default up=(0,1,0): forward and up would be
  // parallel. Giving the camera an explicit up hint before lookAt keeps the
  // orientation well-defined and deterministic (no roll ambiguity).
  camera.up.set(0, 0, -1);

  const renderer = new THREE.WebGLRenderer({ antialias });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambientLight);

  // Directional lights come in from the side/low angle rather than
  // straight down, so faces still pick up visible shading under the
  // zenithal camera instead of reading as flat silhouettes.
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
  keyLight.position.set(12, 16, 7);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(-10, 11, -9);
  scene.add(fillLight);

  let viewTarget = { width: 2, depth: 2, centerX: 0, centerZ: 0 };

  function applyView() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    const aspect = width / height;

    // Contain-fit with NO padding: when the layout builds its world rect at
    // the viewport's own aspect ratio (see main.js rebuildLayout), this fit
    // is exact and the world content covers 100% of the canvas — any extra
    // here would show as letterbox bands of scene background.
    let viewWidth = viewTarget.width;
    let viewHeight = viewTarget.depth;
    if (viewWidth / viewHeight > aspect) {
      viewHeight = viewWidth / aspect;
    } else {
      viewWidth = viewHeight * aspect;
    }

    camera.left = -viewWidth / 2;
    camera.right = viewWidth / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.position.set(viewTarget.centerX, CAMERA_HEIGHT, viewTarget.centerZ);
    camera.lookAt(viewTarget.centerX, 0, viewTarget.centerZ);
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
    resizeListeners.forEach((cb) => cb());
  }

  /** Describes the world-space rectangle (in the y=0 plane) to frame. */
  function setViewTarget(target) {
    viewTarget = target;
    applyView();
  }

  const resizeListeners = new Set();
  // The container's real size isn't known until the stylesheet/grid layout
  // has applied, which can happen after this module script runs — a plain
  // window "resize" listener misses that initial settle. ResizeObserver
  // fires immediately with the current size and on every later change.
  new ResizeObserver(applyView).observe(container);
  function onResize(callback) {
    resizeListeners.add(callback);
  }

  const frameListeners = new Set();
  function onFrame(callback) {
    frameListeners.add(callback);
  }

  function start() {
    renderer.setAnimationLoop((time) => {
      frameListeners.forEach((cb) => cb(time));
      renderer.render(scene, camera);
    });
  }

  return { scene, camera, renderer, start, onResize, onFrame, setViewTarget };
}
