import { useCallback, useState } from "react";

export function useLocalStorage<T>(
  key: string,
  fallback: T,
): [T, (value: T) => void] {
  const [current, setCurrent] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  });

  const setValue = useCallback(
    (value: T) => {
      setCurrent(value);
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Storage can be unavailable in private windows; keep in memory.
      }
    },
    [key],
  );

  return [current, setValue];
}
