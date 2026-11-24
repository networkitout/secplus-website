import { useEffect, useId, useRef, useState } from 'react';

// The scenario lies across the top (below the `lg` breakpoint) of a screen that is at most 700 px high.
const SMALL_AND_SHORT = '(max-width: 1023px) and (max-height: 700px)';

/**
 * The scenario stays in view while the steps are worked through: beside them on a wide screen, across the
 * top on a narrow one, where it scrolls within a limited height and can be folded away.
 */
export function Scenario({ text }: { text: string }) {
  // Across the top of a short screen it would take about half of it, so there it starts folded: the bar
  // with "Show scenario" stays in view, one press away. Everywhere else it starts open, to be read first.
  const [open, setOpen] = useState(() => !(typeof window.matchMedia === 'function' && window.matchMedia(SMALL_AND_SHORT).matches));
  const [scrolls, setScrolls] = useState(false);
  const box = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const panelId = useId();

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const measure = () => {
      // Across the top it covers what scrolls under it, so anything brought into view (a focused
      // control, for one) must stop below it. Beside the steps it covers nothing.
      const acrossTop = getComputedStyle(el).top === '0px';
      root.style.scrollPaddingTop = acrossTop ? `${el.offsetHeight + 8}px` : '';
      // Text that scrolls within the box must be reachable by keyboard.
      setScrolls(panel.current !== null && panel.current.scrollHeight > panel.current.clientHeight + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.scrollPaddingTop = '';
    };
  }, []);

  return (
    <section
      ref={box}
      aria-labelledby={headingId}
      className="sticky top-0 z-10 -mx-4 border-b border-border bg-bg px-4 py-3 lg:top-4 lg:mx-0 lg:rounded-lg lg:border lg:bg-surface lg:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="font-mono text-sm uppercase tracking-wide text-accent">
          Scenario
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent lg:hidden"
        >
          {open ? 'Hide scenario' : 'Show scenario'}
        </button>
      </div>
      <div
        id={panelId}
        ref={panel}
        {...(scrolls && { tabIndex: 0, role: 'group', 'aria-label': 'Scenario text' })}
        className={`mt-2 max-h-[30vh] overflow-y-auto rounded-sm lg:max-h-[calc(100vh-7rem)] ${open ? '' : 'hidden lg:block'}`}
      >
        <p className="whitespace-pre-line">{text}</p>
      </div>
    </section>
  );
}
