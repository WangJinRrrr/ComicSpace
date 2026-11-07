import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MangaDto } from "@comicspace/contracts";
import {
  mangaKey,
  setCoverHandoff,
  tagForTransition,
} from "../lib/viewTransition";
import { CoverImage } from "./CoverImage";
import { Skeleton } from "./ui";

/**
 * One endless horizontal row of covers that lean back and overlap. Hovering or
 * focusing a cover lifts it out of the pile (see `.stack-row` in globals.css).
 * `onEndReached` fires as the row nears its right edge.
 *
 * Hover intent: a cover only lifts after the pointer rests on it briefly, and
 * stays lifted for a moment after the pointer slips off (which happens when the
 * cover itself moves under the cursor). Without this, sweeping the row makes
 * covers pop and shove each other back and forth.
 */
const HOVER_ENTER_MS = 120;
const HOVER_LEAVE_MS = 220;

export function CoverStack({
  items,
  label,
  loading = false,
  hasMore = false,
  onEndReached,
}: {
  items: MangaDto[];
  label: string;
  loading?: boolean;
  hasMore?: boolean;
  onEndReached?: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const endReached = useRef(onEndReached);
  endReached.current = onEndReached;
  const [hotKey, setHotKey] = useState<string | null>(null);
  const hotKeyRef = useRef<string | null>(null);
  const enterTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);

  const setHot = useCallback((key: string | null) => {
    hotKeyRef.current = key;
    setHotKey(key);
  }, []);

  const handleHoverStart = useCallback(
    (key: string) => {
      window.clearTimeout(leaveTimer.current);
      window.clearTimeout(enterTimer.current);
      if (hotKeyRef.current === key) return;
      enterTimer.current = window.setTimeout(() => setHot(key), HOVER_ENTER_MS);
    },
    [setHot],
  );

  const handleHoverEnd = useCallback(
    (key: string) => {
      window.clearTimeout(enterTimer.current);
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = window.setTimeout(() => {
        if (hotKeyRef.current === key || hotKeyRef.current === null) setHot(null);
      }, HOVER_LEAVE_MS);
    },
    [setHot],
  );

  useEffect(
    () => () => {
      window.clearTimeout(enterTimer.current);
      window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  useEffect(() => {
    const root = scrollerRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          endReached.current?.();
        }
      },
      { root, rootMargin: "0px 600px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, items.length]);

  const scrollBy = (direction: 1 | -1) => {
    const root = scrollerRef.current;
    if (!root) return;
    root.scrollBy({ left: direction * root.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="group/row relative -mx-gutter">
      <div
        ref={scrollerRef}
        className="stack-scroller overflow-x-auto overflow-y-hidden px-gutter"
      >
        <div className="stack-row w-max" role="list" aria-label={label}>
          {items.map((manga, index) => {
            const key = `${manga.sourceId}:${manga.id}`;
            return (
              <StackCard
                key={key}
                manga={manga}
                z={index + 1}
                hot={hotKey === key}
                onHoverStart={() => handleHoverStart(key)}
                onHoverEnd={() => handleHoverEnd(key)}
              />
            );
          })}
          {loading
            ? Array.from({ length: items.length ? 4 : 10 }).map((_, index) => (
                <div
                  key={`skeleton-${index}`}
                  className="stack-card"
                  style={{ "--z": items.length + index + 1 } as React.CSSProperties}
                  aria-hidden="true"
                >
                  <Skeleton className="stack-cover aspect-[2/3] rounded-lg" />
                </div>
              ))
            : null}
          <div ref={sentinelRef} className="w-px shrink-0" aria-hidden="true" />
        </div>
      </div>

      <RowArrow side="left" onClick={() => scrollBy(-1)} />
      <RowArrow side="right" onClick={() => scrollBy(1)} />
    </div>
  );
}

function StackCard({
  manga,
  z,
  hot,
  onHoverStart,
  onHoverEnd,
}: {
  manga: MangaDto;
  z: number;
  hot: boolean;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}) {
  const coverRef = useRef<HTMLDivElement>(null);
  return (
    <Link
      to="/manga"
      search={{ sourceId: manga.sourceId, mangaId: manga.id }}
      role="listitem"
      aria-label={manga.title}
      title={manga.title}
      className={hot ? "stack-card is-hot" : "stack-card"}
      style={{ "--z": z } as React.CSSProperties}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        setCoverHandoff({
          key: mangaKey(manga.sourceId, manga.id),
          coverUrl: manga.coverUrl,
          title: manga.title,
        });
        tagForTransition(coverRef.current);
      }}
    >
      <div
        ref={coverRef}
        className="stack-cover relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-3 ring-1 ring-black/10"
        onPointerEnter={onHoverStart}
        onPointerLeave={onHoverEnd}
        onPointerCancel={onHoverEnd}
      >
        <CoverImage src={manga.coverUrl} className="size-full" />
      </div>
      <div className="stack-caption" aria-hidden="true">
        <div className="line-clamp-2 text-xs font-medium leading-4 text-ink">
          {manga.title}
        </div>
      </div>
    </Link>
  );
}

function RowArrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "向左滚动" : "向右滚动"}
      title={side === "left" ? "向左滚动" : "向右滚动"}
      className={
        "glass absolute top-1/2 z-[10000] hidden size-10 -translate-y-1/2 place-items-center rounded-full text-ink opacity-0 shadow-lift ring-1 ring-line transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100 md:grid " +
        (side === "left" ? "left-2" : "right-2")
      }
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  );
}
