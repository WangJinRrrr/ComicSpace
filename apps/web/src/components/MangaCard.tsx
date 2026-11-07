import { useRef } from "react";
import { Link } from "@tanstack/react-router";
import type { MangaDto } from "@comicspace/contracts";
import { cn } from "../lib/cn";
import { statusLabel } from "../lib/format";
import { useTilt } from "../lib/hooks/useTilt";
import {
  mangaKey,
  setCoverHandoff,
  tagForTransition,
} from "../lib/viewTransition";
import { CoverImage } from "./CoverImage";

export function MangaCard({
  manga,
  className,
  footer,
  index,
}: {
  manga: MangaDto;
  className?: string;
  footer?: React.ReactNode;
  /** Position in the list, shown as a small catalogue number. */
  index?: number;
}) {
  const tilt = useTilt<HTMLDivElement>();
  const coverRef = useRef<HTMLDivElement>(null);
  const meta =
    manga.authors?.join(" / ") || manga.genres?.slice(0, 2).join(" · ") || "";

  return (
    <Link
      to="/manga"
      search={{ sourceId: manga.sourceId, mangaId: manga.id }}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        setCoverHandoff({
          key: mangaKey(manga.sourceId, manga.id),
          coverUrl: manga.coverUrl,
          title: manga.title,
        });
        tagForTransition(coverRef.current);
      }}
      className={cn("group block rounded-xl focus-visible:outline-offset-4", className)}
    >
      <div
        className="tilt relative rounded-xl shadow-soft"
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
      >
        <div
          ref={coverRef}
          className="relative aspect-[2/3] overflow-hidden rounded-xl ring-1 ring-line"
        >
          <CoverImage src={manga.coverUrl} className="size-full" />
          <div className="tilt-glare absolute inset-0" aria-hidden="true" />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/35 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            aria-hidden="true"
          />
          {manga.status ? (
            <span className="glass absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium text-ink ring-1 ring-black/5">
              {statusLabel(manga.status)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="space-y-1 px-0.5 pt-3">
        <div className="flex items-start gap-2">
          {index !== undefined ? (
            <span className="label-mono mt-[3px] shrink-0 text-[10px] text-muted/70 tabular">
              {String(index + 1).padStart(2, "0")}
            </span>
          ) : null}
          <h3 className="line-clamp-2 text-sm font-medium leading-5 text-ink transition-colors group-hover:text-accent">
            {manga.title}
          </h3>
        </div>
        {meta ? <p className="line-clamp-1 text-xs text-muted">{meta}</p> : null}
        {footer}
      </div>
    </Link>
  );
}
