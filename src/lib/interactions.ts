/**
 * Field Office interaction layer. Purely presentational and global:
 *  - spotlight: cards light up under the pointer (sets --mx / --my);
 *  - magnet: primary buttons lean a few pixels toward the pointer;
 *  - reveal: [data-reveal] blocks slide in once when scrolled into view.
 * Never changes text, focus or layout; all of it is skipped for coarse
 * pointers and prefers-reduced-motion.
 */
const SPOT = [
  "[data-spot]",
  ".brief-signal",
  ".today-card",
  ".application-card",
  ".job-card",
  ".panel",
  ".fo-card",
].join(",");
const MAGNET = ".primary, .fo-button";

let installed = false;

export function installInteractions() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

  let frame = 0;
  let last: PointerEvent | null = null;
  let magnet: HTMLElement | null = null;

  const release = () => {
    if (!magnet) return;
    magnet.style.removeProperty("--tx");
    magnet.style.removeProperty("--ty");
    magnet = null;
  };

  const apply = () => {
    frame = 0;
    const event = last;
    if (!event || !(event.target instanceof Element)) return;
    const spot = event.target.closest<HTMLElement>(SPOT);
    if (spot) {
      const box = spot.getBoundingClientRect();
      spot.style.setProperty("--mx", `${event.clientX - box.left}px`);
      spot.style.setProperty("--my", `${event.clientY - box.top}px`);
    }
    if (calm.matches) return release();
    const button = event.target.closest<HTMLElement>(MAGNET);
    if (button !== magnet) release();
    if (button && !(button as HTMLButtonElement).disabled) {
      const box = button.getBoundingClientRect();
      const dx = (event.clientX - (box.left + box.width / 2)) / box.width;
      const dy = (event.clientY - (box.top + box.height / 2)) / box.height;
      button.style.setProperty("--tx", `${(dx * 4).toFixed(2)}px`);
      button.style.setProperty("--ty", `${(dy * 3).toFixed(2)}px`);
      magnet = button;
    }
  };

  document.addEventListener(
    "pointermove",
    (event) => {
      if (!fine.matches || event.pointerType !== "mouse") return;
      last = event;
      if (!frame) frame = requestAnimationFrame(apply);
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", release, { passive: true });

  // Scroll reveal: transform only, so content is always readable even
  // before it animates (and for screenshots, crawlers and assistive tech).
  if (!("IntersectionObserver" in window)) return;
  const seen = new WeakSet<Element>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
  );
  const scan = () => {
    document.querySelectorAll("[data-reveal]").forEach((node) => {
      if (seen.has(node)) return;
      seen.add(node);
      if (calm.matches) node.classList.add("is-in");
      else observer.observe(node);
    });
  };
  let pending = 0;
  const schedule = () => {
    if (!pending)
      pending = requestAnimationFrame(() => {
        pending = 0;
        scan();
      });
  };
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  scan();
}
