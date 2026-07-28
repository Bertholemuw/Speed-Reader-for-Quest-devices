import type { Cell } from '../types.ts';
import { luminance, type FilledRect, type PdfPage, type TextItem } from './pdf.ts';

/**
 * Geometry, not meaning. This turns a page of loose text runs and rectangles
 * into the two things the puzzle detector needs: readable lines of prose, and
 * lattices — square grids of cells, each tagged as blank, blocked or shaded.
 */

export interface Line {
  text: string;
  x: number;
  y: number;
  height: number;
  items: TextItem[];
}

export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type CellKind = 'open' | 'block' | 'shaded';

export interface LatticeCell {
  r: number;
  c: number;
  kind: CellKind;
  /** Characters printed inside the cell, left-to-right. */
  text: string;
  region: Region;
}

export interface Lattice {
  rows: number;
  cols: number;
  cellSize: number;
  region: Region;
  cells: LatticeCell[][];
}

/** Groups values that sit within `tolerance` of each other, returning centres. */
export function cluster(values: number[], tolerance: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const centres: number[] = [];
  let group = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - group[group.length - 1] <= tolerance) {
      group.push(sorted[i]);
    } else {
      centres.push(group.reduce((a, b) => a + b, 0) / group.length);
      group = [sorted[i]];
    }
  }
  centres.push(group.reduce((a, b) => a + b, 0) / group.length);
  return centres;
}

/**
 * Text runs merged into visual lines. PDF y grows upward, so lines come back
 * top-to-bottom for human-readable order.
 */
export function groupLines(items: TextItem[], tolerance = 3): Line[] {
  const ordered = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  let current: TextItem[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const sorted = [...current].sort((a, b) => a.x - b.x);
    // Re-insert the spaces that PDF text runs habitually drop.
    let text = '';
    let previousEnd: number | null = null;
    for (const item of sorted) {
      const gap = previousEnd === null ? 0 : item.x - previousEnd;
      if (previousEnd !== null && gap > Math.max(1.2, item.height * 0.22)) text += ' ';
      text += item.text;
      previousEnd = item.x + item.width;
    }
    lines.push({
      text: text.replace(/\s+/g, ' ').trim(),
      x: sorted[0].x,
      y: sorted[0].y,
      height: Math.max(...sorted.map((i) => i.height)),
      items: sorted,
    });
    current = [];
  };

  for (const item of ordered) {
    if (current.length > 0 && Math.abs(current[0].y - item.y) > tolerance) flush();
    current.push(item);
  }
  flush();
  return lines;
}

function centreOf(rect: FilledRect): [number, number] {
  return [rect.x + rect.width / 2, rect.y + rect.height / 2];
}

function isCellShaped(rect: FilledRect, min = 6, max = 64): boolean {
  const { width: w, height: h } = rect;
  if (w < min || h < min || w > max || h > max) return false;
  return Math.abs(w - h) / Math.max(w, h) < 0.3;
}

function inside(region: Region, x: number, y: number): boolean {
  return x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;
}

/**
 * Find puzzle grids on a page.
 *
 * Cells are drawn as similarly-sized square fills, so we bucket rectangles by
 * size, then look for a set whose centres line up on a regular lattice. Anything
 * with fewer than `minSize` rows or columns is treated as decoration.
 */
export function detectLattices(page: PdfPage, minSize = 4): Lattice[] {
  const candidates = page.rects.filter((r) => isCellShaped(r));
  if (candidates.length < minSize * minSize) return [];

  // Group by rounded cell size — one puzzle draws all its cells the same size.
  const bySize = new Map<number, FilledRect[]>();
  for (const rect of candidates) {
    const key = Math.round(((rect.width + rect.height) / 2) * 2) / 2;
    const bucket = bySize.get(key);
    if (bucket) bucket.push(rect);
    else bySize.set(key, [rect]);
  }

  const lattices: Lattice[] = [];

  for (const [size, rects] of bySize) {
    if (rects.length < minSize * minSize) continue;

    const tolerance = size * 0.4;
    const xs = cluster(rects.map((r) => centreOf(r)[0]), tolerance);
    const ys = cluster(rects.map((r) => centreOf(r)[1]), tolerance).sort((a, b) => b - a);
    if (xs.length < minSize || ys.length < minSize) continue;

    // A real grid fills most of its lattice; a coincidence of similar boxes will not.
    const occupancy = rects.length / (xs.length * ys.length);
    if (occupancy < 0.5) continue;

    const nearest = (values: number[], target: number): number => {
      let best = 0;
      let bestDistance = Infinity;
      values.forEach((value, index) => {
        const distance = Math.abs(value - target);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return bestDistance <= tolerance ? best : -1;
    };

    const cells: LatticeCell[][] = ys.map((cy, r) =>
      xs.map((cx, c) => ({
        r,
        c,
        kind: 'open' as CellKind,
        text: '',
        region: { x0: cx - size / 2, y0: cy - size / 2, x1: cx + size / 2, y1: cy + size / 2 },
      })),
    );

    for (const rect of rects) {
      const [cx, cy] = centreOf(rect);
      const c = nearest(xs, cx);
      const r = nearest(ys, cy);
      if (r < 0 || c < 0) continue;
      const light = luminance(rect.colour);
      // Near-black is a blocked square; anything tinted but not white is a
      // shaded square, which is how Take 5 marks the prize-answer letters.
      cells[r][c].kind = light < 0.28 ? 'block' : light < 0.93 ? 'shaded' : 'open';
    }

    const region: Region = {
      x0: Math.min(...xs) - size / 2,
      y0: Math.min(...ys) - size / 2,
      x1: Math.max(...xs) + size / 2,
      y1: Math.max(...ys) + size / 2,
    };

    for (const item of page.items) {
      const x = item.x + item.width / 2;
      const y = item.y + item.height / 2;
      if (!inside(region, x, y)) continue;
      const c = nearest(xs, x);
      const r = nearest(ys, y);
      if (r >= 0 && c >= 0) cells[r][c].text += item.text.trim();
    }

    lattices.push({ rows: ys.length, cols: xs.length, cellSize: size, region, cells });
  }

  // Biggest first: the prize puzzle is usually the dominant grid on the page.
  return lattices.sort((a, b) => b.rows * b.cols - a.rows * a.cols);
}

/** Shaded cells in reading order — the letters that spell the prize answer. */
export function shadedCells(lattice: Lattice): Cell[] {
  const out: Cell[] = [];
  for (const row of lattice.cells) {
    for (const cell of row) {
      if (cell.kind === 'shaded') out.push({ r: cell.r, c: cell.c });
    }
  }
  return out;
}

/** Lines that fall outside every lattice — clues, word lists and headings. */
export function linesOutside(lines: Line[], lattices: Lattice[]): Line[] {
  return lines.filter((line) => !lattices.some((l) => inside(l.region, line.x, line.y)));
}
