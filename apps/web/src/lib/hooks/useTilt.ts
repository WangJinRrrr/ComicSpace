import { useCallback, useRef } from "react";

const MAX_TILT_DEG = 7;

/**
 * Pointer-driven 3D tilt for `.tilt` elements. Writes CSS variables directly
 * so moving the pointer never re-renders React. Mouse/pen only; touch input
 * keeps the flat card.
 */
export function useTilt<T extends HTMLElement>() {
  const frame = useRef(0);

  const onPointerMove = useCallback((event: React.PointerEvent<T>) => {
    if (event.pointerType === "touch") return;
    const node = event.currentTarget;
    const { clientX, clientY } = event;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const rect = node.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      node.style.setProperty("--ry", `${(x - 0.5) * 2 * MAX_TILT_DEG}deg`);
      node.style.setProperty("--rx", `${(0.5 - y) * 2 * MAX_TILT_DEG}deg`);
      node.style.setProperty("--mx", `${x * 100}%`);
      node.style.setProperty("--my", `${y * 100}%`);
      node.dataset.active = "true";
    });
  }, []);

  const onPointerLeave = useCallback((event: React.PointerEvent<T>) => {
    const node = event.currentTarget;
    cancelAnimationFrame(frame.current);
    node.style.setProperty("--rx", "0deg");
    node.style.setProperty("--ry", "0deg");
    node.dataset.active = "false";
  }, []);

  return { onPointerMove, onPointerLeave };
}
