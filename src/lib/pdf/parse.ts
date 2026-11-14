// Deterministic MCQ parsing: question blocks, option markers (vertical and
// horizontal layouts), answer-key zones, trailing explanation sections,
// tick/bold marked-answer detection, and cross-page continuation handling.

import type { PdfLine } from "./extract";
import { LETTERS } from "@/lib/utils";

export type AnswerSource =
  | "pdf_answer_key"
  | "pdf_marked"
  | "ai_generated"
  | "manual"
  | "none";

export interface ParsedQuestion {
  number: number | null;
  text: string;
  options: Record<string, string>;
  optionBold: Record<string, number>;
  inlineAnswer: string | null;
  tickedOption: string | null;
  explanation: string | null;
  pageStart: number;
  pageEnd: number;
  warnings: string[];
}

export interface ResolvedQuestion {
  number: number | null;
  text: string;
  options: Record<string, string>;
  correctAnswer: string | null;
  answerSource: AnswerSource;
  verificationStatus: "verified" | "needs_verification";
  explanation: string | null;
  pageStart: number;
  pageEnd: number;
  warnings: string[];
}

export interface KeyHit {
  letter: string;
  page: number;
  explanation?: string;
}

export interface ParseResult {
  questions: ResolvedQuestion[];
  keySize: number;
  keyLocated: boolean;
  keyMatched: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Noise removal: repeated headers/footers, page numbers
// ---------------------------------------------------------------------------
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
// Digits replaced so "Page 1" and "Page 2" count as the same header/footer.
const normRepeatKey = (s: string) => norm(s).replace(/\d+/g, "#");

function stripHeadersFooters(lines: PdfLine[]): { lines: PdfLine[]; removed: number } {
  const byPage = new Map<number, PdfLine[]>();
  for (const l of lines) {
    if (!byPage.has(l.page)) byPage.set(l.page, []);
    byPage.get(l.page)!.push(l);
  }
  const pageCount = byPage.size;
  const counts = new Map<string, number>();
  for (const arr of byPage.values()) {
    if (arr.length < 3) continue;
    const first = normRepeatKey(arr[0].text);
    const last = normRepeatKey(arr[arr.length - 1].text);
    if (first) counts.set(first, (counts.get(first) ?? 0) + 1);
    if (last && last !== first) counts.set(last, (counts.get(last) ?? 0) + 1);
  }
  const repeated = new Set(
    [...counts.entries()]
      .filter(([, c]) => c >= Math.max(2, Math.ceil(pageCount * 0.5)))
      .map(([t]) => t),
  );
  const pageNumRe = /^(page\s*)?\d{1,4}\s*(of\s*\d{1,4}|\|\s*\d{1,4})?$/i;
  const pageMarkerRe = /(^|\b|\s|[-–—|])(page|pg\.?|sheet)\s*(no\.?\s*)?(of\s*)?\d+(\s*(of|\/)\s*\d+)?\s*$/i;
  const out: PdfLine[] = [];
  let removed = 0;
  for (const arr of byPage.values()) {
    arr.forEach((l, i) => {
      const isEdge = i === 0 || i === arr.length - 1;
      if (
        (isEdge && repeated.has(normRepeatKey(l.text))) ||
        pageNumRe.test(l.text.trim()) ||
        (isEdge && pageMarkerRe.test(l.text.trim()))
      ) {
        removed++;
        return;
      }
      out.push(l);
    });
  }
  return { lines: out, removed };
}

// ---------------------------------------------------------------------------
// Answer key zones
// ---------------------------------------------------------------------------
const KEY_HEADING =
  /^\s*(answer[\s_\-]*key|answer[\s_\-]*sheet|key\s*to\s*answers?|answers?\s*(?:&|and|with)\s*explanations?|correct\s*answers?|answer\s*table|key\s*answers?)\s*[:\-.]?\s*$/i;
const EXPL_HEADING =
  /^\s*(?:(?:detailed|brief)\s+)?(explanations?|solutions?|answer\s*explanations?|hints?\s*(?:&|and)\s*solutions?|explanatory\s*notes?)\s*[:\-.]?\s*$/i;

const PAIR = new RegExp(
  "(?:\\(?\\s*Q[\\.\\s]*)?[\\(\\[]?\\s*(\\d{1,3})\\s*[\\)\\]]?" + // number
    "(?:\\s*[\\.\\)\\]\\}:,\\-–—]\\s*|\\s+)" +
    "\\(?\\s*([A-Ea-e])\\s*\\)?(?![A-Za-z0-9])",
  "g",
);

function parseKeyLines(zoneLines: PdfLine[], forceAll = false): Map<number, KeyHit> {
  const hits = new Map<number, KeyHit>();
  const lines = zoneLines;
  let lastNum: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.text.trim();
    if (!line || KEY_HEADING.test(line) || EXPL_HEADING.test(line)) continue;

    // Two-row layout: "1 2 3 4 5" then "A C D B A"
    const numsOnly = line.match(/^\s*(\d{1,3}(\s+\d{1,3}){2,})\s*$/);
    if (numsOnly && i + 1 < lines.length) {
      const next = lines[i + 1].text.trim();
      const letsOnly = next.match(/^\s*([A-Ea-e](\s+[A-Ea-e]){2,})\s*$/);
      if (letsOnly) {
        const nums = numsOnly[1].split(/\s+/).map(Number);
        const lets = letsOnly[1].split(/\s+/).map((s) => s.toUpperCase());
        if (nums.length === lets.length) {
          nums.forEach((n, k) => {
            if (!hits.has(n)) hits.set(n, { letter: lets[k], page: raw.page });
          });
          i++; // consume both rows
          continue;
        }
      }
    }

    PAIR.lastIndex = 0;
    const matches = [...line.matchAll(PAIR)].filter(
      (m) => m.index !== undefined && /[A-Ea-e]/.test(m[2] ?? ""),
    );
    if (!matches.length) {
      // continuation of the previous entry's explanation
      if (lastNum !== null && hits.has(lastNum)) {
        const h = hits.get(lastNum)!;
        h.explanation = `${h.explanation ?? ""} ${line}`.trim();
      }
      continue;
    }
    lastNum = null;

    const isCompact = line.length <= 72 || matches.length >= 2;
    if (!forceAll && !isCompact) {
      // long line with a single pair: treat remainder as explanation
      const m = matches[0];
      const num = Number(m[1]);
      const letter = (m[2] ?? "").toUpperCase();
      const afterIdx = (m.index ?? 0) + m[0].length;
      const expl = line.slice(afterIdx).replace(/^[\s:.\-–—)]+/, "").trim();
      if (!hits.has(num)) {
        hits.set(num, {
          letter,
          page: raw.page,
          explanation: expl.length >= 15 ? expl : undefined,
        });
      }
      continue;
    }

    let lastEnd = 0;
    let single = matches.length === 1;
    for (const m of matches) {
      const num = Number(m[1]);
      const letter = (m[2] ?? "").toUpperCase();
      lastEnd = (m.index ?? 0) + m[0].length;
      if (!hits.has(num)) hits.set(num, { letter, page: raw.page });
      lastNum = num;
    }
    if (single) {
      const m = matches[0];
      const num = Number(m[1]);
      const afterIdx = (m.index ?? 0) + m[0].length;
      const expl = line.slice(afterIdx).replace(/^[\s:.\-–—)]+/, "").trim();
      if (expl.length >= 15 && hits.get(num) && !hits.get(num)!.explanation) {
        hits.get(num)!.explanation = expl;
      }
      void lastEnd;
    }
  }
  return hits;
}

interface ZoneInfo {
  keyHits: Map<number, KeyHit>;
  explByNum: Map<number, { letter?: string; text: string }>;
  skip: boolean[]; // per original line index
  keyLocated: boolean;
}



function zoneScan(lines: PdfLine[]): ZoneInfo {
  const skip = new Array(lines.length).fill(false);
  const keyHits = new Map<number, KeyHit>();
  const explByNum = new Map<number, { letter?: string; text: string }>();
  let keyLocated = false;

  let mode: "none" | "key" | "expl" = "none";
  let zoneBuf: PdfLine[] = [];

  const flush = () => {
    if (!zoneBuf.length) return;
    if (mode === "key") {
      keyLocated = true;
      for (const [n, h] of parseKeyLines(zoneBuf)) if (!keyHits.has(n)) keyHits.set(n, h);
    } else if (mode === "expl") {
      parseExplZone(zoneBuf, explByNum);
    }
    zoneBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text.trim();
    if (KEY_HEADING.test(t)) {
      flush();
      mode = "key";
      skip[i] = true;
      continue;
    }
    if (EXPL_HEADING.test(t)) {
      flush();
      mode = "expl";
      skip[i] = true;
      continue;
    }
    if (mode !== "none") {
      zoneBuf.push(lines[i]);
      skip[i] = true;
    }
  }
  flush();

  // Fallback: dense CONTIGUOUS key-like run at the end of the document without
  // a heading. Scan backwards from the last line so legitimate question content
  // earlier in the document is never consumed.
  if (!keyLocated && keyHits.size < 4) {
    const minStart = Math.floor(lines.length * 0.5);
    let zoneStart = -1;
    let hits = 0;
    let gap = 0;
    for (let i = lines.length - 1; i >= minStart; i--) {
      PAIR.lastIndex = 0;
      const m = [...lines[i].text.matchAll(PAIR)];
      if (m.length >= 1) {
        hits++;
        gap = 0;
        zoneStart = i;
      } else if (zoneStart !== -1) {
        // allow short gaps: wrapped explanations and the zone heading itself
        gap++;
        zoneStart = i;
        if (gap > 2) {
          zoneStart = i + gap; // back off the gap lines beyond tolerance
          break;
        }
      }
    }
    const zoneLen = zoneStart === -1 ? 0 : lines.length - zoneStart;
    if (hits >= 4 && zoneLen > 0 && hits / zoneLen >= 0.4) {
      const zoneLines = lines.slice(zoneStart);
      const zoneHits = parseKeyLines(zoneLines);
      if (zoneHits.size >= 4) {
        keyLocated = true;
        for (const [n, h] of zoneHits) if (!keyHits.has(n)) keyHits.set(n, h);
        for (let i = zoneStart; i < lines.length; i++) skip[i] = true;
      }
    }
  }

  // Explanations without a heading, located after the key zone, rarely parse;
  // also map any explanation letters as fallback key hits.
  for (const [n, e] of explByNum) {
    if (e.letter && !keyHits.has(n)) keyHits.set(n, { letter: e.letter, page: 0, explanation: e.text });
  }

  return { keyHits, explByNum, skip, keyLocated };
}

// Public wrapper: parse an entire document as an answer key.
export function parseKeyLinesPublic(lines: PdfLine[]): Map<number, KeyHit> {
  return parseKeyLines(lines, true);
}

const EXPL_ENTRY = /^\s*\(?(\d{1,3})\)?\s*[\.\)\]:\-–]\s*(?:\(?([A-Ea-e])\)?\s*[\.\)\]:\-–]?\s*)?(.*)$/;

function parseExplZone(zoneLines: PdfLine[], out: Map<number, { letter?: string; text: string }>) {
  let curNum: number | null = null;
  for (const l of zoneLines) {
    const m = l.text.match(EXPL_ENTRY);
    if (m && m[3] !== undefined && m[3].trim().length >= 12) {
      curNum = Number(m[1]);
      out.set(curNum, {
        letter: m[2] ? m[2].toUpperCase() : undefined,
        text: m[3].trim(),
      });
    } else if (curNum !== null && l.text.trim()) {
      const prev = out.get(curNum);
      if (prev) prev.text = (prev.text + " " + l.text.trim()).trim();
    }
  }
}

// ---------------------------------------------------------------------------
// Question parsing state machine
// ---------------------------------------------------------------------------
const TICK_RE = /[✓✔☑√⍻✅»►●◉]/g;
const QNUM = /^\s*(?:(question|ques|qs|q)(?:[.:\s\-]+|(?=\d)))?\(?\s*(\d{1,3})/i;

// Matches "1. text", "(2) text", "Q.3 text", "Question 4 text", "5) text",
// "Q1 text". Returns null for non-question lines (e.g. "3.14 is ..." fails
// because the character right after the dot would be a digit).
export function matchQuestionStart(t: string): { num: number; rest: string } | null {
  const m = t.match(QNUM);
  if (!m) return null;
  const hasPrefix = !!m[1];
  const num = Number(m[2]);
  let rest = t.slice(m[0].length);
  let closed = false;
  const bracket = rest.match(/^[\)\]]/);
  if (bracket) {
    rest = rest.slice(1);
    closed = true;
  }
  const punct = rest.match(/^[\.\:\-–]\s*/);
  if (punct) {
    rest = rest.slice(punct[0].length);
    closed = true;
  }
  rest = rest.replace(/^\s+/, "");
  if (!rest || /^[\d]/.test(rest)) return null; // "3.14 ..." / empty guard
  if (!hasPrefix && !closed) return null; // bare number without separator
  return { num, rest };
}
const ANS_INLINE =
  /^\s*(?:correct\s*(?:answer|option)?|answer|ans|key)\b\s*[:\-.]?\s*\(?([A-Ea-e]|[1-5])\)?\b/i;
const EXPL_INLINE =
  /^\s*(?:explanation|explaination|solution|sol\.?|reason|rationale|hint)\b\s*[:\-.]?\s*(.*)$/i;

function scanOptionMarkers(line: string): { letter: string; start: number; contentStart: number; lower: boolean }[] {
  const out: { letter: string; start: number; contentStart: number; lower: boolean }[] = [];
  // Line-start / wide-gap / single-space-before-paren markers: "(A) x  (B) y",
  // "A) x    B) y", "(A) x (B) y" all supported.
  const re = /(?:^|[\t]|\s{2,}|\s(?=[(\[]|(?:[A-Ea-e][)\].])))[(\[]?([A-Ea-e])[)\].][\s]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    out.push({
      letter: m[1].toUpperCase(),
      start: m.index,
      contentStart: m.index + m[0].length,
      lower: m[1] === m[1].toLowerCase(),
    });
  }
  // A lone mid-sentence marker like "choose (A) ..." is not an option line
  if (out.length === 1 && out[0].start > 0) return [];
  // All-lowercase markers not at line start are inline references "(a) or (b)"
  if (out.length >= 1 && out[0].start > 0 && out.every((x) => x.lower)) return [];
  return out;
}

interface Builder {
  number: number | null;
  stem: string;
  options: Record<string, string>;
  optionBold: Record<string, number>;
  inlineAnswer: string | null;
  tickedOption: string | null;
  explanation: string | null;
  explMode: boolean;
  lastOpt: string | null;
  pageStart: number;
  pageEnd: number;
  order: number;
}

function newBuilder(number: number | null, page: number, order: number): Builder {
  return {
    number,
    stem: "",
    options: {},
    optionBold: {},
    inlineAnswer: null,
    tickedOption: null,
    explanation: null,
    explMode: false,
    lastOpt: null,
    pageStart: page,
    pageEnd: page,
    order,
  };
}

function expectedLetter(b: Builder): string {
  return LETTERS[Object.keys(b.options).length] ?? "Z";
}

function stripTicks(seg: string): { text: string; ticked: boolean } {
  const ticked = TICK_RE.test(seg);
  TICK_RE.lastIndex = 0;
  return { text: seg.replace(TICK_RE, "").replace(/\s{2,}/g, " ").trim(), ticked };
}

function applyOptionLine(b: Builder, line: PdfLine): boolean {
  const markers = scanOptionMarkers(line.text);
  if (!markers.length) return false;
  const expected = expectedLetter(b);

  let startIdx = -1;
  if (markers[0].letter === expected) {
    startIdx = 0;
  } else if (markers.length >= 2) {
    // horizontal layout segment not starting at expected letter: find expected inside ascending chain
    for (let i = 0; i < markers.length; i++) {
      if (markers[i].letter === expected) {
        startIdx = i;
        break;
      }
    }
    if (startIdx === -1 && LETTERS.includes(markers[0].letter)) {
      const chainOk = markers.every(
        (m, i) => i === 0 || LETTERS.indexOf(m.letter) === LETTERS.indexOf(markers[i - 1].letter) + 1,
      );
      if (chainOk && b.lastOpt === null && markers[0].letter === "A") startIdx = 0;
    }
  }
  if (startIdx === -1) return false;

  for (let i = startIdx; i < markers.length; i++) {
    const cur = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1].start : line.text.length;
    const { text, ticked } = stripTicks(line.text.slice(cur.contentStart, end));
    // prefix of the line before first marker might continue the stem
    if (i === startIdx && startIdx === 0 && cur.start > 0) {
      const prefix = line.text.slice(0, cur.start).trim();
      if (prefix && !b.lastOpt) b.stem = (b.stem ? b.stem + " " : "") + prefix;
    }
    if (!text) continue;
    if (b.options[cur.letter] === undefined) {
      b.options[cur.letter] = text;
      b.optionBold[cur.letter] = line.boldRatio;
      b.lastOpt = cur.letter;
    } else {
      b.options[cur.letter] = (b.options[cur.letter] + " " + text).trim();
    }
    if (ticked) b.tickedOption = cur.letter;
  }
  return true;
}

function finalizeBuilder(b: Builder, key: Map<number, KeyHit>, keyUsed: Set<number>): ResolvedQuestion {
  const warnings: string[] = [];
  const optLetters = Object.keys(b.options);
  if (optLetters.length === 0) warnings.push("no_options_detected");
  else if (optLetters.length !== 4) warnings.push(`expected_4_options_found_${optLetters.length}`);
  if (b.stem.trim().length < 3) warnings.push("question_text_too_short");

  // Bold-marked option detection: exactly one option clearly bolder than the rest
  let boldPick: string | null = null;
  const bolded = optLetters.filter((l) => (b.optionBold[l] ?? 0) >= 0.65);
  const nonBold = optLetters.filter((l) => (b.optionBold[l] ?? 0) < 0.5);
  if (bolded.length === 1 && nonBold.length >= Math.max(1, optLetters.length - 1)) {
    boldPick = bolded[0];
  }

  let correctAnswer: string | null = null;
  let answerSource: AnswerSource = "none";

  const keyHit = b.number !== null ? key.get(b.number) : undefined;
  if (keyHit) {
    correctAnswer = keyHit.letter;
    answerSource = "pdf_answer_key";
    keyUsed.add(b.number!);
  } else if (b.inlineAnswer) {
    correctAnswer = b.inlineAnswer;
    answerSource = "pdf_marked";
  } else if (b.tickedOption) {
    correctAnswer = b.tickedOption;
    answerSource = "pdf_marked";
  } else if (boldPick) {
    correctAnswer = boldPick;
    answerSource = "pdf_marked";
  }

  const numericMap: Record<string, string> = { "1": "A", "2": "B", "3": "C", "4": "D", "5": "E" };
  if (correctAnswer && numericMap[correctAnswer]) correctAnswer = numericMap[correctAnswer];

  if (correctAnswer && !(correctAnswer in b.options)) {
    warnings.push(`answer_${correctAnswer}_not_in_options`);
    correctAnswer = null;
    answerSource = "none";
  }

  return {
    number: b.number,
    text: b.stem.trim(),
    options: b.options,
    correctAnswer,
    answerSource,
    verificationStatus: correctAnswer ? "verified" : "needs_verification",
    explanation: b.explanation ? b.explanation.trim() : keyHit?.explanation ?? null,
    pageStart: b.pageStart,
    pageEnd: b.pageEnd,
    warnings,
  };
}

export function parseMcqPdf(linesIn: PdfLine[], opts: { wholeFileIsKey?: boolean } = {}): ParseResult {
  const warnings: string[] = [];
  const { lines, removed } = stripHeadersFooters(linesIn);

  if (opts.wholeFileIsKey) {
    const keyHits = parseKeyLines(lines, true);
    return { questions: [], keySize: keyHits.size, keyLocated: keyHits.size > 0, keyMatched: 0, warnings };
  }

  const zones = zoneScan(lines);
  const key = zones.keyHits;
  if (zones.keyLocated && key.size === 0) {
    warnings.push("An 'Answer Key' heading was found but no answers could be parsed from it.");
  }
  void removed;

  const parsed: Builder[] = [];
  let cur: Builder | null = null;
  let lastExplicit: number | null = null;
  let order = 0;

  const commit = () => {
    if (cur) parsed.push(cur);
  };

  for (let i = 0; i < lines.length; i++) {
    if (zones.skip[i]) {
      continue;
    }
    const line = lines[i];
    const t = line.text;
    if (!t.trim()) continue;

    // 1. Question start?
    const qm = matchQuestionStart(t);
    if (qm) {
      const num = qm.num;
      const seqOk =
        lastExplicit === null ||
        num === lastExplicit + 1 ||
        num === lastExplicit + 2 ||
        num === 1 || // section restart
        num === lastExplicit || // repeated numbering
        ((cur ? Object.keys(cur.options).length : 0) >= 2 && num > lastExplicit && num <= lastExplicit + 25);
      if (seqOk) {
        commit();
        cur = newBuilder(num, line.page, order++);
        lastExplicit = num;
        const rest = qm.rest.trim();
        if (rest) {
          // stem may contain inline options: "(A) x (B) y ..."
          if (!applyOptionLine(cur, { ...line, text: rest })) {
            cur.stem = rest;
          }
        }
        continue;
      }
    }

    if (!cur) continue;

    // 2. Inline answer / explanation markers
    const am = t.match(ANS_INLINE);
    if (am && Object.keys(cur.options).length > 0) {
      cur.inlineAnswer = am[1].toUpperCase();
      cur.explMode = false;
      continue;
    }
    const em = t.match(EXPL_INLINE);
    if (em && (Object.keys(cur.options).length > 0 || cur.inlineAnswer)) {
      cur.explanation = em[1] ?? "";
      cur.explMode = true;
      continue;
    }

    // 3. Option markers?
    if (!cur.explMode && applyOptionLine(cur, line)) {
      continue;
    }

    // 4. Continuation text
    cur.pageEnd = line.page;
    if (cur.explMode && cur.explanation !== null) {
      cur.explanation = (cur.explanation + " " + t.trim()).trim();
    } else if (cur.lastOpt) {
      const { text: seg, ticked } = stripTicks(t);
      cur.options[cur.lastOpt] = (cur.options[cur.lastOpt] + " " + seg).trim();
      if (ticked) cur.tickedOption = cur.lastOpt;
    } else {
      cur.stem = (cur.stem ? cur.stem + " " : "") + t.trim();
    }
  }
  commit();

  // Resolve answers & explanations
  const keyUsed = new Set<number>();
  const resolved = parsed.map((b) => finalizeBuilder(b, key, keyUsed));

  // Apply trailing explanation sections
  for (const r of resolved) {
    if (r.number !== null && zones.explByNum.has(r.number!)) {
      const e = zones.explByNum.get(r.number!)!;
      if (!r.explanation && e.text) r.explanation = e.text;
      if (!r.correctAnswer && e.letter && e.letter in r.options) {
        r.correctAnswer = e.letter;
        r.answerSource = "pdf_answer_key";
        r.verificationStatus = "verified";
      }
    }
  }

  // Sequential matching fallback when explicit numbers did not overlap the key
  const keyMatchedByNumber = keyUsed.size;
  let keyMatched = keyMatchedByNumber;
  if (key.size >= 3 && keyMatchedByNumber < Math.max(2, key.size * 0.3) && resolved.length >= 3) {
    const sortedKeyNums = [...key.keys()].sort((a, b) => a - b);
    let applied = 0;
    resolved.forEach((r, i) => {
      if (i < sortedKeyNums.length) {
        const hit = key.get(sortedKeyNums[i]);
        if (hit && hit.letter in r.options && !r.correctAnswer) {
          r.correctAnswer = hit.letter;
          r.answerSource = "pdf_answer_key";
          r.verificationStatus = "verified";
          if (!r.explanation && hit.explanation) r.explanation = hit.explanation;
          applied++;
        }
      }
    });
    keyMatched = applied;
  } else if (key.size >= 3 && keyMatchedByNumber === 0 && resolved.length >= 3 && lastExplicit === null) {
    keyMatched = 0;
  }

  if (!resolved.length) {
    warnings.push(
      "No MCQ blocks were detected. Ensure questions are numbered and options are labelled A-D.",
    );
  }
  if (key.size > 0 && keyMatched === 0) {
    warnings.push(
      "An answer key was found but it could not be matched to any question numbers.",
    );
  }

  return {
    questions: resolved,
    keySize: key.size,
    keyLocated: zones.keyLocated || key.size >= 3,
    keyMatched,
    warnings,
  };
}
