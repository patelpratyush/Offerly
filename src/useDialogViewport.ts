import { useEffect } from "react";

// Mobile keyboards can shrink/pan the visual viewport without resizing layout vh.
export function useDialogViewport(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    const revealFocusedField = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const field = document.activeElement;
        if (
          field instanceof HTMLElement &&
          field.matches("input,select,textarea") &&
          field.closest('[role="dialog"]')
        ) {
          field.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      });
    };
    const update = () => {
      root.style.setProperty(
        "--dialog-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      root.style.setProperty("--dialog-top", `${viewport?.offsetTop ?? 0}px`);
      // offsetLeft follows horizontal panning at browser zoom without disabling zoom.
      root.style.setProperty("--dialog-left", `${viewport?.offsetLeft ?? 0}px`);
      root.style.setProperty(
        "--dialog-width",
        `${viewport?.width ?? window.innerWidth}px`,
      );
      revealFocusedField();
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", revealFocusedField);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", revealFocusedField);
      for (const name of [
        "--dialog-height",
        "--dialog-top",
        "--dialog-left",
        "--dialog-width",
      ])
        root.style.removeProperty(name);
    };
  }, [active]);
}
