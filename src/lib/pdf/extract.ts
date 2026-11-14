// Server-side PDF extraction: text-layer parsing with pdf.js and OCR fallback
// (pdf.js render -> png buffer -> tesseract.js) for scanned/image pages.

export interface PdfLine {
  text: string;
  page: number; // 1-indexed
  boldRatio: number; // fraction of bold glyphs on the line (0..1)
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
    const res = await worker.recognize(png);
    const text: string = res?.data?.text ?? "";
    return text
      .split(/\r?\n/)
      .map((t: string) => t.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((t: string) => ({ text: t, page: pageNum, boldRatio: 0 }));
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
              ocrWorker = await tesseract.createWorker("eng", 1, {
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
