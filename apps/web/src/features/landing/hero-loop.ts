/** Clip position the loop starts from and returns to; the truck is already moving there. */
export const loopStart = 1;
/** Remaining seconds of the clip at which the crossfade to the other layer starts. */
export const fadeLead = 0.9;
/** The outgoing layer is parked after the CSS fade, slightly longer than its 0.9 s transition. */
export const fadeCleanupMs = 960;
/** HTMLMediaElement.HAVE_CURRENT_DATA: a frame is available to show immediately. */
const readyToShow = 2;

/** The parts of a video element the loop drives; unit tests use fakes. */
export interface LoopLayer {
  readonly currentTime: number;
  readonly duration: number;
  readonly readyState: number;
  seek(time: number): void;
  play(): Promise<void> | undefined;
  pause(): void;
  setActive(active: boolean): void;
}
export interface LoopScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  setTimer(callback: () => void, ms: number): number;
  clearTimer(id: number): void;
}
export interface HeroLoop {
  setRunning(running: boolean): void;
  destroy(): void;
}

const browserScheduler: LoopScheduler = {
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (id) => window.cancelAnimationFrame(id),
  setTimer: (callback, ms) => window.setTimeout(callback, ms),
  clearTimer: (id) => window.clearTimeout(id),
};

/**
 * Crossfades two stacked layers of the same clip near its end: the camera moves during the
 * clip, so a plain loop would jump. Framework-free so the timing rules stay unit-testable.
 */
export function createHeroLoop(
  first: LoopLayer,
  second: LoopLayer,
  onFailure: () => void,
  scheduler: LoopScheduler = browserScheduler,
): HeroLoop {
  let current = first;
  let next = second;
  let running = false;
  let started = false;
  let destroyed = false;
  let frame: number | undefined;
  let swap: { timer: number; layer: LoopLayer } | undefined;

  function fail() {
    if (destroyed) return;
    destroy();
    onFailure();
  }
  function play(layer: LoopLayer) {
    try {
      layer.play()?.catch((error: unknown) => {
        // A pause() interrupting the play() promise is ordinary pausing, not a failure.
        if ((error as { name?: unknown } | null)?.name !== "AbortError") fail();
      });
    } catch {
      fail();
    }
  }
  function settleSwap() {
    if (!swap) return;
    scheduler.clearTimer(swap.timer);
    swap.layer.pause();
    swap.layer.seek(loopStart);
    swap = undefined;
  }
  function tick() {
    frame = scheduler.requestFrame(tick);
    if (swap) return;
    const { duration } = current;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (duration - current.currentTime >= fadeLead) return;
    if (next.readyState < readyToShow) {
      // A jump is better than a black frame when the other layer cannot show a picture yet.
      current.seek(loopStart);
      return;
    }
    const old = current;
    current = next;
    next = old;
    current.seek(loopStart);
    play(current);
    current.setActive(true);
    old.setActive(false);
    swap = {
      layer: old,
      timer: scheduler.setTimer(() => {
        old.pause();
        old.seek(loopStart);
        swap = undefined;
      }, fadeCleanupMs),
    };
  }
  function cancelFrame() {
    if (frame === undefined) return;
    scheduler.cancelFrame(frame);
    frame = undefined;
  }
  function setRunning(value: boolean) {
    if (destroyed || value === running) return;
    running = value;
    if (value) {
      if (!started) {
        started = true;
        if (current.currentTime < loopStart) current.seek(loopStart);
      }
      play(current);
      frame = scheduler.requestFrame(tick);
    } else {
      cancelFrame();
      settleSwap();
      first.pause();
      second.pause();
    }
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    running = false;
    cancelFrame();
    if (swap) scheduler.clearTimer(swap.timer);
    swap = undefined;
    first.pause();
    second.pause();
  }
  return { setRunning, destroy };
}
