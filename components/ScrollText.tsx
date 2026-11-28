import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';

interface ScrollTextProps {
  words: string[];
  paragraphStarts: Set<number>;
  index: number;
  /** ms per word while playing; 0 when paused (snaps instead of gliding) */
  glideMs: number;
  className: string;
  textClass: string;
  /** CSS colour for the word being read */
  accentColor: string;
  onClick: () => void;
}

const VISIBLE_LINES = 7; // current line + 3 above + 3 below, faded at the edges
const WINDOW_BEFORE = 400;
const WINDOW_AFTER = 900;
const WINDOW_STEP = 200;

/**
 * Auto-scrolling text: the line being read sits in the middle, neighbouring
 * lines fade to darkness, and the page glides up at the reading speed.
 */
const ScrollText: React.FC<ScrollTextProps> = ({ words, paragraphStarts, index, glideMs, className, textClass, accentColor, onClick }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const [offset, setOffset] = useState(0);
  const [animate, setAnimate] = useState(false);

  // Render only a window of the book; it moves in steps so the DOM stays stable while reading.
  const start = Math.max(0, Math.floor(index / WINDOW_STEP) * WINDOW_STEP - WINDOW_BEFORE);
  const end = Math.min(words.length, start + WINDOW_BEFORE + WINDOW_AFTER + WINDOW_STEP);
  const lastStart = useRef(start);

  const content = useMemo(() => {
    wordRefs.current.clear();
    const nodes: React.ReactNode[] = [];
    for (let i = start; i < end; i++) {
      if (i !== start && paragraphStarts.has(i)) nodes.push(<span key={`p${i}`} className="block h-[0.8em]" />);
      const w = words[i];
      const joinNext = /[\-‐‑–—]$/.test(w); // hyphen-split parts flow together
      nodes.push(
        <span key={i} data-i={i} ref={el => { if (el) wordRefs.current.set(i, el); }}>
          {w}{joinNext ? '' : ' '}
        </span>
      );
    }
    return nodes;
  }, [words, paragraphStarts, start, end]);

  useLayoutEffect(() => {
    const el = wordRefs.current.get(index);
    const column = columnRef.current;
    const viewport = viewportRef.current;
    if (!el || !column || !viewport) return;
    const lineHeight = viewport.clientHeight / VISIBLE_LINES;
    // Progress through the current line, so the page drifts smoothly instead of jumping per line.
    const frac = Math.min(1, el.offsetLeft / Math.max(1, column.clientWidth));
    const target = -(el.offsetTop + frac * lineHeight) + lineHeight * Math.floor(VISIBLE_LINES / 2);
    const windowMoved = lastStart.current !== start;
    lastStart.current = start;
    setAnimate(!windowMoved);
    setOffset(target);
  }, [index, start, content]);

  const transition = animate
    ? glideMs > 0 ? `transform ${glideMs}ms linear` : 'transform 200ms ease-out'
    : 'none';

  return (
    <div
      ref={viewportRef}
      onClick={onClick}
      className={`relative overflow-hidden select-none cursor-pointer ${className}`}
      style={{
        ['--rsvp-accent' as string]: accentColor,
        height: `${VISIBLE_LINES * 1.6}em`,
        lineHeight: 1.6,
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 38%, #000 62%, transparent 100%)',
        maskImage: 'linear-gradient(to bottom, transparent 0%, #000 38%, #000 62%, transparent 100%)',
      }}
    >
      <div
        ref={columnRef}
        className={textClass}
        style={{ transform: `translateY(${offset}px)`, transition, willChange: 'transform' }}
      >
        {content}
      </div>
      <HighlightStyle index={index} />
    </div>
  );
};

/** Colours the current word without re-rendering the whole text window. */
const HighlightStyle: React.FC<{ index: number }> = ({ index }) => (
  <style>{`[data-i="${index}"]{color:var(--rsvp-accent);}`}</style>
);

export default ScrollText;
