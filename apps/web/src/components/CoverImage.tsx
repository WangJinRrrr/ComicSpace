import { useCallback, useState, type CSSProperties } from "react";
import { BookOpen } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * Cover image that fades in from a blur once decoded. Renders a neutral
 * placeholder when there is no URL or the image fails to load.
 */
export function CoverImage({
  src,
  className,
  imgClassName,
  eager = false,
  style,
  imgStyle,
}: {
  src?: string | null;
  className?: string;
  imgClassName?: string;
  eager?: boolean;
  style?: CSSProperties;
  imgStyle?: CSSProperties;
}) {
  const [state, setState] = useState<{ src?: string | null; loaded: boolean; failed: boolean }>(
    { src, loaded: false, failed: false },
  );
  // Reset when the URL changes (derived-state pattern, no effect needed).
  if (state.src !== src) setState({ src, loaded: false, failed: false });

  // Cached images are already decoded at mount: show them without the blur-in
  // (also keeps view-transition snapshots from capturing a transparent cover).
  const ref = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) {
      node.style.transition = "none";
      node.dataset.loaded = "true";
      setState((prev) => (prev.loaded ? prev : { ...prev, loaded: true }));
    }
  }, []);

  return (
    <div
      className={cn("relative overflow-hidden bg-surface-3", className)}
      style={style}
    >
      {src && !state.failed ? (
        <img
          ref={ref}
          src={src}
          alt=""
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          data-loaded={state.loaded}
          onLoad={() => setState((prev) => ({ ...prev, loaded: true }))}
          onError={() => setState((prev) => ({ ...prev, failed: true }))}
          className={cn("cover-img size-full object-cover", imgClassName)}
          style={imgStyle}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted/60">
          <BookOpen className="size-8" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
