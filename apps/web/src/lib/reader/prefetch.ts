/**
 * Keeps a small pool of prefetched page images alive across page turns.
 *
 * The previous inline effect created images per turn and cleared `src` in its
 * cleanup, which cancelled loads that were still in flight. This keeps them
 * until the pool is trimmed or the chapter is left.
 *
 * Scheduling is priority based (urgent -> ahead -> behind -> idle) so a quick
 * page turn jumps the queue instead of waiting behind read-ahead work. A failed
 * image gets one jittered retry; a page that is still needed after that is
 * retried again only when it becomes urgent.
 */

export type PrefetchPriority = "urgent" | "ahead" | "behind" | "idle";

const PRIORITY_ORDER: PrefetchPriority[] = [
  "urgent",
  "ahead",
  "behind",
  "idle",
];

const PRIORITY_RANK: Record<PrefetchPriority, number> = {
  urgent: 0,
  ahead: 1,
  behind: 2,
  idle: 3,
};

export interface PrefetchWindowUrls {
  urgent?: string[];
  ahead?: string[];
  behind?: string[];
  idle?: string[];
}

export interface ImagePrefetcherOptions {
  concurrency?: number;
  limit?: number;
  /** Total tries per image, including the first one. */
  maxAttempts?: number;
}

interface PrefetchItem {
  image: HTMLImageElement;
  priority: PrefetchPriority;
  state: "queued" | "loading" | "loaded" | "waiting" | "failed";
  attempts: number;
}

export class ImagePrefetcher {
  private readonly items = new Map<string, PrefetchItem>();
  private readonly queues: Record<PrefetchPriority, string[]> = {
    urgent: [],
    ahead: [],
    behind: [],
    idle: [],
  };
  private readonly retryTimers = new Map<string, number>();
  private readonly maxAttempts: number;
  private active = 0;
  private concurrency: number;
  private limit: number;
  private enabled = true;
  private desired = new Set<string>();

  constructor(options: ImagePrefetcherOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.limit = Math.max(4, options.limit ?? 24);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  }

  /** Apply the reader's network policy without dropping already-loaded pages. */
  setPolicy(policy: {
    enabled?: boolean;
    concurrency?: number;
    poolLimit?: number;
  }): void {
    if (policy.enabled === false) {
      this.enabled = false;
      this.clear();
      return;
    }
    if (policy.enabled === true) this.enabled = true;
    if (typeof policy.concurrency === "number") {
      this.concurrency = Math.max(1, Math.floor(policy.concurrency));
    }
    if (typeof policy.poolLimit === "number") {
      this.limit = Math.max(4, Math.floor(policy.poolLimit));
    }
    this.trim();
    this.pump();
  }

  /**
   * Replace the current priority window. URLs outside it stay loaded (so a
   * back-flip is still instant) but are the first candidates for eviction.
   */
  scheduleWindow(window: PrefetchWindowUrls): void {
    if (!this.enabled) return;
    this.desired = new Set();
    for (const priority of PRIORITY_ORDER) {
      for (const url of window[priority] ?? []) {
        if (!url) continue;
        this.desired.add(url);
        this.ensure(url, priority);
      }
    }
    this.trim();
    this.pump();
  }

  /** Queue extra URLs (next chapter, idle read-ahead) without replacing the window. */
  schedule(urls: string[], priority: PrefetchPriority = "ahead"): void {
    if (!this.enabled) return;
    for (const url of urls) {
      if (!url) continue;
      this.desired.add(url);
      this.ensure(url, priority);
    }
    this.trim();
    this.pump();
  }

  clear(): void {
    for (const url of [...this.items.keys()]) this.drop(url);
    this.items.clear();
    for (const priority of PRIORITY_ORDER) this.queues[priority].length = 0;
    for (const timer of this.retryTimers.values()) window.clearTimeout(timer);
    this.retryTimers.clear();
    this.desired.clear();
    this.active = 0;
  }

  private ensure(url: string, priority: PrefetchPriority): void {
    const existing = this.items.get(url);
    if (existing) {
      if (existing.state === "failed") {
        // Give a page a fresh chance when the reader actually reaches it.
        if (priority !== "urgent") return;
        existing.state = "queued";
        existing.attempts = 0;
        existing.priority = priority;
        this.enqueue(url, priority);
        return;
      }
      if (existing.priority !== priority) {
        existing.priority = priority;
        if (existing.state === "queued") this.enqueue(url, priority);
      }
      return;
    }

    const image = new Image();
    image.decoding = "async";
    // Hint to the network stack; the visible page keeps priority.
    (image as HTMLImageElement & { fetchPriority?: string }).fetchPriority =
      priority === "urgent" ? "high" : "low";
    this.items.set(url, {
      image,
      priority,
      state: "queued",
      attempts: 0,
    });
    this.enqueue(url, priority);
  }

  private enqueue(url: string, priority: PrefetchPriority): void {
    this.removeFromQueues(url);
    this.queues[priority].push(url);
  }

  private removeFromQueues(url: string): void {
    for (const priority of PRIORITY_ORDER) {
      const queue = this.queues[priority];
      const index = queue.indexOf(url);
      if (index >= 0) queue.splice(index, 1);
    }
  }

  private takeNext(): string | null {
    for (const priority of PRIORITY_ORDER) {
      const queue = this.queues[priority];
      while (queue.length > 0) {
        const url = queue.shift();
        if (!url) continue;
        const item = this.items.get(url);
        if (item && item.state === "queued") return url;
      }
    }
    return null;
  }

  private pump(): void {
    if (!this.enabled) return;
    while (this.active < this.concurrency) {
      const url = this.takeNext();
      if (!url) return;
      this.start(url);
    }
  }

  private start(url: string): void {
    const item = this.items.get(url);
    if (!item || item.state !== "queued") return;
    item.state = "loading";
    this.active += 1;

    item.image.onload = () => {
      item.state = "loaded";
      this.active = Math.max(0, this.active - 1);
      // Decode while the page is still off-screen: turning to it then paints
      // from the decoded frame instead of paying the decode on the turn.
      void item.image.decode?.().catch(() => undefined);
      this.trim();
      this.pump();
    };
    item.image.onerror = () => {
      item.state = "waiting";
      this.active = Math.max(0, this.active - 1);
      item.attempts += 1;
      if (item.attempts < this.maxAttempts) {
        // Image CDNs reset connections under load. Back off with jitter so a
        // burst of failures does not retry in lockstep.
        const delay = 500 * 2 ** (item.attempts - 1) + Math.random() * 300;
        const timer = window.setTimeout(() => {
          this.retryTimers.delete(url);
          const current = this.items.get(url);
          if (!current) return;
          current.state = "queued";
          this.enqueue(url, current.priority);
          this.pump();
        }, delay);
        this.retryTimers.set(url, timer);
      } else {
        item.state = "failed";
      }
      this.trim();
      this.pump();
    };
    item.image.src = url;
  }

  private trim(): void {
    while (this.items.size > this.limit) {
      let victim: string | null = null;

      // Pages outside the current window are the cheapest to lose.
      for (const [url, item] of this.items) {
        if (!this.desired.has(url) && item.state !== "loading") {
          victim = url;
          break;
        }
      }

      // Then the least urgent, oldest item. Loading items are left alone so a
      // trim cannot cancel work the reader is already waiting on.
      if (!victim) {
        let bestRank = -1;
        for (const [url, item] of this.items) {
          if (item.state === "loading") continue;
          const rank = PRIORITY_RANK[item.priority];
          if (rank > bestRank) {
            bestRank = rank;
            victim = url;
          }
        }
      }

      if (!victim) break;
      this.drop(victim);
    }
  }

  private drop(url: string): void {
    const item = this.items.get(url);
    if (!item) return;
    this.items.delete(url);
    this.removeFromQueues(url);
    const timer = this.retryTimers.get(url);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.retryTimers.delete(url);
    }
    item.image.onload = null;
    item.image.onerror = null;
    if (item.state === "loading") {
      this.active = Math.max(0, this.active - 1);
    }
    item.image.src = "";
  }
}
