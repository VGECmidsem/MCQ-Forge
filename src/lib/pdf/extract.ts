// Server-side PDF extraction: text-layer parsing with pdf.js and OCR fallback
// (pdf.js render -> png buffer -> tesseract.js) for scanned/image pages.

import fs from "node:fs";
import path from "node:path";

export interface PdfLine {
  text: string;
  page: number; // 1-indexed
  boldRatio: number; // fraction of bold glyphs on the line (0..1)
  // Optional layout info. Only OCR populates these; the text layer already
  // emits properly ordered lines. `x` is the left edge as a fraction of the
  // page width, which lets the parser tell a left nav column apart from the
  // question body.
  x?: number;
  xEnd?: number;
  rightGap?: number;
}

export interface ExtractResult {
  lines: PdfLine[];
  pageCount: number;
  kind: "text" | "mixed" | "scanned";
  ocrPages: number[];
  ocrFailedPages: number[];
  warnings: string[];
  timings: {
    openMs: number;
    pageScanMs: number;
    deepFontMs: number;
    ocrMs: number;
    totalMs: number;
    deepFontPages: number[];
  };
}

interface RawItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bold: boolean;
}

async function loadPdfjs(): Promise<any> {
  // Patch raster DOM globals so pdf.js rendering works in Node without the
  // optional "canvas" package (we use @napi-rs/canvas instead).
  try {
    const canvasMod: any = await import("@napi-rs/canvas");
    const g = globalThis as any;
    if (!g.DOMMatrix && canvasMod.DOMMatrix) g.DOMMatrix = canvasMod.DOMMatrix;
    if (!g.ImageData && canvasMod.ImageData) g.ImageData = canvasMod.ImageData;
    if (!g.Path2D && canvasMod.Path2D) g.Path2D = canvasMod.Path2D;
  } catch {
    /* rendering support optional */
  }
  const mod: any = await import("pdfjs-dist/legacy/build/pdf.js");
  const api = mod?.getDocument ? mod : mod?.default?.getDocument ? mod.default : mod?.default ?? mod;
  return api;
}

function isBoldFamily(family: string | undefined): boolean {
  if (!family) return false;
  return /(bold|black|semibold|semi-bold|demi|heavy|extrabold|extra-bold|w[5-9]00)/i.test(
    family,
  );
}

function buildLines(items: RawItem[], page: number): PdfLine[] {
  const usable = items.filter((i) => i.str && i.str.trim().length > 0);
  if (!usable.length) return [];
  // Reading order: PDF user space has y growing upward -> sort descending by y.
  usable.sort((a, b) => (Math.abs(a.y - b.y) <= 2 ? a.x - b.x : b.y - a.y));

  const groups: RawItem[][] = [];
  let cur: RawItem[] = [];
  let curY = NaN;
  for (const it of usable) {
    if (!cur.length || Math.abs(it.y - curY) <= Math.max(2.2, (it.h || 11) * 0.35)) {
      cur.push(it);
      if (!curY || Number.isNaN(curY)) curY = it.y;
    } else {
      groups.push(cur);
      cur = [it];
      curY = it.y;
    }
  }
  if (cur.length) groups.push(cur);

  const lines: PdfLine[] = [];
  for (const g of groups) {
    g.sort((a, b) => a.x - b.x);
    let text = "";
    let lastEnd: number | null = null;
    let lastH = 11;
    let boldChars = 0;
    let totalChars = 0;
    for (const it of g) {
      if (lastEnd !== null) {
        const gap = it.x - lastEnd;
        if (gap > Math.max(1.4, lastH * 0.16) && !text.endsWith(" ")) text += " ";
      }
      text += it.str;
      const c = it.str.length;
      totalChars += c;
      if (it.bold) boldChars += c;
      lastEnd = it.x + (it.w || 0);
      lastH = it.h || lastH;
    }
    text = text
      .replace(/ /g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (!text) continue;
    lines.push({ text, page, boldRatio: totalChars ? boldChars / totalChars : 0 });
  }
  return lines;
}

// Minimal canvas factory so pdf.js can render pages in Node via @napi-rs/canvas.
function makeCanvasFactory(createCanvas: any) {
  return {
    create(width: number, height: number) {
      const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
      return { canvas, context: canvas.getContext("2d") };
    },
    reset(pair: any, width: number, height: number) {
      pair.canvas.width = Math.ceil(width);
      pair.canvas.height = Math.ceil(height);
    },
    destroy(pair: any) {
      pair.canvas.width = 0;
      pair.canvas.height = 0;
    },
  };
}

interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function flattenOcrWords(result: any): OcrWord[] {
  const out: OcrWord[] = [];
  const blocks = result?.data?.blocks;
  if (Array.isArray(blocks) && blocks.length) {
    for (const b of blocks)
      for (const p of b.paragraphs ?? [])
        for (const l of p.lines ?? [])
          for (const w of l.words ?? []) {
            const t = (w?.text ?? "").trim();
            const bb = w?.bbox;
            if (!t || !bb) continue;
            out.push({ text: t, x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1 });
          }
    if (out.length) return out;
  }
  // Fallback: some tesseract builds only return flat text. Synthesise one
  // word per line so callers still get something usable.
  const text: string = result?.data?.text ?? "";
  text
    .split(/\r?\n/)
    .forEach((line, i) => {
      line
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .forEach((t, j) => out.push({ text: t, x0: j * 10, y0: i * 20, x1: j * 10 + 9, y1: i * 20 + 18 }));
    });
  return out;
}

/**
 * Find the left edge of the main content column.
 *
 * Scans (browser) screenshots exported to PDF often carry a left navigation
 * rail. OCR reads it on the same visual rows as the body, so without this the
 * nav labels get spliced into question text. We look for the widest vertical
 * whitespace gutter in the left third that has a meaningful number of words on
 * BOTH sides of it — i.e. an actual column boundary rather than ordinary
 * inter-word spacing or a right-hand ragged edge.
 */
function detectColumnGutter(words: OcrWord[], pageWidth: number): number {
  if (words.length < 20 || !pageWidth) return 0;
  const occupied = new Uint8Array(Math.ceil(pageWidth) + 2);
  for (const w of words) {
    const a = Math.max(0, Math.floor(w.x0));
    const b = Math.min(occupied.length - 1, Math.ceil(w.x1));
    for (let x = a; x <= b; x++) occupied[x] = 1;
  }
  let best: { start: number; end: number } | null = null;
  for (let x = 0; x < pageWidth; x++) {
    if (occupied[x]) continue;
    let e = x;
    while (e < pageWidth && !occupied[e]) e++;
    const len = e - x;
    if (len >= Math.max(12, pageWidth * 0.006)) {
      const left = words.filter((w) => w.x1 <= x).length;
      const right = words.filter((w) => w.x0 >= e).length;
      const span = (left + right) / words.length;
      if (left >= 6 && right > left * 0.8 && span >= 0.55) {
        if (!best || len > best.end - best.start) best = { start: x, end: e };
      }
    }
    x = e;
  }
  if (!best) return 0;
  return Math.round((best.start + best.end) / 2);
}

/** Group words into visual rows, then join them into lines of text. */
function rowsToLines(
  words: OcrWord[],
  page: number,
  pageWidth: number,
  contentStart: number,
): PdfLine[] {
  if (!words.length) return [];
  const sorted = [...words].sort((a, b) => a.y0 - b.y0);
  const rows: { cy: number; words: OcrWord[] }[] = [];
  for (const w of sorted) {
    const cy = (w.y0 + w.y1) / 2;
    const h = Math.max(1, w.y1 - w.y0);
    const row = rows.find((r) => Math.abs(r.cy - cy) < Math.max(6, h * 0.55));
    if (row) {
      row.words.push(w);
      row.cy = (row.cy * (row.words.length - 1) + cy) / row.words.length;
    } else {
      rows.push({ cy, words: [w] });
    }
  }
  rows.sort((a, b) => a.cy - b.cy);

  const lines: PdfLine[] = [];
  for (const row of rows) {
    const ws = row.words.sort((a, b) => a.x0 - b.x0);
    const avgH =
      ws.reduce((s, w) => s + Math.max(1, w.y1 - w.y0), 0) / Math.max(1, ws.length);
    let text = "";
    for (let i = 0; i < ws.length; i++) {
      if (i > 0) {
        const gap = ws[i].x0 - ws[i - 1].x1;
        // Two spaces for a wide gap — the option scanner relies on it to tell
        // separate columns ("(A) foo   (B) bar") from words in one sentence.
        text += gap > avgH * 0.14 ? "  " : " ";
      }
      text += ws[i].text;
    }
    const cleaned = text.replace(/[ \t]+/g, " ").trim();
    if (!cleaned) continue;
    const x0 = Math.min(...ws.map((w) => w.x0));
    const x1 = Math.max(...ws.map((w) => w.x1));
    lines.push({
      text: cleaned,
      page,
      boldRatio: 0,
      x: pageWidth ? x0 / pageWidth : undefined,
      xEnd: pageWidth ? x1 / pageWidth : undefined,
      rightGap: pageWidth ? Math.max(0, pageWidth - x1) / pageWidth : undefined,
    });
  }
  void contentStart;
  return lines;
}

async function ocrPageBest(
  page: any,
  pageNum: number,
  worker: any,
  canvasFactory: any,
): Promise<PdfLine[]> {
  try {
    const { createCanvas } = await import("@napi-rs/canvas");
    const viewport = page.getViewport({ scale: 2 });
    const factory = canvasFactory ?? makeCanvasFactory(createCanvas);
    const pair = factory.create(viewport.width, viewport.height);
    await page.render({
      canvasContext: pair.context,
      viewport,
      canvasFactory: factory,
    }).promise;
    const png = pair.canvas.toBuffer("image/png");
    factory.destroy(pair);

    // Ask for block/line/word structure: without bounding boxes every line
    // becomes one flat string and a sidebar is indistinguishable from a stem.
    const res = await worker.recognize(png, {}, { blocks: true });
    const words = flattenOcrWords(res);
    const width = Math.ceil(viewport.width);
    const gutter = detectColumnGutter(words, width);
    const content = gutter ? words.filter((w) => w.x1 > gutter + 6) : words;
    return rowsToLines(content.length ? content : words, pageNum, width, gutter);
  } catch {
    return [];
  }
}

export interface ExtractProgress {
  page: number;
  pageCount: number;
  ocr: boolean;
  /** 0..1 within the extraction phase */
  ratio: number;
  message: string;
}

export async function extractPdf(
  buffer: Buffer,
  opts: {
    maxOcrPages?: number;
    enableOcr?: boolean;
    onProgress?: (p: ExtractProgress) => void;
  } = {},
): Promise<ExtractResult> {
  const maxOcrPages = opts.maxOcrPages ?? 40;
  const report = opts.onProgress ?? (() => {});
  const warnings: string[] = [];
  const ocrPages: number[] = [];
  const ocrFailedPages: number[] = [];
  const lines: PdfLine[] = [];
  let ocrWorker: any = null;
  const t0 = Date.now();

  let doc: any = null;
  try {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length);
    // Provide a napi-canvas factory at document level: pdf.js uses it for
    // temporary/cached canvases during rendering (avoids the optional
    // "canvas" package entirely).
    let canvasFactory: any = undefined;
    try {
      const { createCanvas } = await import("@napi-rs/canvas");
      canvasFactory = makeCanvasFactory(createCanvas);
    } catch {
      canvasFactory = undefined;
    }
    doc = await pdfjs.getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      ...(canvasFactory ? { canvasFactory } : {}),
    }).promise;
    doc.__mcqCanvasFactory = canvasFactory;
      } catch (e: any) {
    throw new Error(
      `Could not read PDF (${e?.message || "unknown error"}). The file may be corrupted or password-protected.`,
    );
  }

  const openMs = Date.now() - t0;
  let pageScanMs = 0;
  let deepFontMs = 0;
  let ocrMs = 0;
  const deepFontPages: number[] = [];

  const pageCount: number = doc.numPages;
  let textChars = 0;
  let imageOnlyPages = 0;
  const enableOcr = opts.enableOcr !== false;
  // OCR pages cost far more than text pages; weight them so the bar advances
  // at a believable pace instead of stalling on scanned documents.
  let ocrSubRatio = 0;
  let ocrCurrentPage = 0;
  const emit = (page: number, ocr: boolean, message: string) => {
    const done = page - 1 + (ocr ? ocrSubRatio : 1);
    report({
      page,
      pageCount,
      ocr,
      ratio: Math.max(0, Math.min(1, done / Math.max(1, pageCount))),
      message,
    });
  };

  report({ page: 0, pageCount, ocr: false, ratio: 0, message: `Reading ${pageCount} page(s)…` });

  try {
    for (let p = 1; p <= pageCount; p++) {
      let page: any = null;
      try {
        page = await doc.getPage(p);
        const scanStart = Date.now();
        const tc = await page.getTextContent();
        const styles = tc.styles || {};

        // --- collect raw items (font bold flag resolved afterwards, lazily)
        const raw: Array<RawItem & { fontName: string }> = [];
        for (const it of tc.items as any[]) {
          if (typeof it?.str !== "string") continue;
          const tr = it.transform || [1, 0, 0, 1, 0, 0];
          raw.push({
            str: it.str,
            x: tr[4] ?? 0,
            y: tr[5] ?? 0,
            w: typeof it.width === "number" ? it.width : 0,
            h: Math.abs(tr[3] ?? 0) || 11,
            bold: false,
            fontName: it.fontName ?? "",
          });
        }
        pageScanMs += Date.now() - scanStart;

        // --- resolve font boldness: styles first, font objects only if loaded.
        // The expensive operator-list pass (which materializes PostScript font
        // names like "Helvetica-Bold") runs ONLY when this page actually
        // contains option-marker text and some font is still unknown.
        const boldMap = new Map<string, boolean>();
        const probe = (fontId: string): { bold: boolean; resolved: boolean } => {
          const fam = styles[fontId]?.fontFamily ?? "";
          if (isBoldFamily(fam)) return { bold: true, resolved: true };
          try {
            const f = page.commonObjs?.get?.(fontId);
            if (f?.name) return { bold: isBoldFamily(f.name), resolved: true };
            return { bold: isBoldFamily(fam), resolved: true };
          } catch {
            return { bold: false, resolved: false };
          }
        };
        const unresolved: string[] = [];
        for (const it2 of raw) {
          if (boldMap.has(it2.fontName)) continue;
          const r = probe(it2.fontName);
          boldMap.set(it2.fontName, r.bold);
          if (!r.resolved) unresolved.push(it2.fontName);
        }
        const pageTextQuick = raw.map((r2) => r2.str).join(" ");
        const hasOptionish = /[(\[]?[A-Ea-e][)\].]\s/.test(pageTextQuick);
        if (unresolved.length && hasOptionish) {
          const deepStart = Date.now();
          try {
            await page.getOperatorList();
            for (const fontId of unresolved) {
              try {
                const f = page.commonObjs?.get?.(fontId);
                if (f?.name) boldMap.set(fontId, isBoldFamily(f.name));
              } catch {
                /* still unresolved */
              }
            }
            deepFontPages.push(p);
          } catch {
            /* font info unavailable; bold detection degrades gracefully */
          }
          deepFontMs += Date.now() - deepStart;
        }
        const items: RawItem[] = raw.map(({ fontName, ...rest }) => ({
          ...rest,
          bold: boldMap.get(fontName) === true,
        }));
        const pageLines = buildLines(items, p);
        const pageChars = pageLines.join(" ").replace(/\s/g, "").length;
        textChars += pageChars;

        if (pageChars < 8 && enableOcr) {
          imageOnlyPages++;
          if (ocrPages.length + ocrFailedPages.length < maxOcrPages) {
            ocrSubRatio = 0;
            emit(p, true, `Page ${p}/${pageCount}: scanned page — starting OCR…`);
            if (!ocrWorker) {
              const tesseract: any = await import("tesseract.js");
              // Prefer the language model vendored in the repo (assets/tesseract)
              // so OCR works offline / in locked-down containers. tesseract.js
              // falls back to the jsdelivr CDN when langPath is omitted.
              const bundledLangs = path.resolve(process.cwd(), "assets", "tesseract");
              const bundledModel = path.join(bundledLangs, "eng.traineddata");
              const hasBundled = fs.existsSync(bundledModel);
              // cachePath defaults to the process cwd — point it at a writable dir
              // so read-only deployments (containers, Vercel) don't fail.
              const cachePath = hasBundled
                ? bundledLangs
                : path.join(process.env.TMPDIR || "/tmp", "mcqforge-tesseract");
              try {
                fs.mkdirSync(cachePath, { recursive: true });
              } catch {
                /* fall back to tesseract.js default */
              }
              ocrWorker = await tesseract.createWorker("eng", 1, {
                langPath: hasBundled ? bundledLangs : undefined,
                cachePath,
                gzip: false, // the bundled eng.traineddata is uncompressed
                logger: (m: any) => {
                  if (m?.status === "recognizing text" && typeof m.progress === "number") {
                    ocrSubRatio = Math.min(0.98, m.progress);
                    emit(
                      ocrCurrentPage,
                      true,
                      `Page ${ocrCurrentPage}/${pageCount}: OCR ${Math.round(m.progress * 100)}%`,
                    );
                  }
                },
              });
            }
            ocrCurrentPage = p;
            const ocrStart = Date.now();
            const ocrLines = await ocrPageBest(page, p, ocrWorker, doc.__mcqCanvasFactory);
            ocrMs += Date.now() - ocrStart;
            ocrSubRatio = 1;
            const ocrChars = ocrLines.join(" ").replace(/\s/g, "").length;
            if (ocrChars >= 8) {
              lines.push(...ocrLines);
              ocrPages.push(p);
            } else {
              lines.push(...pageLines);
              ocrFailedPages.push(p);
            }
          } else {
            ocrFailedPages.push(p);
          }
          emit(p, false, `Page ${p}/${pageCount} processed (OCR)`);
        } else {
          lines.push(...pageLines);
          emit(p, false, `Page ${p}/${pageCount} processed`);
        }
      } catch (e: any) {
        warnings.push(`Page ${p}: extraction failed (${e?.message || "error"}).`);
        emit(p, false, `Page ${p}/${pageCount} failed`);
      } finally {
        try {
          page?.cleanup?.();
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    if (ocrWorker) {
      try {
        await ocrWorker.terminate();
      } catch {
        /* ignore */
      }
    }
    try {
      await doc.destroy?.();
    } catch {
      /* ignore */
    }
  }

  if (ocrPages.length) {
    warnings.push(`OCR was applied to ${ocrPages.length} scanned page(s): ${ocrPages.join(", ")}.`);
  }
  if (ocrFailedPages.length) {
    warnings.push(
      `Could not extract text from ${ocrFailedPages.length} image-only page(s) (page ${ocrFailedPages.join(", ")}). They may require manual entry.`,
    );
  }

  const totalChars = lines.join(" ").replace(/\s/g, "").length;
  const pagesWithText = new Set(lines.map((l) => l.page)).size;
  const kind: ExtractResult["kind"] =
    textChars === 0 && totalChars === 0
      ? "scanned"
      : imageOnlyPages > 0 || ocrPages.length > 0
        ? pagesWithText >= pageCount - ocrFailedPages.length
          ? "mixed"
          : "mixed"
        : "text";

  return {
    lines,
    pageCount,
    kind,
    ocrPages,
    ocrFailedPages,
    warnings,
    timings: {
      openMs,
      pageScanMs,
      deepFontMs,
      ocrMs,
      totalMs: Date.now() - t0,
      deepFontPages,
    },
  };
}
