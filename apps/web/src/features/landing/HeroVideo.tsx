import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createHeroLoop, type HeroLoop, type LoopLayer, loopStart } from "./hero-loop.js";
import { heroVideo854, heroVideo1280 } from "./media.js";

const reducedQuery = "(prefers-reduced-motion: reduce)";
function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(reducedQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const reducedSnapshot = () => window.matchMedia(reducedQuery).matches;

function layer(video: HTMLVideoElement): LoopLayer {
  return {
    get currentTime() {
      return video.currentTime;
    },
    get duration() {
      return video.duration;
    },
    get readyState() {
      return video.readyState;
    },
    seek(time) {
      try {
        video.currentTime = time;
      } catch {
        // Older engines reject a seek before metadata; the #t=1 fragment still starts at 1 s.
      }
    },
    play: () => video.play(),
    pause: () => video.pause(),
    setActive(active) {
      video.dataset.active = String(active);
    },
  };
}
function release(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

/** Two stacked, always-muted layers that stay transparent until the video really plays. */
function HeroLayers({ paused, onFailure }: { paused: boolean; onFailure: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLVideoElement>(null);
  const secondRef = useRef<HTMLVideoElement>(null);
  const controller = useRef<HeroLoop | null>(null);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const [onScreen, setOnScreen] = useState(true);
  const running = !paused && visible && onScreen;
  useEffect(() => {
    const first = firstRef.current;
    const second = secondRef.current;
    if (!first || !second) return;
    // Chosen once per mount: resizing never swaps the source in the middle of the loop.
    const narrow = window.matchMedia("(max-width: 760px)").matches;
    const url = `${narrow ? heroVideo854 : heroVideo1280}#t=1`;
    for (const video of [first, second]) {
      // iOS needs these before the source is assigned to allow silent inline autoplay.
      video.muted = true;
      video.defaultMuted = true;
      video.setAttribute("muted", "");
      video.playsInline = true;
    }
    const loop = createHeroLoop(layer(first), layer(second), onFailure);
    controller.current = loop;
    let revealed = false;
    const onMetadata = () => {
      if (first.currentTime < loopStart) first.currentTime = loopStart;
    };
    const onPlaying = () => {
      if (revealed) return;
      revealed = true;
      first.dataset.active = "true";
      // The second layer only downloads once the first one actually plays.
      second.src = url;
    };
    first.addEventListener("loadedmetadata", onMetadata);
    first.addEventListener("playing", onPlaying);
    first.addEventListener("error", onFailure);
    first.src = url;
    return () => {
      controller.current = null;
      first.removeEventListener("loadedmetadata", onMetadata);
      first.removeEventListener("playing", onPlaying);
      first.removeEventListener("error", onFailure);
      loop.destroy();
      release(first);
      release(second);
    };
  }, [onFailure]);
  useEffect(() => {
    controller.current?.setRunning(running);
  }, [running]);
  useEffect(() => {
    const updateVisible = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisible);
    const node = root.current;
    const observer =
      node && "IntersectionObserver" in window
        ? new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? true))
        : null;
    if (node) observer?.observe(node);
    return () => {
      document.removeEventListener("visibilitychange", updateVisible);
      observer?.disconnect();
    };
  }, []);
  return (
    <div ref={root} className="landing-hero-video">
      {/* biome-ignore lint/a11y/useMediaCaption: silent decorative clip without an audio track; the still carries the alt text. */}
      <video
        ref={firstRef}
        className="landing-hero-layer"
        aria-hidden="true"
        tabIndex={-1}
        loop
        playsInline
        disablePictureInPicture
      />
      {/* biome-ignore lint/a11y/useMediaCaption: silent decorative clip without an audio track; the still carries the alt text. */}
      <video
        ref={secondRef}
        className="landing-hero-layer"
        aria-hidden="true"
        tabIndex={-1}
        loop
        playsInline
        disablePictureInPicture
      />
    </div>
  );
}

/**
 * Client-only progressive video over the prerendered still. It starts after the load event and
 * an idle period, never under reduced motion, and any failure leaves the still in place.
 */
export function HeroVideo({ paused }: { paused: boolean }) {
  const reduced = useSyncExternalStore(subscribeReduced, reducedSnapshot, () => true);
  const [idle, setIdle] = useState(false);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const onFailure = useCallback(() => setFailed(true), []);
  // Derived during render: pausing before the start must not trigger the download at all.
  if (started && (reduced || failed)) setStarted(false);
  else if (!started && idle && !reduced && !failed && !paused) setStarted(true);
  useEffect(() => {
    let idleHandle: number | undefined;
    let timer: number | undefined;
    const schedule = () => {
      if (typeof window.requestIdleCallback === "function")
        idleHandle = window.requestIdleCallback(() => setIdle(true), { timeout: 1500 });
      else timer = window.setTimeout(() => setIdle(true), 300);
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
    return () => {
      window.removeEventListener("load", schedule);
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
  return started && !reduced && !failed ? (
    <HeroLayers paused={paused} onFailure={onFailure} />
  ) : null;
}
