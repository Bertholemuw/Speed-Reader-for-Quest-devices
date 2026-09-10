import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '../logger.ts';

const log = logger('pdf');

/**
 * Low-level page extraction.
 *
 * Two things come out of a page and both matter. The text items give the
 * letters, clues and word lists. The filled rectangles give the puzzle's
 * *structure*: in a Take 5 grid a black square is a block, and a tinted square
 * is one of the shaded cells that spell out the prize answer. Without the
 * rectangles you can read a crossword but you cannot tell which letters to post.
 */

export interface TextItem {
  text: string;
  /** PDF user space, origin bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
}

export interface FilledRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1 each. */
  colour: { r: number; g: number; b: number };
}

export interface PdfPage {
  number: number;
  width: number;
  height: number;
  items: TextItem[];
  rects: FilledRect[];
}

interface LoadingTask {
  promise: Promise<PdfDocument>;
  destroy: () => Promise<void>;
}

interface PdfjsModule {
  getDocument: (src: unknown) => LoadingTask;
  OPS: Record<string, number>;
}

interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageProxy>;
}

interface PdfPageProxy {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: unknown[] }>;
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
}

async function loadPdfjs(): Promise<PdfjsModule> {
  // The legacy build is the one that runs under plain Node without a DOM.
  return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule;
}

/** 3x2 affine matrices, as PDF content streams use them. */
type Matrix = [number, number, number, number, number, number];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Inline path opcodes used inside `constructPath` (pdf.js `DrawOPS`). */
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

type Colour = { r: number; g: number; b: number };

/** pdf.js hands colours over as `#rrggbb` now and as 0-255 triples previously. */
function parseColour(args: unknown[]): Colour | null {
  const first = args?.[0];
  if (typeof first === 'string') {
    const hex = /^#?([0-9a-f]{6})$/i.exec(first.trim());
    if (!hex) return null;
    const value = parseInt(hex[1], 16);
    return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 };
  }
  if (typeof first === 'number') {
    const [r, g, b] = args as number[];
    if (typeof g !== 'number') return { r: first, g: first, b: first }; // grey
    return { r: first / 255, g: g / 255, b: (b ?? 0) / 255 };
  }
  return null;
}

/** Corner points of a path, or null if it curves (so it is not a cell). */
function decodePath(data: ArrayLike<number>): [number, number][] | null {
  const points: [number, number][] = [];
  for (let i = 0; i < data.length; ) {
    switch (data[i++]) {
      case DRAW.moveTo:
      case DRAW.lineTo:
        points.push([data[i++], data[i++]]);
        break;
      case DRAW.closePath:
        break;
      case DRAW.curveTo:
      case DRAW.quadraticCurveTo:
        return null;
      default:
        return null; // unknown opcode: don't guess at the geometry
    }
  }
  return points;
}

/** An axis-aligned rectangle has exactly two distinct x values and two y values. */
function rectFromPoints(points: [number, number][], ctm: Matrix, colour: Colour): FilledRect | null {
  if (points.length < 4 || points.length > 5) return null;
  const mapped = points.map(([x, y]) => applyMatrix(ctm, x, y));
  const xs = [...new Set(mapped.map((p) => Math.round(p[0] * 100) / 100))];
  const ys = [...new Set(mapped.map((p) => Math.round(p[1] * 100) / 100))];
  if (xs.length !== 2 || ys.length !== 2) return null;

  const [x0, x1] = xs.sort((a, b) => a - b);
  const [y0, y1] = ys.sort((a, b) => a - b);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, colour: { ...colour } };
}

const FILL_INTENTS = new Set(['fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']);

/**
 * Walk the content stream for axis-aligned filled rectangles.
 *
 * pdf.js reshaped `constructPath` in v6 — the paint intent now rides along as
 * the first argument and rectangles arrive pre-flattened into line segments —
 * so both that shape and the older "path then a separate fill op" shape are
 * handled. A page whose paths we cannot decode still yields its text.
 */
function extractRects(
  ops: { fnArray: number[]; argsArray: unknown[][] },
  OPS: Record<string, number>,
): FilledRect[] {
  const fillIntents = new Set(
    [...FILL_INTENTS].map((name) => OPS[name]).filter((op) => typeof op === 'number'),
  );

  const rects: FilledRect[] = [];
  const stack: { ctm: Matrix; colour: Colour }[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let colour: Colour = { r: 0, g: 0, b: 0 };
  let pending: FilledRect[] = [];

  const collect = (raw: unknown, intentIsFill: boolean): void => {
    // args[1] is either one flat path or a list of them.
    const paths: ArrayLike<number>[] =
      Array.isArray(raw) && typeof (raw as unknown[])[0] === 'number'
        ? [raw as ArrayLike<number>]
        : ((raw as ArrayLike<number>[]) ?? []);

    for (const path of paths) {
      if (!path || typeof path.length !== 'number') continue;
      const points = decodePath(path);
      if (!points) continue;
      const rect = rectFromPoints(points, ctm, colour);
      if (!rect) continue;
      if (intentIsFill) rects.push(rect);
      else pending.push(rect);
    }
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] ?? [];

    if (fn === OPS.save) {
      stack.push({ ctm, colour: { ...colour } });
    } else if (fn === OPS.restore) {
      const previous = stack.pop();
      if (previous) {
        ctm = previous.ctm;
        colour = previous.colour;
      }
    } else if (fn === OPS.transform) {
      const m = args as unknown as number[];
      if (Array.isArray(m) && m.length >= 6) ctm = multiply(ctm, m.slice(0, 6) as Matrix);
    } else if (fn === OPS.setFillRGBColor || fn === OPS.setFillGray) {
      const parsed = parseColour(args);
      if (parsed) colour = parsed;
    } else if (fn === OPS.constructPath) {
      pending = [];
      if (Array.isArray(args[0])) {
        // pdf.js <= 5: [opcodes, coords], with `rectangle` carrying x/y/w/h and
        // the paint deferred to a later fill operator.
        const opcodes = args[0] as number[];
        const coords = (args[1] as number[]) ?? [];
        let c = 0;
        for (const op of opcodes) {
          if (op === OPS.rectangle) {
            const [x, y, w, h] = coords.slice(c, c + 4);
            c += 4;
            if ([x, y, w, h].some((n) => typeof n !== 'number')) continue;
            const corners: [number, number][] = [
              [x, y],
              [x + w, y],
              [x + w, y + h],
              [x, y + h],
            ];
            const rect = rectFromPoints(corners, ctm, colour);
            if (rect) pending.push(rect);
          } else if (op === OPS.moveTo || op === OPS.lineTo) c += 2;
          else if (op === OPS.curveTo) c += 6;
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) c += 4;
        }
      } else {
        collect(args[1], fillIntents.has(args[0] as number));
      }
    } else if (fillIntents.has(fn)) {
      for (const rect of pending) rects.push({ ...rect, colour: { ...colour } });
      pending = [];
    } else if (fn === OPS.stroke || fn === OPS.endPath || fn === OPS.clip) {
      pending = [];
    }
  }

  return rects;
}

function toTextItem(raw: unknown): TextItem | null {
  const item = raw as {
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
    fontName?: string;
  };
  if (typeof item?.str !== 'string' || item.str.length === 0) return null;
  const t = item.transform;
  if (!Array.isArray(t) || t.length < 6) return null;
  return {
    text: item.str,
    x: t[4],
    y: t[5],
    width: item.width ?? 0,
    height: item.height ?? (Math.abs(t[3]) || 0),
    fontName: item.fontName ?? '',
  };
}

/** Where pdf.js keeps the metrics for the 14 standard PDF fonts. */
function standardFontsUrl(): string {
  const entry = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
  return pathToFileURL(path.join(path.dirname(entry), 'standard_fonts/')).href;
}

export async function readPdf(file: string): Promise<PdfPage[]> {
  const { getDocument, OPS } = await loadPdfjs();
  const data = new Uint8Array(await readFile(file));

  const loadingTask = getDocument({
    data,
    // Magazine PDFs are font-heavy; these keep pdf.js quiet and headless.
    standardFontDataUrl: standardFontsUrl(),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    // Errors only. Magazine PDFs embed subsetted fonts that pdf.js grumbles
    // about on every page, and none of it affects text or path extraction.
    verbosity: 0,
  });
  const doc = await loadingTask.promise;

  const pages: PdfPage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      const items: TextItem[] = [];
      for (const raw of content.items) {
        const item = toTextItem(raw);
        if (item) items.push(item);
      }

      let rects: FilledRect[] = [];
      try {
        rects = extractRects(await page.getOperatorList(), OPS);
      } catch (err) {
        log.warn(`page ${n}: could not read filled shapes (${(err as Error).message})`);
      }

      pages.push({ number: n, width: viewport.width, height: viewport.height, items, rects });
    }
  } finally {
    await loadingTask.destroy().catch(() => {});
  }

  log.info(`read ${pages.length} pages from ${file}`);
  return pages;
}

/** Perceived lightness, used to tell a black block from a tinted answer cell. */
export function luminance(colour: { r: number; g: number; b: number }): number {
  return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
}
