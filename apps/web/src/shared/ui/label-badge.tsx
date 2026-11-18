import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Badge } from "./primitives.js";
import "./label-badge.css";

/** Keep catalog labels readable by touch and keyboard without widening their parent. */
export function LabelBadge({
  children,
  ...props
}: Omit<ComponentProps<typeof Badge>, "children"> & { children: string }) {
  const container = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = container.current;
    const badge = element?.firstElementChild;
    if (!element || !badge) return;
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(badge);
    measure();
    return () => observer.disconnect();
  }, []);
  const scrollProps = overflow ? { role: "region", "aria-label": children, tabIndex: 0 } : {};
  return (
    <span ref={container} className="badge-label-scroll" {...scrollProps}>
      <Badge {...props}>{children}</Badge>
    </span>
  );
}
