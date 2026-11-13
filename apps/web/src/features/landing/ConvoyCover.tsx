import { useEffect, useRef, useState } from "react";
import { useEventStage2Image } from "../events/stage-2-queries.js";
import { eventStage2Content } from "../events/stage-2-transport.js";

export function ConvoyCover({ id, title }: { id: string; title: string }) {
  const slot = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);
  const [decoded, setDecoded] = useState<{ image: Blob; url: string }>();
  const { data: image } = useEventStage2Image(eventStage2Content.publicCover(id), inView);

  useEffect(() => {
    const element = slot.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setInView(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!image) return;
    let url: string | null = URL.createObjectURL(image);
    const preview = new Image();
    preview.src = url;
    const release = () => {
      if (url) URL.revokeObjectURL(url);
      url = null;
    };
    void preview.decode().then(() => {
      if (url) setDecoded({ image, url });
    }, release);
    return release;
  }, [image]);

  return (
    <span className="landing-convoy-cover" ref={slot}>
      {decoded && decoded.image === image && <img src={decoded.url} alt={title} />}
    </span>
  );
}
