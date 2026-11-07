import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Columns2,
  List,
  Maximize,
  Minus,
  Plus,
  Rows3,
  Settings2,
} from "lucide-react";
import type { PageDto, ReaderMode } from "@comicspace/contracts";
import { api } from "../lib/api/client";
import { queryKeys } from "../lib/query/keys";
import { Button, ErrorState, Spinner } from "../components/ui";
import { cn } from "../lib/cn";
import { useLocalStorage } from "../lib/hooks/useLocalStorage";
import { buildSpreads, spreadIndexForPage } from "../lib/reader/spreads";
import {
  isLastSpread,
  prefetchWindow,
  readAheadWindow,
  stepSpread,
} from "../lib/reader/navigation";
import { usePrefetchPolicy } from "../lib/reader/network";
import { ImagePrefetcher } from "../lib/reader/prefetch";

type FitMode = "height" | "width" | "original";
type Direction = "rtl" | "ltr";

const NEXT_CHAPTER_PREFETCH_PAGES = 8;

export function ReaderPage() {
  const search = useSearch({ from: "/read" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sourceId, mangaId, chapterId } = search;

  const active = Boolean(sourceId && mangaId && chapterId);
  const pagesQuery = useQuery({
    queryKey: queryKeys.pages(sourceId, mangaId, chapterId),
    queryFn: ({ signal }) =>
      api.getPages({ sourceId, mangaId, chapterId }, signal),
    enabled: active,
    staleTime: 60_000,
  });

  const payload = pagesQuery.data;
  const [pageIndex, setPageIndex] = useState(0);
  const [mode, setMode] = useState<ReaderMode>("single");
  const [direction, setDirection] = useState<Direction>("rtl");
  const [fit, setFit] = useLocalStorage<FitMode>(
    "comicspace:reader:fit",
    "height",
  );
  const [firstPageAlone, setFirstPageAlone] = useLocalStorage<boolean>(
    "comicspace:reader:firstPageAlone",
    true,
  );
  const [idleReadAhead, setIdleReadAhead] = useLocalStorage<boolean>(
    "comicspace:reader:idleReadAhead",
    true,
  );
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [chromeVisible, setChromeVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [failedPages, setFailedPages] = useState<Set<number>>(new Set());
  const initialized = useRef("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const chapterPrefetch = useRef(new Set<string>());
  const suppressObserver = useRef(false);
  const pendingScroll = useRef(false);
  const lastTicketRefresh = useRef(0);
  const navigating = useRef(false);
  const lastChapterAdvance = useRef(0);

  const chapterKey = `${sourceId}:${mangaId}:${chapterId}`;
  const prefetcher = useMemo(() => new ImagePrefetcher(), []);
  const prefetchPolicy = usePrefetchPolicy();

  useEffect(() => {
    prefetcher.setPolicy({
      enabled: prefetchPolicy.enabled,
      concurrency: prefetchPolicy.concurrency,
      poolLimit: prefetchPolicy.poolLimit,
    });
  }, [prefetcher, prefetchPolicy]);

  useEffect(() => {
    if (!payload || initialized.current === chapterKey) return;
    initialized.current = chapterKey;
    // Drop the previous chapter's queued and decoded images: they are dead
    // weight, and leaving them queued delays the new chapter's first pages.
    prefetcher.clear();
    navigating.current = false;
    const maxPage = Math.max(0, payload.pages.length - 1);
    const requested = search.page ?? payload.progress?.pageIndex ?? 0;
    setPageIndex(Math.min(Math.max(0, requested), maxPage));
    const nextMode =
      search.mode ??
      payload.progress?.mode ??
      (payload.readingDirection === "ttb" ? "webtoon" : "single");
    setMode(nextMode);
    if (nextMode === "webtoon") pendingScroll.current = true;
    setDirection(payload.readingDirection === "ltr" ? "ltr" : "rtl");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFailedPages(new Set());
  }, [payload, chapterKey, search.page, search.mode, prefetcher]);

  const handleImageError = useCallback(
    (index: number) => {
      setFailedPages((current) => new Set(current).add(index));
      // A 12h ticket may have expired while the tab was open, or the source's
      // page URLs may have rotated. Ask for a forced refresh (cached page lists
      // are served without waiting) at most once every 30s.
      if (Date.now() - lastTicketRefresh.current > 30_000) {
        lastTicketRefresh.current = Date.now();
        void api
          .getPages({ sourceId, mangaId, chapterId, refresh: true })
          .then((data) => {
            queryClient.setQueryData(
              queryKeys.pages(sourceId, mangaId, chapterId),
              data,
            );
          })
          .catch(() => undefined);
      }
    },
    [sourceId, mangaId, chapterId, queryClient],
  );

  useEffect(() => {
    setFailedPages(new Set());
  }, [payload]);

  // Chrome appears on demand: tapping the centre shows it, then it fades out
  // unless the settings panel is open. Page turns never reveal it.
  useEffect(() => {
    if (!chromeVisible || settingsOpen) return;
    const timer = window.setTimeout(() => setChromeVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [chromeVisible, settingsOpen]);

  const toggleChrome = useCallback(() => {
    setChromeVisible((visible) => !visible);
    setSettingsOpen(false);
  }, []);

  // The mouse cursor sleeps after a short idle. While asleep only the wheel
  // works; the first click just wakes it, and click/drag page turns need an
  // awake cursor. Touch and pen input are not affected.
  const [cursorAwake, setCursorAwake] = useState(true);
  const cursorAwakeRef = useRef(true);
  const cursorTimer = useRef<number | undefined>(undefined);
  const swallowedPointer = useRef<number | null>(null);

  const wakeCursor = useCallback(() => {
    window.clearTimeout(cursorTimer.current);
    if (!cursorAwakeRef.current) {
      cursorAwakeRef.current = true;
      setCursorAwake(true);
    }
    cursorTimer.current = window.setTimeout(() => {
      cursorAwakeRef.current = false;
      setCursorAwake(false);
    }, 2500);
  }, []);

  useEffect(() => {
    wakeCursor();
    return () => window.clearTimeout(cursorTimer.current);
  }, [wakeCursor]);

  useEffect(() => {
    if (chromeVisible) wakeCursor();
  }, [chromeVisible, wakeCursor]);

  const spreads = useMemo(() => {
    if (!payload) return [];
    return buildSpreads(payload.pages, {
      rtl: direction === "rtl",
      coverAlone: firstPageAlone,
      wideRatio: 1.2,
    });
  }, [payload, direction, firstPageAlone]);

  const total = payload?.pages.length ?? 0;
  const spreadIndex = useMemo(
    () => spreadIndexForPage(spreads, pageIndex),
    [spreads, pageIndex],
  );

  const isAtEnd = useMemo(() => {
    if (!payload) return false;
    if (mode === "webtoon" || mode === "single") return pageIndex >= total - 1;
    return isLastSpread(spreads, pageIndex);
  }, [payload, mode, pageIndex, total, spreads]);

  const flushProgress = useCallback(() => {
    if (!active) return;
    const body = JSON.stringify({
      sourceId,
      mangaId,
      chapterId,
      pageIndex,
      mode,
      completed: isAtEnd,
    });
    void fetch("/api/progress", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }, [active, sourceId, mangaId, chapterId, pageIndex, mode, isAtEnd]);

  const advanceChapter = useCallback(() => {
    const target = payload?.nextChapterId;
    if (!target || !active || navigating.current) return;
    navigating.current = true;
    flushProgress();
    void navigate({
      to: "/read",
      search: { sourceId, mangaId, chapterId: target, mode, page: 0 },
      replace: true,
      resetScroll: true,
    });
  }, [payload, active, flushProgress, navigate, sourceId, mangaId, mode]);

  const navigateChapter = useCallback(
    (target: string | null) => {
      if (!target || navigating.current) return;
      navigating.current = true;
      flushProgress();
      void navigate({
        to: "/read",
        search: { sourceId, mangaId, chapterId: target, mode, page: 0 },
        replace: true,
        resetScroll: true,
      });
    },
    [flushProgress, navigate, sourceId, mangaId, mode],
  );

  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(0, next), Math.max(0, total - 1));
      setPageIndex(clamped);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    },
    [total],
  );

  const next = useCallback(() => {
    if (!payload) return;
    if (mode === "double") {
      if (spreads.length === 0) return;
      if (isLastSpread(spreads, pageIndex)) {
        advanceChapter();
        return;
      }
      const target = stepSpread(spreads, pageIndex, 1);
      if (target !== null) goToPage(target);
      return;
    }
    if (pageIndex >= total - 1) {
      advanceChapter();
      return;
    }
    goToPage(pageIndex + 1);
  }, [payload, mode, spreads, pageIndex, total, goToPage, advanceChapter]);

  const prev = useCallback(() => {
    if (mode === "double") {
      const target = stepSpread(spreads, pageIndex, -1);
      if (target !== null) goToPage(target);
      return;
    }
    goToPage(pageIndex - 1);
  }, [mode, spreads, pageIndex, goToPage]);

  const atScrollBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return false;
    return element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const cycleMode = useCallback(() => {
    const order: ReaderMode[] = ["single", "double", "webtoon"];
    const index = order.indexOf(mode);
    setMode(order[(index + 1) % order.length] as ReaderMode);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [mode]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        else if (document.fullscreenElement) void document.exitFullscreen();
        else toggleChrome();
        return;
      }
      if (event.key === "f") {
        event.preventDefault();
        toggleFullscreen();
        return;
      }
      if (event.key === "d") {
        event.preventDefault();
        cycleMode();
        return;
      }
      if (mode === "webtoon") {
        if (
          event.key === "ArrowRight" ||
          event.key === "ArrowDown" ||
          event.key === " " ||
          event.key === "PageDown"
        ) {
          event.preventDefault();
          if (atScrollBottom()) advanceChapter();
          else
            scrollRef.current?.scrollBy({
              top: window.innerHeight * 0.85,
              behavior: "smooth",
            });
        } else if (
          event.key === "ArrowLeft" ||
          event.key === "ArrowUp" ||
          event.key === "PageUp"
        ) {
          event.preventDefault();
          scrollRef.current?.scrollBy({
            top: -window.innerHeight * 0.85,
            behavior: "smooth",
          });
        }
        return;
      }

      const forward =
        direction === "rtl" ? "ArrowLeft" : "ArrowRight";
      const backward =
        direction === "rtl" ? "ArrowRight" : "ArrowLeft";
      if (
        event.key === forward ||
        event.key === "PageDown" ||
        (event.key === " " && !event.shiftKey)
      ) {
        event.preventDefault();
        next();
      } else if (
        event.key === backward ||
        event.key === "PageUp" ||
        (event.key === " " && event.shiftKey)
      ) {
        event.preventDefault();
        prev();
      } else if (event.key === "Home") {
        event.preventDefault();
        goToPage(0);
      } else if (event.key === "End") {
        event.preventDefault();
        goToPage(total - 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    mode,
    direction,
    next,
    prev,
    goToPage,
    total,
    toggleFullscreen,
    cycleMode,
    toggleChrome,
    settingsOpen,
    atScrollBottom,
    advanceChapter,
  ]);

  // Save progress with a short debounce.
  useEffect(() => {
    if (!payload || !active) return;
    const timer = window.setTimeout(() => {
      void api
        .saveProgress({
          sourceId,
          mangaId,
          chapterId,
          pageIndex,
          mode,
          completed: isAtEnd,
        })
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    active,
    payload,
    sourceId,
    mangaId,
    chapterId,
    pageIndex,
    mode,
    isAtEnd,
  ]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushProgress();
    };
    window.addEventListener("pagehide", flushProgress);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushProgress);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushProgress]);

  // Preload nearby pages through a pool that survives page turns. Server-side
  // the first request for each image lands in the disk cache, so a hit here
  // also warms the next session. The next page or spread is queued as urgent
  // so a quick turn never waits behind read-ahead work.
  useEffect(() => {
    if (!payload || !prefetchPolicy.enabled || pageIndex >= payload.pages.length) {
      return;
    }
    const range = prefetchWindow(
      pageIndex,
      payload.pages.length,
      mode,
      prefetchPolicy.windowScale,
    );
    const src = (index: number): string | undefined => payload.pages[index]?.src;
    const ahead = range.ahead
      .map(src)
      .filter((value): value is string => Boolean(value));
    const behind = range.behind
      .map(src)
      .filter((value): value is string => Boolean(value));
    const urgentCount = mode === "double" ? 2 : 1;
    prefetcher.scheduleWindow({
      urgent: ahead.slice(0, urgentCount),
      ahead: ahead.slice(urgentCount),
      behind,
    });
  }, [payload, pageIndex, mode, prefetchPolicy, prefetcher]);

  // Once the reader has settled on a page, keep loading the rest of the
  // chapter in the background. It is a no-op on slow/metered links and can be
  // turned off in the reader settings.
  useEffect(() => {
    if (
      !payload ||
      !prefetchPolicy.enabled ||
      !prefetchPolicy.readAhead ||
      !idleReadAhead ||
      pageIndex >= payload.pages.length
    ) {
      return;
    }
    const offsets = readAheadWindow(
      pageIndex,
      payload.pages.length,
      mode,
      prefetchPolicy.windowScale,
      8,
    );
    if (offsets.length === 0) return;
    const timer = window.setTimeout(() => {
      const urls = offsets
        .map((index) => payload.pages[index]?.src)
        .filter((value): value is string => Boolean(value));
      prefetcher.schedule(urls, "idle");
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [
    payload,
    pageIndex,
    mode,
    prefetchPolicy,
    idleReadAhead,
    prefetcher,
  ]);

  useEffect(() => () => prefetcher.clear(), [prefetcher]);

  // Warm the next (and previous) chapter early enough that auto-advance does
  // not show a loading screen.
  useEffect(() => {
    if (
      !payload ||
      !active ||
      !prefetchPolicy.enabled ||
      pageIndex >= payload.pages.length
    ) {
      return;
    }
    const run = async (kind: "next" | "prev", id: string) => {
      const key = `${sourceId}:${mangaId}:${kind}:${id}`;
      if (chapterPrefetch.current.has(key)) return;
      chapterPrefetch.current.add(key);
      try {
        const data = await queryClient.fetchQuery({
          queryKey: queryKeys.pages(sourceId, mangaId, id),
          queryFn: ({ signal }) =>
            api.getPages({ sourceId, mangaId, chapterId: id }, signal),
          staleTime: 60_000,
        });
        const pages =
          kind === "next"
            ? data.pages.slice(0, 6)
            : data.pages.slice(-4);
        prefetcher.schedule(
          pages.map((page) => page.src),
          "idle",
        );
      } catch {
        // Prefetch is best-effort.
      }
    };

    const nextThreshold = Math.max(
      2,
      Math.round(NEXT_CHAPTER_PREFETCH_PAGES * prefetchPolicy.windowScale),
    );
    if (payload.nextChapterId && total - 1 - pageIndex <= nextThreshold) {
      void run("next", payload.nextChapterId);
    }
    if (payload.prevChapterId && pageIndex <= 2) {
      void run("prev", payload.prevChapterId);
    }
  }, [
    payload,
    active,
    sourceId,
    mangaId,
    pageIndex,
    total,
    queryClient,
    prefetcher,
    prefetchPolicy,
  ]);

  // Webtoon scroll tracking.
  useEffect(() => {
    if (mode !== "webtoon" || !payload) return;
    const container = scrollRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (suppressObserver.current) return;
        let best: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (!best || entry.intersectionRatio > best.intersectionRatio) {
            best = entry;
          }
        }
        const index = Number(
          (best?.target as HTMLElement | undefined)?.dataset.pageIndex,
        );
        if (Number.isFinite(index)) setPageIndex(index);
      },
      {
        root: container,
        threshold: [0.2, 0.5, 0.8],
        rootMargin: "-15% 0px -35% 0px",
      },
    );
    for (const element of pageRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [mode, payload, pageIndex]);

  useEffect(() => {
    if (mode === "webtoon") pendingScroll.current = true;
  }, [mode]);

  useEffect(() => {
    if (mode !== "webtoon") {
      suppressObserver.current = false;
      return;
    }
    if (!pendingScroll.current) return;
    suppressObserver.current = true;
    const scrollTimer = window.setTimeout(() => {
      const target = pageRefs.current.get(pageIndex);
      if (target) {
        target.scrollIntoView({ block: "start", behavior: "auto" });
        pendingScroll.current = false;
      }
      window.setTimeout(() => {
        suppressObserver.current = false;
      }, 250);
    }, 50);
    return () => window.clearTimeout(scrollTimer);
  }, [mode, chapterKey, pageIndex]);

  const handleWheel = (event: React.WheelEvent) => {
    if (!payload) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      setZoom((value) =>
        Math.min(4, Math.max(1, value + (event.deltaY < 0 ? 0.2 : -0.2))),
      );
      return;
    }
    // Width/original fit can make a page taller than the viewport; scrolling it
    // must win over turning the page, otherwise those modes are unusable.
    const canScroll =
      fit !== "height" &&
      zoom === 1 &&
      scrollRef.current !== null &&
      scrollRef.current.scrollHeight > scrollRef.current.clientHeight + 8;

    if (mode === "webtoon" || canScroll) {
      if (event.deltaY > 0 && atScrollBottom()) {
        if (mode === "webtoon") {
          const now = Date.now();
          if (now - lastChapterAdvance.current > 800) {
            lastChapterAdvance.current = now;
            advanceChapter();
          }
        } else {
          next();
        }
      }
      return;
    }
    event.preventDefault();
    if (zoom > 1) return;
    const now = Date.now();
    const last = (window as unknown as { __csWheelLock?: number }).__csWheelLock ?? 0;
    if (now - last < 400) return;
    if (Math.abs(event.deltaY) < 18) return;
    (window as unknown as { __csWheelLock?: number }).__csWheelLock = now;
    if (event.deltaY > 0) next();
    else prev();
  };

  const pointer = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
    dragging: boolean;
  } | null>(null);
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  const lastCursorWake = useRef(0);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    if (
      event.pointerType === "mouse" &&
      !cursorAwakeRef.current &&
      !chromeVisible
    ) {
      // A click on a sleeping cursor only wakes it.
      swallowedPointer.current = event.pointerId;
      lastCursorWake.current = Date.now();
      wakeCursor();
      return;
    }
    activePointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (activePointers.current.size >= 2) {
      const [first, second] = [...activePointers.current.values()];
      if (first && second) {
        pinchStart.current = {
          distance: Math.hypot(second.x - first.x, second.y - first.y),
          zoom,
        };
      }
      pointer.current = null;
      return;
    }
    pointer.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
      dragging: zoom > 1,
    };
    if (zoom > 1) event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (activePointers.current.has(event.pointerId)) {
      activePointers.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    }
    if (activePointers.current.size >= 2 && pinchStart.current) {
      const [first, second] = [...activePointers.current.values()];
      if (first && second) {
        const distance = Math.hypot(
          second.x - first.x,
          second.y - first.y,
        );
        if (pinchStart.current.distance > 0) {
          setZoom(
            Math.min(
              4,
              Math.max(
                1,
                pinchStart.current.zoom *
                  (distance / pinchStart.current.distance),
              ),
            ),
          );
        }
      }
      return;
    }
    if (!pointer.current) return;
    if (zoom > 1 && pointer.current.dragging) {
      setPan({
        x: pointer.current.panX + event.clientX - pointer.current.x,
        y: pointer.current.panY + event.clientY - pointer.current.y,
      });
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (swallowedPointer.current === event.pointerId) {
      swallowedPointer.current = null;
      return;
    }
    if (event.pointerType === "mouse") wakeCursor();
    activePointers.current.delete(event.pointerId);
    if (activePointers.current.size < 2) pinchStart.current = null;
    const start = pointer.current;
    pointer.current = null;
    if (!start) return;
    if (zoom > 1) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      const forwardSwipe = direction === "rtl" ? dx > 0 : dx < 0;
      if (forwardSwipe) next();
      else prev();
      return;
    }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = (event.clientX - rect.left) / rect.width;
      if (ratio < 0.33) {
        if (direction === "rtl") next();
        else prev();
      } else if (ratio > 0.67) {
        if (direction === "rtl") prev();
        else next();
      } else {
        toggleChrome();
      }
    }
  };

  if (!active) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
        <ErrorState title="缺少阅读参数" message="请从漫画详情页打开章节。" />
      </div>
    );
  }

  if (pagesQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <Spinner label="正在载入章节" />
      </div>
    );
  }

  if (pagesQuery.isError || !payload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black p-6">
        <div className="w-full max-w-lg">
          <ErrorState
            title="章节加载失败"
            message={
              pagesQuery.error instanceof Error
                ? pagesQuery.error.message
                : "没有拿到页面"
            }
            onRetry={() => void pagesQuery.refetch()}
          />
          <div className="mt-4 flex justify-center gap-2">
            <Link to="/manga" search={{ sourceId, mangaId }}>
              <Button variant="secondary">返回详情</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const currentPage = payload.pages[pageIndex];
  const currentSpread = spreads[spreadIndex];

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 select-none overflow-hidden bg-black text-white",
        cursorAwake || chromeVisible ? "cursor-default" : "cursor-none",
      )}
      onWheel={handleWheel}
      onPointerMove={(event) => {
        // Movement keeps an awake cursor alive but never wakes a sleeping one.
        if (
          event.pointerType === "mouse" &&
          (cursorAwakeRef.current || chromeVisible)
        ) {
          wakeCursor();
        }
      }}
    >
      {chromeVisible ? (
        <header className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-gradient-to-b from-black/85 to-transparent px-3 py-2 text-white">
          <Link
            to="/manga"
            search={{ sourceId, mangaId }}
            onClick={flushProgress}
            className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-white/10"
            aria-label="返回漫画详情"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{payload.mangaTitle}</div>
            <div className="flex items-center gap-2 truncate text-xs text-white/60">
              {payload.chapter.title}
              {payload.downloaded ? (
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 text-[10px] text-emerald-300">
                  离线
                </span>
              ) : null}
              {payload.stale ? (
                <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 text-[10px] text-amber-300">
                  缓存
                </span>
              ) : null}
            </div>
          </div>
          <ReaderIconButton
            label="阅读设置"
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <Settings2 className="size-5" />
          </ReaderIconButton>
          <ReaderIconButton label="全屏" onClick={toggleFullscreen}>
            <Maximize className="size-5" />
          </ReaderIconButton>
        </header>
      ) : null}

      {settingsOpen && chromeVisible ? (
        <div className="absolute right-3 top-16 z-30 max-h-[calc(100vh-5rem)] w-72 overflow-y-auto rounded-xl border border-white/10 bg-zinc-950/95 p-3 text-sm shadow-xl backdrop-blur scrollbar-thin">
          <div className="mb-3 text-xs font-semibold text-white/60">阅读设置</div>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs text-white/50">模式</div>
              <div className="grid grid-cols-3 gap-1">
                <ModeButton active={mode === "single"} onClick={() => setMode("single")}>
                  <Rows3 className="size-3.5" /> 单页
                </ModeButton>
                <ModeButton active={mode === "double"} onClick={() => setMode("double")}>
                  <Columns2 className="size-3.5" /> 双页
                </ModeButton>
                <ModeButton active={mode === "webtoon"} onClick={() => setMode("webtoon")}>
                  <List className="size-3.5" /> 条漫
                </ModeButton>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-white/50">方向</div>
              <div className="grid grid-cols-2 gap-1">
                <ModeButton active={direction === "rtl"} onClick={() => setDirection("rtl")}>
                  右→左
                </ModeButton>
                <ModeButton active={direction === "ltr"} onClick={() => setDirection("ltr")}>
                  左→右
                </ModeButton>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-white/50">首页</div>
              <div className="grid grid-cols-2 gap-1">
                <ModeButton
                  active={firstPageAlone}
                  onClick={() => setFirstPageAlone(true)}
                >
                  单独一页
                </ModeButton>
                <ModeButton
                  active={!firstPageAlone}
                  onClick={() => setFirstPageAlone(false)}
                >
                  与下页拼双页
                </ModeButton>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-white/50">适配</div>
              <div className="grid grid-cols-3 gap-1">
                <ModeButton active={fit === "height"} onClick={() => setFit("height")}>
                  高度
                </ModeButton>
                <ModeButton active={fit === "width"} onClick={() => setFit("width")}>
                  宽度
                </ModeButton>
                <ModeButton active={fit === "original"} onClick={() => setFit("original")}>
                  原始
                </ModeButton>
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-white/50">
                <span>预读</span>
                <span className="text-white/30">
                  {prefetchPolicy.enabled
                    ? prefetchPolicy.readAhead
                      ? "标准"
                      : "省流量"
                    : "已关闭"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <ModeButton
                  active={idleReadAhead}
                  onClick={() => setIdleReadAhead(true)}
                >
                  空闲预读
                </ModeButton>
                <ModeButton
                  active={!idleReadAhead}
                  onClick={() => setIdleReadAhead(false)}
                >
                  只预取附近
                </ModeButton>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-white/40">
                空闲预读会在停在同一页约 1.5 秒后继续加载本章后续页面。慢速网络或系统省流量模式会自动减少预取。
              </p>
            </div>
            <div>
              <div className="mb-1 text-xs text-white/50">缩放</div>
              <div className="flex items-center gap-2">
                <ReaderIconButton
                  label="缩小"
                  onClick={() => setZoom((value) => Math.max(1, value - 0.25))}
                >
                  <Minus className="size-4" />
                </ReaderIconButton>
                <span className="w-14 text-center text-xs tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <ReaderIconButton
                  label="放大"
                  onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
                >
                  <Plus className="size-4" />
                </ReaderIconButton>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white/70"
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                >
                  重置
                </Button>
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-white/50">章节</div>
              <div className="grid grid-cols-2 gap-1">
                <ModeButton
                  active={false}
                  onClick={() => navigateChapter(payload.prevChapterId)}
                >
                  <ChevronLeft className="size-3.5" /> 上一章
                </ModeButton>
                <ModeButton
                  active={false}
                  onClick={() => navigateChapter(payload.nextChapterId)}
                >
                  下一章 <ChevronRight className="size-3.5" />
                </ModeButton>
              </div>
            </div>
            <div className="text-[11px] leading-relaxed text-white/40">
              翻到本章末尾继续翻页会自动进入下一章；点画面中央显示或隐藏控制栏。鼠标隐藏时只响应滚轮，点击一次唤醒后才能点击翻页。
            </div>
          </div>
        </div>
      ) : null}

      <main
        ref={scrollRef}
        className="h-full w-full overflow-auto scrollbar-thin"
        style={{
          touchAction:
            mode === "webtoon" || fit === "width"
              ? "pan-y"
              : fit === "original"
                ? "auto"
                : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => {
          if (Date.now() - lastCursorWake.current < 600) return;
          if (zoom > 1) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          } else {
            setZoom(2);
          }
        }}
      >
        {mode === "webtoon" ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
            {payload.pages.map((page, offset) => (
              <div
                key={page.index}
                ref={(element) => {
                  if (element) pageRefs.current.set(offset, element);
                  else pageRefs.current.delete(offset);
                }}
                data-page-index={offset}
                className="w-full"
              >
                <ReaderImage
                  page={page}
                  className="h-auto w-full"
                  eager={Math.abs(offset - pageIndex) <= 2}
                  failed={failedPages.has(page.index)}
                  onRetry={() =>
                    setFailedPages((current) => {
                      const next = new Set(current);
                      next.delete(page.index);
                      return next;
                    })
                  }
                  onError={() => handleImageError(page.index)}
                />
              </div>
            ))}
          </div>
        ) : mode === "double" ? (
          <div
            className={cn(
              "flex w-full justify-center p-2",
              fit === "height"
                ? "h-full items-center"
                : fit === "width"
                  ? "min-h-full items-start"
                  : "min-h-full items-start justify-start",
            )}
          >
            {currentSpread ? (
              <div
                className={cn(
                  "flex w-full justify-center gap-0.5",
                  fit === "height"
                    ? "h-full max-h-full items-center"
                    : "items-start",
                  direction === "rtl" ? "flex-row-reverse" : "flex-row",
                )}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                }}
              >
                {currentSpread.pages.map((page) => (
                  <ReaderImage
                    key={page.index}
                    page={page}
                    fit={fit}
                    half={currentSpread.pages.length > 1}
                    failed={failedPages.has(page.index)}
                    onError={() => handleImageError(page.index)}
                    onRetry={() =>
                      setFailedPages((current) => {
                        const next = new Set(current);
                        next.delete(page.index);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className={cn(
              "flex w-full justify-center p-2",
              fit === "height"
                ? "h-full items-center"
                : fit === "width"
                  ? "min-h-full items-start"
                  : "min-h-full items-start justify-start",
            )}
          >
            {currentPage ? (
              <ReaderImage
                page={currentPage}
                fit={fit}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                }}
                failed={failedPages.has(currentPage.index)}
                onError={() => handleImageError(currentPage.index)}
                onRetry={() =>
                  setFailedPages((current) => {
                    const next = new Set(current);
                    next.delete(currentPage.index);
                    return next;
                  })
                }
              />
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}

function ReaderIconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex size-10 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  );
}

function ModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
        active
          ? "border-amber-400/40 bg-amber-400/15 text-amber-200"
          : "border-white/10 text-white/60 hover:bg-white/10 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function ReaderImage({
  page,
  fit,
  half = false,
  className,
  style,
  eager = true,
  failed,
  onError,
  onRetry,
}: {
  page: PageDto;
  /** Undefined in webtoon mode, which sizes its own images by width. */
  fit?: FitMode;
  /** Double-page mode: this page shares the row with a sibling. */
  half?: boolean;
  className?: string;
  style?: React.CSSProperties;
  eager?: boolean;
  failed: boolean;
  onError: () => void;
  onRetry: () => void;
}) {
  const [retry, setRetry] = useState(0);
  const src = retry
    ? `${page.src}${page.src.includes("?") ? "&" : "?"}retry=${retry}`
    : page.src;
  const aspect =
    page.width && page.height ? `${page.width} / ${page.height}` : undefined;
  // Fit mode is a sizing rule, not just object-fit: "height" pins the image to
  // the viewport height, "width" pins it to the width and lets the page scroll,
  // "original" draws at natural pixels.
  const sizing =
    fit === "height"
      ? "h-full w-auto max-h-none max-w-none shrink-0"
      : fit === "width"
        ? half
          ? "h-auto w-[calc(50%-1px)] max-h-none max-w-none shrink-0"
          : "h-auto w-full max-h-none max-w-none"
        : fit === "original"
          ? "h-auto w-auto max-h-none max-w-none shrink-0"
          : "";

  if (failed) {
    return (
      <div className="flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/5 p-8 text-sm text-white/60">
        <span>第 {page.index + 1} 页加载失败</span>
        <button
          type="button"
          className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white hover:bg-white/10"
          onClick={() => {
            setRetry((value) => value + 1);
            onRetry();
          }}
        >
          重试这一页
        </button>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`第 ${page.index + 1} 页`}
      draggable={false}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={onError}
      className={cn(sizing, className)}
      style={{
        ...style,
        aspectRatio: aspect,
        objectFit: fit === "original" ? "none" : "contain",
      }}
    />
  );
}
