import { flushSync } from "react-dom";

type DocWithVT = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

const SHARED = "media";

function setName(el: Element | null | undefined, name: string) {
  if (el instanceof HTMLElement) el.style.viewTransitionName = name;
}

function inViewport(el: Element) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.width > 0;
}

/**
 * Run a React state change inside a View Transition. If `from`/`to` resolve to elements, the
 * first morphs into the second (thumbnail → player and back); everything else crossfades.
 * The browser snapshots and animates on the compositor, so this costs nothing per frame in JS.
 * Falls back to an instant update without support or with reduced motion.
 */
export function transition(
  update: () => void,
  opts: {
    from?: () => Element | null;
    to?: () => Element | null;
    /** Runs after React has committed the update (e.g. scroll restoration needs the new layout). */
    after?: () => void;
  } = {},
) {
  const doc = document as DocWithVT;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduce) {
    flushSync(update);
    opts.after?.();
    return;
  }

  const fromEl = opts.from?.();
  const morph = Boolean(fromEl && inViewport(fromEl));
  if (morph) setName(fromEl, SHARED);

  const vt = doc.startViewTransition(() => {
    if (morph) setName(fromEl, "");
    flushSync(update);
    opts.after?.();
    if (morph) {
      const toEl = opts.to?.();
      // Morph back only to a target the user can see; otherwise the plain crossfade reads better.
      if (toEl && inViewport(toEl)) setName(toEl, SHARED);
    }
  });

  vt.finished.finally(() => {
    document.querySelectorAll<HTMLElement>("[data-vt]").forEach((el) => setName(el, ""));
  });
}

/** Selector for a feed card's thumbnail, by item id. */
export const thumbSelector = (id: string) => `[data-vt="thumb"][data-vt-id="${CSS.escape(id)}"]`;
export const playerSelector = '[data-vt="player"]';
