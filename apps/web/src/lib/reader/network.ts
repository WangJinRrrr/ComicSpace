import { useEffect, useState } from "react";

/**
 * Network Information API (Chromium only). Firefox/Safari leave it undefined,
 * which is treated as a normal connection rather than no connection.
 */
export interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

export type PrefetchReason =
  | "default"
  | "offline"
  | "save-data"
  | "slow"
  | "metered"
  | "fast";

export interface ReaderPrefetchPolicy {
  /** Whether to prefetch at all. Offline and save-data disable it. */
  enabled: boolean;
  /** Concurrent prefetch requests. */
  concurrency: number;
  /** Multiplier applied to the per-mode "ahead" window (0 disables it). */
  windowScale: number;
  /** Keep loading further ahead once the current page has been idle. */
  readAhead: boolean;
  /** Decoded images kept alive by the prefetcher. */
  poolLimit: number;
  reason: PrefetchReason;
}

const DEFAULT_POLICY: ReaderPrefetchPolicy = {
  enabled: true,
  concurrency: 4,
  windowScale: 1,
  readAhead: true,
  poolLimit: 24,
  reason: "default",
};

/**
 * Turns a browser connection hint into prefetch settings.
 *
 * The defaults match what the reader used before: four parallel prefetches and
 * the full per-mode window. Slow or metered links get a shorter window, fewer
 * parallel requests and no idle read-ahead, so paging stays responsive without
 * spending the link's remaining bandwidth on pages the reader may never reach.
 */
export function resolvePrefetchPolicy(input: {
  online?: boolean;
  connection?: NetworkInformationLike | null;
} = {}): ReaderPrefetchPolicy {
  if (input.online === false) {
    return {
      enabled: false,
      concurrency: 1,
      windowScale: 0,
      readAhead: false,
      poolLimit: 8,
      reason: "offline",
    };
  }

  const connection = input.connection ?? null;
  if (connection?.saveData) {
    return {
      enabled: false,
      concurrency: 1,
      windowScale: 0,
      readAhead: false,
      poolLimit: 8,
      reason: "save-data",
    };
  }

  const effectiveType = connection?.effectiveType ?? "";
  const downlink =
    typeof connection?.downlink === "number" && connection.downlink > 0
      ? connection.downlink
      : null;

  if (effectiveType === "slow-2g" || effectiveType === "2g" || (downlink !== null && downlink < 0.5)) {
    return {
      enabled: true,
      concurrency: 1,
      windowScale: 0.35,
      readAhead: false,
      poolLimit: 12,
      reason: "slow",
    };
  }

  if (effectiveType === "3g" || (downlink !== null && downlink < 2.5)) {
    return {
      enabled: true,
      concurrency: 2,
      windowScale: 0.6,
      readAhead: false,
      poolLimit: 18,
      reason: "metered",
    };
  }

  if (
    (effectiveType === "4g" && downlink !== null && downlink >= 10) ||
    (!effectiveType && downlink !== null && downlink >= 10)
  ) {
    return {
      enabled: true,
      concurrency: 6,
      windowScale: 1.25,
      readAhead: true,
      poolLimit: 32,
      reason: "fast",
    };
  }

  return { ...DEFAULT_POLICY };
}

type NavigatorWithConnection = Navigator & {
  connection?: NetworkInformationLike;
  mozConnection?: NetworkInformationLike;
  webkitConnection?: NetworkInformationLike;
};

function connectionOf(): NetworkInformationLike | null {
  if (typeof navigator === "undefined") return null;
  const candidate = navigator as NavigatorWithConnection;
  return (
    candidate.connection ??
    candidate.mozConnection ??
    candidate.webkitConnection ??
    null
  );
}

/** Current policy from the live browser state. */
export function currentPrefetchPolicy(): ReaderPrefetchPolicy {
  return resolvePrefetchPolicy({
    online: typeof navigator === "undefined" ? undefined : navigator.onLine,
    connection: connectionOf(),
  });
}

/**
 * Re-resolves the prefetch policy when the browser goes offline, the user
 * turns on data saver, or the connection quality changes.
 */
export function usePrefetchPolicy(): ReaderPrefetchPolicy {
  const [policy, setPolicy] = useState<ReaderPrefetchPolicy>(() =>
    currentPrefetchPolicy(),
  );

  useEffect(() => {
    const update = () => setPolicy(currentPrefetchPolicy());
    const connection = connectionOf();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    connection?.addEventListener?.("change", update);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      connection?.removeEventListener?.("change", update);
    };
  }, []);

  return policy;
}
