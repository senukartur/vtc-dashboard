import { describe, expect, test, vi } from "vitest";
import {
  createHeroLoop,
  fadeCleanupMs,
  type LoopLayer,
  type LoopScheduler,
  loopStart,
} from "../../apps/web/src/features/landing/hero-loop.ts";

type Fake = LoopLayer & {
  currentTime: number;
  duration: number;
  readyState: number;
  active: boolean | undefined;
  calls: string[];
  playResult: () => Promise<void> | undefined;
};
function fakeLayer(name: string): Fake {
  const layer: Fake = {
    currentTime: 0,
    duration: Number.NaN,
    readyState: 0,
    active: undefined,
    calls: [],
    playResult: () => Promise.resolve(),
    seek(time) {
      layer.calls.push(`${name}.seek(${time})`);
      layer.currentTime = time;
    },
    play() {
      layer.calls.push(`${name}.play`);
      return layer.playResult();
    },
    pause() {
      layer.calls.push(`${name}.pause`);
    },
    setActive(active) {
      layer.active = active;
    },
  };
  return layer;
}
function fakeScheduler() {
  let id = 0;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { callback: () => void; ms: number }>();
  const scheduler: LoopScheduler = {
    requestFrame(callback) {
      frames.set(++id, callback);
      return id;
    },
    cancelFrame(frame) {
      frames.delete(frame);
    },
    setTimer(callback, ms) {
      timers.set(++id, { callback, ms });
      return id;
    },
    clearTimer(timer) {
      timers.delete(timer);
    },
  };
  return {
    scheduler,
    frames,
    timers,
    /** Runs the frames queued so far, like one browser animation frame. */
    frame() {
      const queued = [...frames.entries()];
      frames.clear();
      for (const [, callback] of queued) callback();
    },
    flushTimers() {
      const queued = [...timers.entries()];
      timers.clear();
      for (const [, timer] of queued) timer.callback();
    },
  };
}
function setup() {
  const a = fakeLayer("a"),
    b = fakeLayer("b"),
    clock = fakeScheduler(),
    onFailure = vi.fn(),
    loop = createHeroLoop(a, b, onFailure, clock.scheduler);
  return { a, b, clock, onFailure, loop };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("hero video crossfade loop", () => {
  test("seeks to the start point before the first play and only once", () => {
    const { a, b, loop } = setup();
    loop.setRunning(true);
    expect(a.calls).toEqual([`a.seek(${loopStart})`, "a.play"]);
    expect(b.calls).toEqual([]);
    loop.setRunning(false);
    a.calls.length = 0;
    loop.setRunning(true);
    expect(a.calls).toEqual(["a.play"]);
  });

  test("ignores unknown durations and swaps only within the last 0.9 s", () => {
    const { a, b, clock, loop } = setup();
    loop.setRunning(true);
    b.readyState = 4;
    a.currentTime = 7.5;
    clock.frame();
    expect(b.calls).toEqual([]);
    a.duration = 7.917;
    a.currentTime = 7.0;
    clock.frame();
    expect(b.calls).toEqual([]);
    a.currentTime = 7.02;
    clock.frame();
    expect(b.calls).toEqual([`b.seek(${loopStart})`, "b.play"]);
    expect(b.active).toBe(true);
    expect(a.active).toBe(false);
  });

  test("does not swap twice during a fade and parks the old layer afterwards", () => {
    const { a, b, clock, loop } = setup();
    loop.setRunning(true);
    a.duration = b.duration = 7.917;
    b.readyState = 4;
    a.currentTime = 7.5;
    clock.frame();
    b.currentTime = 7.6;
    clock.frame();
    clock.frame();
    expect(b.calls.filter((call) => call === "b.play")).toHaveLength(1);
    expect([...clock.timers.values()].map((timer) => timer.ms)).toEqual([fadeCleanupMs]);
    a.calls.length = 0;
    clock.flushTimers();
    expect(a.calls).toEqual(["a.pause", `a.seek(${loopStart})`]);
    // The next fade goes back from b to the parked a.
    a.readyState = 4;
    b.currentTime = 7.5;
    clock.frame();
    expect(a.active).toBe(true);
    expect(b.active).toBe(false);
  });

  test("restarts the current layer when the other one cannot show a frame yet", () => {
    const { a, b, clock, loop } = setup();
    loop.setRunning(true);
    a.duration = 7.917;
    a.currentTime = 7.5;
    b.readyState = 1;
    a.calls.length = 0;
    clock.frame();
    expect(a.calls).toEqual([`a.seek(${loopStart})`]);
    expect(b.calls).toEqual([]);
    expect(a.active).toBeUndefined();
  });

  test("pausing stops frames, settles a running fade and pauses both layers", () => {
    const { a, b, clock, loop } = setup();
    loop.setRunning(true);
    a.duration = 7.917;
    a.currentTime = 7.5;
    b.readyState = 4;
    clock.frame();
    a.calls.length = 0;
    b.calls.length = 0;
    loop.setRunning(false);
    expect(clock.frames.size).toBe(0);
    expect(clock.timers.size).toBe(0);
    expect(a.calls).toEqual(["a.pause", `a.seek(${loopStart})`, "a.pause"]);
    expect(b.calls).toEqual(["b.pause"]);
    loop.setRunning(true);
    expect(b.calls).toEqual(["b.pause", "b.play"]);
    expect(clock.frames.size).toBe(1);
  });

  test("a rejected play fails once, but an interrupted play is ordinary pausing", async () => {
    const interrupted = setup();
    interrupted.a.playResult = () =>
      Promise.reject(Object.assign(new Error("interrupted"), { name: "AbortError" }));
    interrupted.loop.setRunning(true);
    await settle();
    expect(interrupted.onFailure).not.toHaveBeenCalled();

    const blocked = setup();
    blocked.a.playResult = () =>
      Promise.reject(Object.assign(new Error("low power"), { name: "NotAllowedError" }));
    blocked.loop.setRunning(true);
    await settle();
    expect(blocked.onFailure).toHaveBeenCalledTimes(1);
    expect(blocked.clock.frames.size).toBe(0);
    blocked.loop.setRunning(true);
    expect(blocked.a.calls.filter((call) => call === "a.play")).toHaveLength(1);
  });

  test("destroy is idempotent and leaves nothing scheduled", () => {
    const { a, b, clock, loop, onFailure } = setup();
    loop.setRunning(true);
    a.duration = 7.917;
    a.currentTime = 7.5;
    b.readyState = 4;
    clock.frame();
    loop.destroy();
    loop.destroy();
    expect(clock.frames.size).toBe(0);
    expect(clock.timers.size).toBe(0);
    a.calls.length = 0;
    b.calls.length = 0;
    loop.setRunning(true);
    expect([...a.calls, ...b.calls]).toEqual([]);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
