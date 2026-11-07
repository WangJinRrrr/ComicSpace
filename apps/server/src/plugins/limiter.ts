function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Small FIFO limiter used per plugin to avoid hammering a source. */
export class PluginLimiter {
  private active = 0;
  private lastStart = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    readonly maxConcurrency: number,
    readonly minIntervalMs: number,
  ) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;

    const wait = this.lastStart + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastStart = Date.now();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      const next = this.waiters.shift();
      next?.();
    };
  }
}
