import * as THREE from "three";

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const TAP_MOVE_THRESHOLD_PX = 10;
const HISTORY_SIZE = 6; // last ~6 pointer samples used to estimate throw velocity
const VELOCITY_WINDOW_MS = 100; // look back this far to compute release velocity

/**
 * Wires up pointer interaction (mouse + touch + pen unified via Pointer
 * Events). Three modes, chosen live per event by `getMode()`:
 *
 *  - "drag": tap-to-act, plus drag with a pointer-position history for throw
 *    velocity. The original mobile model, kept for any surface that wants
 *    direct dice dragging.
 *  - "handTouch" (mobile): the hand is PARKED and dice travel to it. A tap is
 *    routed to main via onTouchTap (tap a loose die -> send it to the hand;
 *    tap the hand -> take one back out). A press that starts ON the hand
 *    (isOverHand) and then passes the movement threshold becomes the throw
 *    drag: the hand follows the finger via onPointerWorldMove, and the release
 *    is reported by onHandDragEnd. Throw velocity is NOT computed here — the
 *    hand measures its own, exactly as in "hand" mode, so both surfaces feed
 *    the wind-up/follow-through/launch effects from one source.
 *  - "hand" (desktop hand cursor): the pointer steers the hand (via
 *    onPointerWorldMove). The hand carries a handful (0..N dice). On
 *    pointerDOWN, a die not already in the hand is ADDED via onHandPress
 *    (which returns true if it added) — so a press-and-drag off a die picks
 *    it up from the very first frame. pointerUP then reports the gesture to
 *    onHandRelease with { record (what was under the cursor at press), added
 *    (did the press add it), dragged (did it move past the threshold) } and
 *    main resolves the outcome: drag => throw all; click => stay / drop all /
 *    nothing. The secondary (right) button is a separate remove-one gesture
 *    (onHandSecondaryPress), needed because the handful rides at the cursor so
 *    a left-click can't distinguish "take one out" from "drop them all".
 *
 * Decoupled from meaning — main.js decides what a tap/drag/click does and
 * which records are draggable.
 *
 * Callbacks receive `record`s (main maps hitbox meshes -> records via
 * `resolve`). World-space coordinates are on the y=0 plane; under the
 * orthographic top-down camera the pick ray is vertical, so the ray origin's
 * x/z already is the world point under the pointer.
 */
export function setupInteraction({
  renderer,
  camera,
  getTargets,
  resolve,
  canDrag,
  getMode = () => "drag",
  onPointerWorldMove,
  onHandPress,
  onHandRelease,
  onHandSecondaryPress,
  onHandHoverChange,
  isOverHand,
  onHandDragStart,
  onHandDragEnd,
  onHandDragCancel,
  onTouchTap,
  onTap,
  onDragStart,
  onDragMove,
  onDragEnd,
  onHoverChange,
  onPressChange,
}) {
  const dom = renderer.domElement;
  let hovered = null;
  let active = null; // { id, startX, startY, pointerType, record, dragging, history }

  const worldPoint = new THREE.Vector3();

  function updateRay(clientX, clientY) {
    const rect = dom.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  function pick(clientX, clientY) {
    updateRay(clientX, clientY);
    const hits = raycaster.intersectObjects(getTargets(), false);
    if (hits.length === 0) return null;
    if (hits.length === 1) return hits[0].object;

    // Enlarged touch hitboxes can overlap between adjacent dice. "Closest to
    // camera" can't disambiguate (all dice sit at ~the same height under the
    // top-down camera) — pick whichever hitbox center is nearest the world
    // point under the pointer (the vertical ray's origin x/z).
    const tapX = raycaster.ray.origin.x;
    const tapZ = raycaster.ray.origin.z;
    let best = hits[0].object;
    let bestDist = Infinity;
    for (const hit of hits) {
      hit.object.getWorldPosition(worldPoint);
      const d = Math.hypot(worldPoint.x - tapX, worldPoint.z - tapZ);
      if (d < bestDist) {
        bestDist = d;
        best = hit.object;
      }
    }
    return best;
  }

  function worldAt(clientX, clientY) {
    updateRay(clientX, clientY);
    return { x: raycaster.ray.origin.x, z: raycaster.ray.origin.z };
  }

  /** Estimates release velocity (world units/s) from the pointer history. */
  function computeVelocity(history) {
    if (history.length < 2) return { x: 0, z: 0 };
    const newest = history[history.length - 1];
    let oldest = history[0];
    for (let i = history.length - 1; i >= 0; i--) {
      if (newest.t - history[i].t <= VELOCITY_WINDOW_MS) oldest = history[i];
      else break;
    }
    const dt = (newest.t - oldest.t) / 1000;
    if (dt <= 0) return { x: 0, z: 0 };
    return { x: (newest.x - oldest.x) / dt, z: (newest.z - oldest.z) / dt };
  }

  function clearHover() {
    if (hovered) {
      onHoverChange?.(hovered, null);
      hovered = null;
    }
    // Hand mode: the pointer left the canvas, so nothing is hovered — drop the
    // hand's hover feedback too (no-op in drag mode, callback is undefined).
    onHandHoverChange?.(null);
    dom.style.cursor = "default";
  }

  dom.addEventListener("pointerdown", (event) => {
    const hitObject = pick(event.clientX, event.clientY);
    const record = hitObject ? resolve(hitObject) : null;
    active = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pointerType: event.pointerType,
      record,
      dragging: false,
      history: [],
    };
    if (getMode() === "hand") {
      // Right button (or two-finger/ctrl secondary) takes ONE die back out of
      // the hand. It needs its own button because the handful rides at the
      // cursor: a left-click there can't tell "take one out" apart from "drop
      // them all" (both land on the cluster), so left-click is drop-all and
      // the secondary button is remove-one.
      if (event.button === 2) {
        onHandSecondaryPress?.();
        active = null; // not a normal add/drop gesture; ignore its pointerup
        return;
      }
      if (event.button !== 0) {
        active = null; // ignore middle/other buttons entirely
        return;
      }
      // A die that isn't already in the hand is ADDED right here, from this
      // same raycast — so a press-and-drag off a die picks it up from the
      // first frame. onHandPress reports whether it added (true) so pointerup
      // (below) can tell that "already-added-this-gesture" case apart from a
      // click on empty space. The record + drag flag are stashed for
      // onHandRelease to resolve the rest at pointerup.
      active.handAdded = onHandPress?.(record) === true;
      active.handDownRecord = record;
      active.handDragging = false;
      return;
    }
    if (getMode() === "handTouch") {
      // Touch hand mode: nothing is decided on press. Only a press that
      // STARTS on the hand (or the handful it's carrying) can become the
      // throw drag — a press that starts on a die is a tap candidate, which
      // is what keeps "tap a die to send it" and "drag the hand to roll"
      // from ever competing for the same gesture.
      const w = worldAt(event.clientX, event.clientY);
      active.handGrab = isOverHand?.(w.x, w.z) === true;
      active.handDragging = false;
      return;
    }
    if (event.pointerType !== "mouse" && record) onPressChange?.(record, true);
  });

  dom.addEventListener("pointermove", (event) => {
    if (getMode() === "handTouch") {
      if (!active || active.id !== event.pointerId) return;
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      // Same threshold that separates tap from drag everywhere else, so the
      // two gestures are classified consistently across modes.
      if (!active.handDragging && active.handGrab && Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD_PX) {
        active.handDragging = true;
        // Keep receiving moves if the finger slides off the canvas mid-throw.
        try {
          dom.setPointerCapture(event.pointerId);
        } catch {
          /* non-fatal: capture is a nicety, not required for the drag */
        }
        onHandDragStart?.();
      }
      if (active.handDragging) {
        const w = worldAt(event.clientX, event.clientY);
        onPointerWorldMove?.(w.x, w.z);
      }
      return;
    }

    if (getMode() === "hand") {
      // The pointer only steers the hand; the hand is what touches dice.
      const w = worldAt(event.clientX, event.clientY);
      onPointerWorldMove?.(w.x, w.z);
      // Hover feedback reuses the very same picker the grab uses, so "hovering
      // a grabbable die" is exactly the state a click here would act on — no
      // separate detection. It's read-only: the pick doesn't change anything.
      const hoverHit = pick(event.clientX, event.clientY);
      onHandHoverChange?.(hoverHit ? resolve(hoverHit) : null);
      // Reuses the same tap/drag threshold as "drag" mode below, just to
      // classify THIS gesture (for the pointerup branch), not to move
      // anything itself — the hand already follows the pointer unconditionally.
      if (active && active.id === event.pointerId && !active.handDragging) {
        const dx = event.clientX - active.startX;
        const dy = event.clientY - active.startY;
        if (Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD_PX) active.handDragging = true;
      }
      return;
    }

    if (active && active.id === event.pointerId) {
      if (!active.record) return;
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      const moved = Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD_PX;

      if (!active.dragging && moved && canDrag(active.record)) {
        active.dragging = true;
        if (active.pointerType !== "mouse") onPressChange?.(active.record, false);
        // Keep receiving moves if the finger/cursor leaves the canvas. Can
        // throw (e.g. the pointer was already released) — never let that
        // abort starting the drag.
        try {
          dom.setPointerCapture(event.pointerId);
        } catch {
          /* non-fatal: capture is a nicety, not required for the drag */
        }
        onDragStart?.(active.record);
      }

      if (active.dragging) {
        const w = worldAt(event.clientX, event.clientY);
        active.history.push({ x: w.x, z: w.z, t: event.timeStamp });
        if (active.history.length > HISTORY_SIZE) active.history.shift();
        onDragMove?.(active.record, w.x, w.z);
      }
      return;
    }

    if (event.pointerType !== "mouse") return; // no hover on touch/pen
    const hitObject = pick(event.clientX, event.clientY);
    const record = hitObject ? resolve(hitObject) : null;
    if (record !== hovered) {
      onHoverChange?.(hovered, record);
      hovered = record;
    }
    dom.style.cursor = record ? "pointer" : "default";
  });

  function endPointer(event) {
    if (!active || active.id !== event.pointerId) return;
    const finished = active;
    active = null;

    // Hand mode: pointerdown may already have ADDED a die; pointerup now
    // resolves the rest of the gesture (drag => throw all, click => add /
    // remove-one / drop-all / nothing, decided in main from these flags).
    if (getMode() === "hand") {
      onHandRelease?.({
        record: finished.handDownRecord,
        added: finished.handAdded,
        dragged: finished.handDragging,
      });
      return;
    }

    // Touch hand mode: a drag off the hand throws the handful; anything that
    // never passed the movement threshold is a tap, resolved by main from the
    // record (if any) under the release point.
    if (getMode() === "handTouch") {
      if (finished.handDragging) {
        onHandDragEnd?.();
        return;
      }
      const tapDx = event.clientX - finished.startX;
      const tapDy = event.clientY - finished.startY;
      if (Math.hypot(tapDx, tapDy) <= TAP_MOVE_THRESHOLD_PX) {
        const w = worldAt(event.clientX, event.clientY);
        onTouchTap?.(finished.record, w.x, w.z);
      }
      return;
    }

    if (finished.pointerType !== "mouse" && finished.record) onPressChange?.(finished.record, false);

    if (finished.dragging) {
      const w = worldAt(event.clientX, event.clientY);
      const velocity = computeVelocity(finished.history);
      onDragEnd?.(finished.record, { x: w.x, z: w.z, velX: velocity.x, velZ: velocity.z });
      return;
    }

    // A genuine tap/click (no meaningful movement) — acts only on the record.
    const dx = event.clientX - finished.startX;
    const dy = event.clientY - finished.startY;
    if (Math.hypot(dx, dy) <= TAP_MOVE_THRESHOLD_PX && finished.record) {
      onTap?.(finished.record);
    }
  }

  dom.addEventListener("pointerup", endPointer);
  dom.addEventListener("pointercancel", (event) => {
    if (!active || active.id !== event.pointerId) return;
    const finished = active;
    active = null;
    // A cancelled hand drag must NOT throw (the gesture never completed) —
    // the hand just stops following and eases home still holding its dice.
    if (getMode() === "handTouch") {
      if (finished.handDragging) onHandDragCancel?.();
      return;
    }
    if (finished.pointerType !== "mouse" && finished.record) onPressChange?.(finished.record, false);
    // Treat a cancelled drag as "dropped in place" so main can return it home.
    if (finished.dragging) {
      const last = finished.history[finished.history.length - 1] || { x: 0, z: 0 };
      onDragEnd?.(finished.record, { x: last.x, z: last.z, velX: 0, velZ: 0, cancelled: true });
    }
  });

  // Right-click is the remove-one gesture in hand mode, so keep the browser
  // context menu from stealing it. Only in hand mode — touch/drag mode never
  // uses the secondary button and shouldn't have its long-press menu blocked.
  dom.addEventListener("contextmenu", (event) => {
    if (getMode() === "hand") event.preventDefault();
  });

  dom.addEventListener("pointerleave", clearHover);

  // Hand mode: resync the hand to the pointer's actual position the instant
  // it re-enters the window, rather than waiting for the next pointermove
  // (which only fires once the pointer actually moves again) — otherwise the
  // hand would sit frozen at wherever it was before the pointer left.
  // `document` (not `dom`) so this catches re-entry through any window edge,
  // not just back onto the canvas specifically; pointerenter's clientX/Y is
  // already the position at the moment of entry, so there's no jump-then-snap.
  document.addEventListener("pointerenter", (event) => {
    if (getMode() !== "hand") return;
    const w = worldAt(event.clientX, event.clientY);
    onPointerWorldMove?.(w.x, w.z);
  });
}
