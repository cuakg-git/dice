/**
 * Groups dice into "rolls" for the log.
 *
 * A roll is one throw GESTURE, however many dice it launched. Callers wrap a
 * gesture in begin()/end(), and whatever actually enters play during it gets
 * enroll()ed; dice a gesture sends home instead never enter physics, so they
 * are simply never enrolled and never logged.
 *
 * A batch reports only once EVERY die in it has come to rest — not one at a
 * time as they stop. Dice already sitting on the board from earlier rolls
 * belong to no open batch, so being knocked around can never re-log them.
 */
export function createThrowBatcher({ isLive, isSettled, describe, onRoll }) {
  let open = null;
  const pending = [];

  return {
    /** Opens a gesture. Anything enrolled until end() is one roll. */
    begin() {
      open = [];
    },

    /** Closes the gesture; an empty one (nothing launched) is discarded. */
    end() {
      if (open && open.length > 0) pending.push(open);
      open = null;
    },

    enroll(record) {
      if (open) open.push(record);
    },

    /**
     * Emits any batch whose dice have all settled. A die that left play
     * mid-flight (grabbed back, sent home) is dropped from its batch, so a
     * batch can never wait forever on a die that will never settle.
     */
    update() {
      for (let i = 0; i < pending.length; i++) {
        const batch = pending[i];

        const live = batch.filter(isLive);
        if (live.length !== batch.length) pending[i] = live;

        if (live.length === 0) {
          pending.splice(i--, 1); // every die left play: nothing to report
          continue;
        }
        if (!live.every(isSettled)) continue;

        onRoll(live.map(describe));
        pending.splice(i--, 1);
      }
    },

    pendingCount: () => pending.length,
  };
}
