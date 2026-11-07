import type { MangaDto } from "@comicspace/contracts";
import { MangaCard } from "./MangaCard";

export const mangaGridClass =
  "grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

export function MangaGrid({
  items,
  empty,
}: {
  items: MangaDto[];
  empty?: React.ReactNode;
}) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <div className={`stagger ${mangaGridClass}`}>
      {items.map((manga, index) => (
        <div
          key={`${manga.sourceId}:${manga.id}`}
          // Restart the stagger every page so "load more" doesn't wait.
          style={{ "--i": index % 24 } as React.CSSProperties}
        >
          <MangaCard manga={manga} index={index} />
        </div>
      ))}
    </div>
  );
}
