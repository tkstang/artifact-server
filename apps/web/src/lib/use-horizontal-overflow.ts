import {type RefObject, useEffect, useState} from "react";

/** Which edges of a horizontal scroller hide content. */
export type HorizontalOverflow = "both" | "end" | "none" | "start";

/**
 * Track whether a horizontally scrolling element hides content at either edge.
 * Change `contentKey` when the element remounts or its children change.
 */
export function useHorizontalOverflow(
  ref: RefObject<HTMLElement | null>,
  contentKey: string,
): HorizontalOverflow {
  const [overflow, setOverflow] = useState<HorizontalOverflow>("none");
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      setOverflow("none");
      return undefined;
    }
    const measure = (): void => {
      const hiddenStart = element.scrollLeft > 1;
      const hiddenEnd = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setOverflow(hiddenStart && hiddenEnd
        ? "both"
        : hiddenStart
          ? "start"
          : hiddenEnd
            ? "end"
            : "none");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", measure, {passive: true});
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [contentKey, ref]);
  return overflow;
}
