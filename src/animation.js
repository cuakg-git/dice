const tweens = new Map();

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/** Zero slope at both ends: smooth accelerate-then-decelerate. */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Smoothly animates an Object3D's position and rotation to a new pose.
 * Re-calling this on a target that's already mid-tween interrupts it
 * cleanly — the new tween starts from wherever it currently is, not from
 * its old start point.
 */
export function animateTransform(target, { toPosition, toQuaternion, duration = 350, onComplete }) {
  tweens.set(target.uuid, {
    target,
    fromPosition: target.position.clone(),
    toPosition: toPosition.clone(),
    fromQuaternion: target.quaternion.clone(),
    toQuaternion: toQuaternion.clone(),
    start: performance.now(),
    duration,
    onComplete,
  });
}

/** Stops any in-flight tween on a target (e.g. when a drag takes it over). */
export function cancelTween(target) {
  tweens.delete(target.uuid);
}

/** Call once per frame (see scene.js's onFrame hook) to advance all tweens. */
export function updateTweens() {
  const now = performance.now();

  for (const [key, tween] of tweens) {
    const t = Math.min((now - tween.start) / tween.duration, 1);
    const eased = easeOutCubic(t);

    tween.target.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
    tween.target.quaternion.slerpQuaternions(tween.fromQuaternion, tween.toQuaternion, eased);

    if (t >= 1) {
      tweens.delete(key);
      tween.onComplete?.();
    }
  }
}
