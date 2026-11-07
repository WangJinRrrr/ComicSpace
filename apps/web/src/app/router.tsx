import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import type { ReaderMode } from "@comicspace/contracts";
import { AppShell } from "./shell";
import { HomePage } from "../routes/home";
import { SearchPage } from "../routes/search";
import { MangaPage } from "../routes/manga";
import { LibraryPage, type LibraryTab } from "../routes/library";
import { HistoryPage } from "../routes/history";
import { SettingsPage } from "../routes/settings";
import { ReaderPage } from "../routes/reader";
import { Button, EmptyState } from "../components/ui";

interface SearchSearch {
  sourceId?: string;
  q?: string;
}

interface LibrarySearch {
  tab?: LibraryTab;
}

interface MangaSearch {
  sourceId: string;
  mangaId: string;
}

interface ReaderSearch {
  sourceId: string;
  mangaId: string;
  chapterId: string;
  page?: number;
  mode?: ReaderMode;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function RootComponent() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  if (pathname.startsWith("/read")) {
    return <Outlet />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function NotFoundComponent() {
  return (
    <div className="min-h-screen bg-canvas px-4 py-16 text-ink">
      <div className="mx-auto max-w-xl">
        <EmptyState
          title="页面不存在"
          description="这个地址没有对应的页面。"
        >
          <a href="/">
            <Button variant="primary">回到发现</Button>
          </a>
        </EmptyState>
      </div>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "search",
  validateSearch: (search: Record<string, unknown>): SearchSearch => ({
    sourceId: typeof search.sourceId === "string" ? search.sourceId : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: SearchPage,
});

const mangaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "manga",
  validateSearch: (search: Record<string, unknown>): MangaSearch => ({
    sourceId: stringValue(search.sourceId),
    mangaId: stringValue(search.mangaId),
  }),
  component: MangaPage,
});

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "library",
  validateSearch: (search: Record<string, unknown>): LibrarySearch => ({
    tab: search.tab === "downloads" ? "downloads" : undefined,
  }),
  component: LibraryPage,
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "history",
  component: HistoryPage,
});

const downloadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "downloads",
  // Downloads now live as a tab of the library.
  beforeLoad: () => {
    throw redirect({ to: "/library", search: { tab: "downloads" } });
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  component: SettingsPage,
});

const readerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "read",
  validateSearch: (search: Record<string, unknown>): ReaderSearch => {
    const pageValue =
      typeof search.page === "number"
        ? search.page
        : typeof search.page === "string" && search.page
          ? Number(search.page)
          : undefined;
    const mode =
      search.mode === "single" ||
      search.mode === "double" ||
      search.mode === "webtoon"
        ? search.mode
        : undefined;
    return {
      sourceId: stringValue(search.sourceId),
      mangaId: stringValue(search.mangaId),
      chapterId: stringValue(search.chapterId),
      page:
        pageValue !== undefined && Number.isFinite(pageValue)
          ? Math.max(0, Math.trunc(pageValue))
          : undefined,
      mode,
    };
  },
  component: ReaderPage,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  searchRoute,
  mangaRoute,
  libraryRoute,
  historyRoute,
  downloadsRoute,
  settingsRoute,
  readerRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 15_000,
  scrollRestoration: true,
  // Animate page-to-page navigation only; search-param updates (filters,
  // reader chapter/page changes) swap instantly.
  defaultViewTransition: {
    types: ({ pathChanged }) => (pathChanged ? ["page"] : false),
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
