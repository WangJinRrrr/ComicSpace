import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { cn } from "../lib/cn";
import { CoverImage } from "./CoverImage";
import { Button, IconButton } from "./ui";

export interface CoverFlowItem {
  key: string;
  title: string;
  coverUrl?: string;
  /** Primary action, e.g. the reader URL. */
  href: string;
  actionLabel?: string;
  /** Optional secondary link, e.g. the detail page. */
  detailHref?: string;
  eyebrow?: string;
  meta?: ReactNode;
}

const SIDE_ANGLE = 56;
const DRAG_THRESHOLD = 6;

/**
 * Cover Flow carousel built on CSS 3D transforms. Supports pointer drag,
 * touch swipe, horizontal wheel/trackpad, arrow keys and click-to-focus.
 * Clicking the centred cover follows its `href`.
 */
export function CoverFlow({
  items,
  label = "封面流",
  className,
}: {
  items: CoverFlowItem[];
  label?: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [stageWidth, setStageWidth] = useState(0);
  const [active, setActive] = useState(0);
  const [dragPx, setDragPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const count = items.length;
  const current = Math.min(active, Math.max(count - 1, 0));
  const coverW = Math.round(clamp(stageWidth * 0.3, 136, 216));
  const coverH = Math.round(coverW * 1.5);
  const spacing = coverW * 0.34;
  const centerGap = coverW * 0.72;

  useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    setStageWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const move = useCallback(
    (delta: number) => setActive((value) => clamp(value + delta, 0, count - 1)),
    [count],
  );

  // Horizontal wheel / trackpad swipes step through covers; vertical wheel
  // keeps scrolling the page.
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    let accumulated = 0;
    let lastStep = 0;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      accumulated += event.deltaX;
      const now = performance.now();
      if (Math.abs(accumulated) > 40 && now - lastStep > 140) {
        move(Math.sign(accumulated));
        accumulated = 0;
        lastStep = now;
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [move]);

  // Keep keyboard focus on the centred cover while arrowing through.
  useEffect(() => {
    const stage = stageRef.current;
    if (stage?.contains(document.activeElement)) {
      itemRefs.current[current]?.focus({ preventScroll: true });
    }
  }, [current]);

  if (count === 0) return null;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    suppressClick.current = false;
    drag.current = { id: event.pointerId, x: event.clientX, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    if (!state.moved && Math.abs(dx) > DRAG_THRESHOLD) {
      state.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    if (state.moved) setDragPx(dx);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    if (!state.moved) return;
    const dx = event.clientX - state.x;
    let steps = Math.round(-dx / spacing);
    if (steps === 0 && Math.abs(dx) > 28) steps = dx < 0 ? 1 : -1;
    move(steps);
    setDragPx(0);
    setDragging(false);
    suppressClick.current = true;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => move(-1),
      ArrowRight: () => move(1),
      Home: () => setActive(0),
      End: () => setActive(count - 1),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const activeItem = items[current]!;

  return (
    <div className={cn("relative", className)}>
      <div
        ref={stageRef}
        role="group"
        aria-roledescription="carousel"
        aria-label={label}
        className="relative touch-pan-y select-none overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_10%,#000_90%,transparent)]"
        style={{ height: coverH * 1.3 + 32, perspective: coverW * 5.5 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {/* Floor line the covers stand on. */}
        <div
          className="pointer-events-none absolute inset-x-0 h-px bg-linear-to-r from-transparent via-line-strong to-transparent"
          style={{ top: 24 + coverH }}
          aria-hidden="true"
        />
        <div
          className="absolute left-1/2"
          style={{
            top: 24,
            width: coverW,
            height: coverH,
            marginLeft: -coverW / 2,
            transformStyle: "preserve-3d",
          }}
        >
          {items.map((item, index) => {
            const offset = index - current + dragPx / spacing;
            const distance = Math.abs(offset);
            const isActive = index === current;
            return (
              <a
                key={item.key}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                href={item.href}
                draggable={false}
                tabIndex={isActive ? 0 : -1}
                aria-label={isActive ? `${item.title}，${item.actionLabel ?? "打开"}` : item.title}
                aria-current={isActive ? "true" : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                  event.preventDefault();
                  if (isActive) void navigate({ href: item.href });
                  else setActive(index);
                }}
                className={cn(
                  "cf-reflect absolute inset-0 block rounded-lg outline-offset-4",
                  !dragging &&
                    "transition-[transform,opacity] duration-700 ease-out-expo",
                  distance > 4.5 && "pointer-events-none",
                )}
                style={{
                  transform: coverTransform(offset, coverW, centerGap, spacing),
                  zIndex: 100 - Math.round(distance * 10),
                  opacity: distance > 4.5 ? 0 : 1,
                }}
              >
                <CoverImage
                  src={item.coverUrl}
                  eager={distance < 3}
                  className={cn(
                    "size-full rounded-lg ring-1 ring-black/5 transition-shadow duration-500",
                    isActive ? "shadow-float" : "shadow-soft",
                  )}
                />
                <span
                  className="pointer-events-none absolute inset-0 rounded-lg bg-canvas transition-opacity duration-500"
                  style={{ opacity: Math.min(distance, 3) * 0.14 }}
                  aria-hidden="true"
                />
              </a>
            );
          })}
        </div>
      </div>

      <div className="mx-auto -mt-2 flex max-w-xl flex-col items-center text-center">
        <div key={activeItem.key} className="animate-rise flex flex-col items-center">
          {activeItem.eyebrow ? (
            <span className="label-mono text-muted">{activeItem.eyebrow}</span>
          ) : null}
          <h3 className="mt-1.5 line-clamp-2 text-title font-semibold text-ink">
            {activeItem.title}
          </h3>
          {activeItem.meta ? (
            <div className="mt-1 text-xs text-muted">{activeItem.meta}</div>
          ) : null}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <IconButton
            label="上一本"
            onClick={() => move(-1)}
            disabled={current === 0}
            className="size-9"
          >
            <ChevronLeft className="size-4" />
          </IconButton>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void navigate({ href: activeItem.href })}
          >
            {activeItem.actionLabel ?? "打开"} <ArrowRight className="size-3.5" />
          </Button>
          {activeItem.detailHref ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void navigate({ href: activeItem.detailHref })}
            >
              <Info className="size-3.5" /> 详情
            </Button>
          ) : null}
          <IconButton
            label="下一本"
            onClick={() => move(1)}
            disabled={current === count - 1}
            className="size-9"
          >
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
        <div className="label-mono mt-3 text-muted tabular" aria-live="polite">
          {String(current + 1).padStart(2, "0")}
          <span className="mx-1.5 text-line-strong">/</span>
          {String(count).padStart(2, "0")}
        </div>
      </div>
    </div>
  );
}

function coverTransform(
  offset: number,
  coverW: number,
  centerGap: number,
  spacing: number,
) {
  const distance = Math.abs(offset);
  const side = Math.sign(offset);
  const near = Math.min(distance, 1);
  const far = Math.max(distance - 1, 0);
  const x = side * (near * centerGap + far * spacing);
  const z = -near * coverW * 0.55 - far * coverW * 0.08;
  const rotate = -side * near * SIDE_ANGLE;
  return `translate3d(${x}px, 0, ${z}px) rotateY(${rotate}deg)`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
