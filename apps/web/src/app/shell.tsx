import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Compass, History, Library, Search, Settings } from "lucide-react";
import { cn } from "../lib/cn";
import { useLocalStorage } from "../lib/hooks/useLocalStorage";
import { useMediaQuery } from "../lib/hooks/useMediaQuery";
import {
  SearchPanel,
  SearchPanelContext,
  type SearchPanelState,
} from "../components/SearchPanel";

const navItems = [
  { to: "/", label: "发现", icon: Compass },
  { to: "/library", label: "书架", icon: Library },
  { to: "/history", label: "历史", icon: History },
] as const;

const settingsItem = { to: "/settings", label: "设置", icon: Settings } as const;

function isActive(to: string, pathname: string) {
  if (to === "/") return pathname === "/";
  if (to === "/library") {
    return pathname.startsWith("/library") || pathname.startsWith("/downloads");
  }
  return pathname.startsWith(to);
}

function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      fill="none"
    >
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" className="fill-ink" />
      <circle cx="16" cy="16" r="9" className="stroke-canvas/30" strokeWidth="1" />
      <path
        d="M21.6 10.4a8 8 0 1 0 0 11.2"
        className="stroke-accent-soft"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2" className="fill-canvas" />
    </svg>
  );
}

function RailLink({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: typeof Compass;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative grid size-11 place-items-center rounded-xl transition-colors",
        active ? "text-accent" : "text-muted hover:text-ink",
      )}
    >
      {active ? (
        <span
          className="absolute inset-0 rounded-xl bg-surface shadow-soft ring-1 ring-line"
          style={{ viewTransitionName: "cs-nav-pill" }}
          aria-hidden="true"
        />
      ) : (
        <span
          className="absolute inset-0 rounded-xl transition-colors group-hover:bg-surface-3/60"
          aria-hidden="true"
        />
      )}
      <Icon
        className="relative size-5 transition-transform duration-300 ease-spring group-hover:-translate-y-px"
        aria-hidden="true"
      />
      <span
        className="rail-tip absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs font-medium text-canvas shadow-lift"
        aria-hidden="true"
      >
        {label}
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const wide = useMediaQuery("(min-width: 1024px)");
  const [docked, setDocked] = useLocalStorage("comicspace:searchDocked", true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [focusToken, setFocusToken] = useState(0);
  const open = wide ? docked : drawerOpen;

  const openSearch = useCallback(() => {
    if (wide) setDocked(true);
    else setDrawerOpen(true);
    setFocusToken((value) => value + 1);
  }, [wide, setDocked]);

  // Collapsing is explicit on wide screens; following a result only closes
  // the overlay drawer on narrow ones.
  const closeSearch = useCallback(() => {
    if (wide) setDocked(false);
    else setDrawerOpen(false);
  }, [wide, setDocked]);

  const dismissOverlay = useCallback(() => {
    if (!wide) setDrawerOpen(false);
  }, [wide]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if ((event.key === "k" && (event.ctrlKey || event.metaKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openSearch]);

  const searchState = useMemo<SearchPanelState>(
    () => ({
      open,
      term,
      setTerm,
      openSearch,
      closeSearch,
      dismissOverlay,
      focusToken,
    }),
    [open, term, openSearch, closeSearch, dismissOverlay, focusToken],
  );

  return (
    <SearchPanelContext.Provider value={searchState}>
      <div className="min-h-screen text-ink">
        <aside
          className="glass fixed inset-y-0 left-0 z-30 hidden w-16 flex-col items-center border-r border-line py-4 md:flex"
          style={{ viewTransitionName: "cs-sidebar" }}
        >
          <Link to="/" className="mb-8" aria-label="ComicSpace">
            <LogoMark className="size-9" />
          </Link>
          <nav className="flex flex-col items-center gap-1.5" aria-label="主导航">
            {navItems.map((item) => (
              <RailLink
                key={item.to}
                {...item}
                active={isActive(item.to, pathname)}
              />
            ))}
          </nav>
          <div className="mt-auto flex flex-col items-center gap-3">
            <RailLink
              {...settingsItem}
              active={isActive(settingsItem.to, pathname)}
            />
            <span
              className="size-1.5 rounded-full bg-signal"
              title="本地运行"
              aria-label="本地运行"
            />
          </div>
        </aside>

        <div className={cn("md:pl-16", wide && open && "lg:pr-80")}>
          <header
            className="glass sticky top-0 z-20 flex items-center justify-between border-b border-line px-4 py-2.5 md:hidden"
            style={{ viewTransitionName: "cs-topbar" }}
          >
            <Link to="/" className="flex items-center gap-2.5" aria-label="ComicSpace">
              <LogoMark className="size-8" />
            </Link>
          </header>

          <main className="mx-auto w-full max-w-7xl px-gutter pb-28 pt-6 md:pb-16 md:pt-8">
            {children}
          </main>
        </div>

        {wide ? (
          open ? (
            <SearchPanel className="fixed inset-y-0 right-0 z-30 w-80" />
          ) : (
            <button
              type="button"
              onClick={openSearch}
              aria-label="展开搜索栏"
              title="搜索 (Ctrl+K)"
              className="glass press fixed right-4 top-4 z-30 grid size-11 place-items-center rounded-full text-ink shadow-lift ring-1 ring-line hover:text-accent"
            >
              <Search className="size-5" aria-hidden="true" />
            </button>
          )
        ) : drawerOpen ? (
          <div className="fixed inset-0 z-40">
            <button
              type="button"
              className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
              aria-label="关闭搜索"
              onClick={() => setDrawerOpen(false)}
            />
            <SearchPanel className="absolute inset-y-0 right-0 w-[min(22rem,calc(100vw-2.5rem))] shadow-float" />
          </div>
        ) : (
          <button
            type="button"
            onClick={openSearch}
            aria-label="搜索"
            title="搜索"
            className="glass press fixed right-4 top-4 z-30 hidden size-11 place-items-center rounded-full text-ink shadow-lift ring-1 ring-line hover:text-accent md:grid"
          >
            <Search className="size-5" aria-hidden="true" />
          </button>
        )}

        <nav
          className="glass fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 rounded-full border border-line p-1.5 shadow-float md:hidden"
          style={{ viewTransitionName: "cs-tabbar" }}
          aria-label="底部导航"
        >
          {[...navItems, settingsItem].map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to, pathname);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "press relative grid place-items-center rounded-full py-2.5",
                  active ? "text-canvas" : "text-muted",
                  item.to === "/settings" && "order-first",
                )}
              >
                {active ? (
                  <span
                    className="absolute inset-0 rounded-full bg-ink"
                    style={{ viewTransitionName: "cs-tab-pill" }}
                    aria-hidden="true"
                  />
                ) : null}
                <Icon className="relative size-5" aria-hidden="true" />
              </Link>
            );
          })}
          <button
            type="button"
            onClick={openSearch}
            aria-label="搜索"
            className="press relative grid place-items-center rounded-full py-2.5 text-muted"
          >
            <Search className="relative size-5" aria-hidden="true" />
          </button>
        </nav>
      </div>
    </SearchPanelContext.Provider>
  );
}
