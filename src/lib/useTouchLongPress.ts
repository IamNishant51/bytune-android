/**
 * useTouchLongPress — synthesizes contextmenu events on touch devices.
 *
 * Desktop rows listen for `onContextMenu` (right-click). Touch devices have no
 * right click, so this hook detects a 450ms stationary touch hold and dispatches
 * a synthetic `contextmenu` MouseEvent on the target element.
 *
 * When triggered, it suppresses the subsequent pointerup, touchend, and click events
 * so releasing the finger does not accidentally trigger the row's tap action
 * or dismiss the newly opened sheet.
 */
import { useEffect } from "react";

export function useTouchLongPress(): void {
  useEffect(() => {
    let timer: number | null = null;
    let startX = 0;
    let startY = 0;
    let targetEl: HTMLElement | null = null;
    let suppressUntil = 0;

    const clear = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      targetEl = null;
    };

    const shouldSuppress = () => Date.now() < suppressUntil;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        clear();
        return;
      }
      const touch = e.touches[0];
      const target = touch.target as HTMLElement | null;
      if (!target || target.closest("[data-nolongpress], input, textarea, select, .mobile-sheet, .mobile-nav, .mobile-topbar, .mobile-player")) {
        clear();
        return;
      }

      startX = touch.clientX;
      startY = touch.clientY;
      targetEl = target;

      timer = window.setTimeout(() => {
        if (!targetEl) return;
        suppressUntil = Date.now() + 650;
        try {
          navigator.vibrate?.(40);
        } catch {
          // ignore vibration errors
        }

        const ev = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: startX,
          clientY: startY,
          button: 2,
          buttons: 2,
        });
        targetEl.dispatchEvent(ev);
        clear();
      }, 450);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!targetEl || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - startX);
      const dy = Math.abs(touch.clientY - startY);
      if (dx > 10 || dy > 10) {
        clear();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (shouldSuppress()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      clear();
    };

    const onPointerUpCapture = (e: PointerEvent) => {
      if (shouldSuppress()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    const onClickCapture = (e: MouseEvent) => {
      if (shouldSuppress()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        suppressUntil = 0;
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, true);
    window.addEventListener("touchcancel", onTouchEnd, true);
    window.addEventListener("pointerup", onPointerUpCapture, true);
    window.addEventListener("click", onClickCapture, true);

    return () => {
      clear();
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd, true);
      window.removeEventListener("touchcancel", onTouchEnd, true);
      window.removeEventListener("pointerup", onPointerUpCapture, true);
      window.removeEventListener("click", onClickCapture, true);
    };
  }, []);
}
