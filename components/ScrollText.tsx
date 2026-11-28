import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { tokenize } from '../services/tokenize';

interface ScrollTextProps {
  content: string;
  /** Current word index (shared numbering with the word-flash mode) */
  index: number;
  wpm: number;
  playing: boolean;
  onIndexChange: (index: number) => void;
  onEnd: () => void;
  className: string;
  textClass: string;
  onClick: () => void;
}

interface Para { text: string; start: number; count: number }

const VISIBLE_LINES = 7; // the line being read + 3 above + 3 below, faded at the edges
const CENTER_LINE = Math.floor(VISIBLE_LINES / 2);

const buildParas = (content: string): Para[] => {
  let start = 0;
  const paras: Para[] = [];
  for (const p of content.split(/\n\s*\n/)) {
    const count = tokenize(p).length;
    if (!count) continue;
    paras.push({ text: p.replace(/\s+/g, ' ').trim(), start, count });
    start += count;
  }
  return paras;
};

/**
 * Auto-scrolling text. The page moves continuously at one constant speed derived
 * from the WPM, driven by requestAnimationFrame and written straight to the
 * transform so React never re-renders mid-scroll.
 */
const ScrollText: React.FC<ScrollTextProps> = ({ content, index, wpm, playing, onIndexChange, onEnd, className, textClass, onClick }) => {
  const paras = useMemo(() => buildParas(content), [content]);
  const total = paras.length ? paras[paras.length - 1].start + paras[paras.length - 1].count : 0;

  const viewportRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const paraEls = useRef<HTMLParagraphElement[]>([]);
  const pos = useRef(0);          // content y-coordinate sitting on the centre line
  const paraIdx = useRef(0);      // paragraph containing pos (search hint)
  const reported = useRef(index); // last index we told the parent about
  const callbacks = useRef({ onIndexChange, onEnd });
  callbacks.current = { onIndexChange, onEnd };

  const lineHeight = () => (viewportRef.current?.clientHeight ?? 0) / VISIBLE_LINES;
  const apply = () => {
    if (columnRef.current) columnRef.current.style.transform = `translate3d(0, ${lineHeight() * CENTER_LINE - pos.current}px, 0)`;
  };
  // Average pixels per word over the whole book: a single constant scroll speed, so it never surges.
  const pxPerWord = () => {
    const lastEl = paraEls.current[paras.length - 1];
    return lastEl ? (lastEl.offsetTop + lastEl.offsetHeight) / Math.max(1, total) : 0;
  };

  const findPara = (i: number) => {
    let lo = 0, hi = paras.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (paras[mid].start <= i) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  const posForIndex = (i: number) => {
    const k = findPara(i);
    const el = paraEls.current[k];
    if (!el) return 0;
    paraIdx.current = k;
    return el.offsetTop + ((i - paras[k].start) / paras[k].count) * el.offsetHeight;
  };

  const indexForPos = () => {
    const els = paraEls.current;
    let k = paraIdx.current;
    while (k + 1 < paras.length && els[k + 1].offsetTop <= pos.current) k++;
    while (k > 0 && els[k].offsetTop > pos.current) k--;
    paraIdx.current = k;
    const frac = Math.min(1, Math.max(0, (pos.current - els[k].offsetTop) / Math.max(1, els[k].offsetHeight)));
    return Math.min(total - 1, paras[k].start + Math.floor(frac * paras[k].count));
  };

  const jumpTo = (i: number) => {
    pos.current = posForIndex(i);
    reported.current = i;
    apply();
  };

  // Position on mount, and re-anchor when the text or its size changes.
  useLayoutEffect(() => { jumpTo(reported.current); }, [paras, className]);

  // Seeks from outside (progress bar, restart) jump straight there.
  useLayoutEffect(() => { if (index !== reported.current) jumpTo(index); }, [index]);

  useEffect(() => {
    const onResize = () => jumpTo(reported.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [paras]);

  // The scroll loop
  useEffect(() => {
    if (!playing || !paras.length) return;
    let raf = 0;
    let last = performance.now();
    let lastReport = 0;
    let velocity = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const target = (wpm / 60) * pxPerWord();
      // Ease in from a stop or after a speed change; otherwise perfectly constant
      velocity += (target - velocity) * Math.min(1, dt * 4);
      pos.current += velocity * dt;
      apply();

      const i = indexForPos();
      if (i !== reported.current && now - lastReport > 150) {
        reported.current = i;
        lastReport = now;
        callbacks.current.onIndexChange(i);
      }
      const lastEl = paraEls.current[paras.length - 1];
      if (pos.current >= lastEl.offsetTop + lastEl.offsetHeight) {
        reported.current = total - 1;
        callbacks.current.onIndexChange(total - 1);
        callbacks.current.onEnd();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, wpm, paras]);

  const rendered = useMemo(() => {
    paraEls.current = [];
    return paras.map((p, k) => (
      <p key={k} ref={el => { if (el) paraEls.current[k] = el; }} className="mb-[0.8em]">{p.text}</p>
    ));
  }, [paras]);

  return (
    <div
      ref={viewportRef}
      onClick={onClick}
      className={`relative overflow-hidden select-none cursor-pointer ${className}`}
      style={{
        height: `${VISIBLE_LINES * 1.6}em`,
        lineHeight: 1.6,
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 38%, #000 62%, transparent 100%)',
        maskImage: 'linear-gradient(to bottom, transparent 0%, #000 38%, #000 62%, transparent 100%)',
      }}
    >
      <div ref={columnRef} className={`relative ${textClass}`} style={{ willChange: 'transform' }}>
        {rendered}
      </div>
    </div>
  );
};

export default ScrollText;
