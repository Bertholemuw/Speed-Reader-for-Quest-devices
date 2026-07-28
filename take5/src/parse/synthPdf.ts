/**
 * A minimal PDF writer, used only by the parser tests.
 *
 * The parse layer reads magazine PDFs, and there is no way to check it works
 * without a PDF that has the same bones as a real puzzle page: cells drawn as
 * filled rectangles, letters positioned inside them, and headings and word
 * lists as ordinary text. This builds exactly that, so `pdf.ts` and
 * `layout.ts` are exercised against real bytes rather than mocks.
 */

export interface SynthCell {
  /** '' leaves the square empty. */
  text?: string;
  kind?: 'open' | 'block' | 'shaded';
}

export interface SynthGrid {
  cells: SynthCell[][];
  /** Bottom-left of the grid in PDF user space. */
  x: number;
  y: number;
  cellSize: number;
}

export interface SynthText {
  text: string;
  x: number;
  y: number;
  size?: number;
}

export interface SynthPage {
  width: number;
  height: number;
  grids: SynthGrid[];
  texts: SynthText[];
}

const FILL: Record<string, string> = {
  open: '1 1 1 rg',
  block: '0 0 0 rg',
  shaded: '0.95 0.85 0.35 rg',
};

function contentStream(page: SynthPage): string {
  const parts: string[] = [];

  for (const grid of page.grids) {
    const rows = grid.cells.length;
    grid.cells.forEach((row, r) => {
      row.forEach((cell, c) => {
        const x = grid.x + c * grid.cellSize;
        // Row 0 is the top row, but PDF y grows upward.
        const y = grid.y + (rows - 1 - r) * grid.cellSize;
        parts.push(FILL[cell.kind ?? 'open']);
        parts.push(`${x} ${y} ${grid.cellSize} ${grid.cellSize} re f`);

        const text = (cell.text ?? '').trim();
        if (text) {
          const size = grid.cellSize * 0.5;
          const tx = x + grid.cellSize / 2 - size * 0.3 * text.length;
          const ty = y + grid.cellSize / 2 - size * 0.35;
          parts.push('0 0 0 rg');
          parts.push(`BT /F1 ${size} Tf 1 0 0 1 ${tx.toFixed(2)} ${ty.toFixed(2)} Tm (${text}) Tj ET`);
        }
      });
    });
  }

  for (const item of page.texts) {
    const size = item.size ?? 11;
    parts.push('0 0 0 rg');
    parts.push(
      `BT /F1 ${size} Tf 1 0 0 1 ${item.x.toFixed(2)} ${item.y.toFixed(2)} Tm (${item.text.replace(/([()\\])/g, '\\$1')}) Tj ET`,
    );
  }

  return parts.join('\n');
}

export function buildPdf(pages: SynthPage[]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];

  // 1 catalog, 2 page tree, 3 font, then two objects per page.
  const firstPageObj = 4;
  pages.forEach((_, i) => pageIds.push(firstPageObj + i * 2));

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  pages.forEach((page, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const stream = contentStream(page);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });

  const chunks: Buffer[] = [];
  let offset = 0;
  const offsets: number[] = [];

  const push = (text: string) => {
    const buffer = Buffer.from(text, 'latin1');
    chunks.push(buffer);
    offset += buffer.length;
  };

  push('%PDF-1.4\n');
  for (let id = 1; id < objects.length; id++) {
    if (!objects[id]) continue;
    offsets[id] = offset;
    push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
  }

  const xrefOffset = offset;
  const count = objects.length;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) {
    xref += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}
