// QR codes for tables: an SVG for the screen, a printable card as PNG, and an A4 PDF
// with four cards per page (A6 each, cut along the dashed lines).
import QRCode from 'qrcode';

export interface QrMatrix {
  size: number;
  dark: (row: number, col: number) => boolean;
}

export function qrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  return { size: qr.modules.size, dark: (r, c) => !!qr.modules.get(r, c) };
}

/** One path for all dark modules, in module units (draw it in a viewBox of `size`). */
export function qrPath(m: QrMatrix): string {
  let d = '';
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.dark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return d;
}

export interface QrCard {
  url: string;
  cafeName: string;
  tableNumber: number;
  /** Small caps label above the number, e.g. "STO · TABLE". */
  tableLabel: string;
  /** Call to action, one line per language. */
  lines: [string, string];
  accent: string;
}

const INK = '#1f1b18';
const STONE = '#6b5f55';
const PAPER = '#fffdf9';

// A6 at 200 dpi.
export const CARD_W = 827;
export const CARD_H = 1165;

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load('600 52px Fraunces'),
      document.fonts.load('500 200px Fraunces'),
      document.fonts.load('600 30px Inter'),
      document.fonts.load('400 22px Inter'),
    ]);
  } catch {
    /* fall back to system fonts */
  }
}

function fitText(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, start: number, maxWidth: number) {
  let px = start;
  ctx.font = font(px);
  while (px > 14 && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = font(px);
  }
}

/** Draws one card with its top-left corner at (x, y). Assumes fonts are loaded. */
function drawCard(ctx: CanvasRenderingContext2D, card: QrCard, x: number, y: number) {
  const w = CARD_W;
  const cx = x + w / 2;
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(x, y, w, CARD_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = INK;
  fitText(ctx, card.cafeName, (px) => `600 ${px}px Fraunces, Georgia, serif`, 52, w - 140);
  ctx.fillText(card.cafeName, cx, y + 128);

  ctx.fillStyle = card.accent;
  ctx.fillRect(cx - 28, y + 156, 56, 4);

  ctx.fillStyle = STONE;
  ctx.font = '600 24px Inter, system-ui, sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillText(card.tableLabel.toUpperCase(), cx, y + 222);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = INK;
  ctx.font = '500 150px Fraunces, Georgia, serif';
  ctx.fillText(String(card.tableNumber), cx, y + 370);

  // QR with a 4-module quiet zone, whole pixels per module so the print stays sharp.
  const m = qrMatrix(card.url);
  const cell = Math.floor(470 / (m.size + 8));
  const box = cell * (m.size + 8);
  const qx = Math.round(cx - box / 2);
  const qy = y + 410;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(qx, qy, box, box);
  ctx.strokeStyle = '#eae2d6';
  ctx.lineWidth = 2;
  ctx.strokeRect(qx + 1, qy + 1, box - 2, box - 2);
  ctx.fillStyle = INK;
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.dark(r, c)) ctx.fillRect(qx + (c + 4) * cell, qy + (r + 4) * cell, cell, cell);
    }
  }

  const textTop = qy + box + 64;
  ctx.fillStyle = INK;
  fitText(ctx, card.lines[0], (px) => `600 ${px}px Inter, system-ui, sans-serif`, 34, w - 120);
  ctx.fillText(card.lines[0], cx, textTop);
  ctx.fillStyle = STONE;
  fitText(ctx, card.lines[1], (px) => `400 ${px}px Inter, system-ui, sans-serif`, 28, w - 120);
  ctx.fillText(card.lines[1], cx, textTop + 44);

  ctx.fillStyle = '#8a7e73';
  fitText(ctx, card.url.replace(/^https?:\/\//, ''), (px) => `400 ${px}px Inter, system-ui, sans-serif`, 18, w - 120);
  ctx.fillText(card.url.replace(/^https?:\/\//, ''), cx, y + CARD_H - 48);
  ctx.restore();
}

export async function cardCanvas(card: QrCard): Promise<HTMLCanvasElement> {
  await fontsReady();
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  drawCard(canvas.getContext('2d')!, card, 0, 0);
  return canvas;
}

export async function cardPng(card: QrCard): Promise<Blob> {
  const canvas = await cardCanvas(card);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

/** A4 pages (200 dpi) with up to four cards each and dashed cut lines. */
export async function cardsPdf(cards: QrCard[]): Promise<Blob> {
  await fontsReady();
  const pages: HTMLCanvasElement[] = [];
  for (let i = 0; i < cards.length; i += 4) {
    const page = document.createElement('canvas');
    page.width = CARD_W * 2;
    page.height = Math.round(CARD_H * 2 + 9); // A4 is 297 mm, two A6 cards are 296 mm
    const ctx = page.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, page.width, page.height);
    cards.slice(i, i + 4).forEach((card, j) => drawCard(ctx, card, (j % 2) * CARD_W, Math.floor(j / 2) * (CARD_H + 9)));
    ctx.strokeStyle = '#c9bfb2';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.moveTo(CARD_W, 0);
    ctx.lineTo(CARD_W, page.height);
    ctx.moveTo(0, CARD_H + 4.5);
    ctx.lineTo(page.width, CARD_H + 4.5);
    ctx.stroke();
    pages.push(page);
  }
  return canvasesToPdf(pages);
}

// ───────────────────────────────────────────── minimal PDF writer (one full-page image per page)

type Bytes = Uint8Array<ArrayBuffer>;

async function encodePage(canvas: HTMLCanvasElement): Promise<{ data: Bytes; filter: string }> {
  if (typeof CompressionStream !== 'undefined') {
    // Lossless: raw RGB, zlib-compressed (PDF FlateDecode).
    const px = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
      rgb[j] = px[i];
      rgb[j + 1] = px[i + 1];
      rgb[j + 2] = px[i + 2];
    }
    const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'));
    return { data: new Uint8Array(await new Response(stream).arrayBuffer()), filter: 'FlateDecode' };
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('jpeg'))), 'image/jpeg', 0.95));
  return { data: new Uint8Array(await blob.arrayBuffer()), filter: 'DCTDecode' };
}

async function canvasesToPdf(pages: HTMLCanvasElement[]): Promise<Blob> {
  const W = 595.28; // A4 in points
  const H = 841.89;
  const enc = new TextEncoder();
  const chunks: Bytes[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Bytes) => {
    const bytes = typeof part === 'string' ? (enc.encode(part) as Bytes) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n%âãÏÓ\n');
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  for (let i = 0; i < pages.length; i++) {
    const page = 3 + i * 3;
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`);
    obj(page + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const { data, filter } = await encodePage(pages[i]);
    offsets[page + 2] = length;
    push(`${page + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pages[i].width} /Height ${pages[i].height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} /Length ${data.length} >>\nstream\n`);
    push(data);
    push('\nendstream\nendobj\n');
  }
  const size = 3 + pages.length * 3;
  const xref = length;
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(`${table}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
