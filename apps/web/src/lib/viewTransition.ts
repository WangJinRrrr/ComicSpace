/**
 * Shared-element helpers for the router's view transitions.
 *
 * A cover only carries `view-transition-name: cs-cover` while it is the one
 * being navigated from, so grids never end up with duplicate names. The
 * detail page names its own cover statically.
 */
export const COVER_TRANSITION_NAME = "cs-cover";

export function tagForTransition(
  node: HTMLElement | null | undefined,
  name = COVER_TRANSITION_NAME,
) {
  if (!node || typeof document === "undefined") return;
  if (typeof document.startViewTransition !== "function") return;
  node.style.viewTransitionName = name;
  // Long enough for the router to snapshot the old page; short enough that a
  // cancelled navigation doesn't leave a stray name behind.
  window.setTimeout(() => {
    node.style.viewTransitionName = "";
  }, 600);
}

/**
 * Cover + title handed from a card to the detail page, so the detail page can
 * render the morph target before its own query resolves.
 */
type CoverHandoff = { key: string; coverUrl?: string; title: string };
let pendingHandoff: CoverHandoff | null = null;

export function setCoverHandoff(handoff: CoverHandoff) {
  pendingHandoff = handoff;
}

export function readCoverHandoff(key: string): CoverHandoff | null {
  return pendingHandoff?.key === key ? pendingHandoff : null;
}

export function mangaKey(sourceId: string, mangaId: string) {
  return `${sourceId}:${mangaId}`;
}
