// Shared PDF → question-bank processing pipeline with phase progress
// reporting. Used by both the plain JSON upload route and the streaming
// (progress bar) route so behaviour can never diverge between them.

import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { questions, sources } from "@/db/schema";
import { extractPdf } from "@/lib/pdf/extract";
import { parseKeyLinesPublic, parseMcqPdf } from "@/lib/pdf/parse";
import { classifyTopic, fingerprintOf } from "@/lib/utils";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type Phase = "upload" | "extract" | "parse" | "dedupe" | "save" | "done";

export interface ProgressEvent {
  type: "progress";
  phase: Phase;
  percent: number; // 0..100 overall
  message: string;
  page?: number;
  pageCount?: number;
}

export type Emit = (e: ProgressEvent) => void;

// Overall weighting of each phase (extraction dominates).
const SPAN: Record<Exclude<Phase, "done">, [number, number]> = {
  upload: [0, 4],
  extract: [4, 78],
  parse: [78, 88],
  dedupe: [88, 94],
  save: [94, 99],
};

function at(phase: Exclude<Phase, "done">, ratio: number): number {
  const [a, b] = SPAN[phase];
  return Math.round((a + (b - a) * Math.max(0, Math.min(1, ratio))) * 10) / 10;
}

function hash(text: string, options: Record<string, string>): string {
  return crypto.createHash("sha256").update(fingerprintOf(text, options)).digest("hex").slice(0, 32);
}

export interface ProcessInput {
  buffer: Buffer;
  filename: string;
  size: number;
  kind: "questions" | "answer_key";
  targetSourceId?: string | null;
}

export async function processPdfUpload(
  input: ProcessInput,
  emit: Emit = () => {},
): Promise<Record<string, unknown>> {
  const { buffer, filename, size, kind, targetSourceId } = input;
  const pipeStart = Date.now();

  emit({ type: "progress", phase: "upload", percent: at("upload", 1), message: "File received — opening PDF…" });

  const [src] = await db
    .insert(sources)
    .values({ filename, sizeBytes: size, kind, status: "processing" })
    .returning();

  try {
    const extracted = await extractPdf(buffer, {
      maxOcrPages: 40,
      enableOcr: true,
      onProgress: (p) =>
        emit({
          type: "progress",
          phase: "extract",
          percent: at("extract", p.ratio),
          message: p.message,
          page: p.page,
          pageCount: p.pageCount,
        }),
    });
    const warnings: string[] = [...extracted.warnings];

    // ---------------------------------------------------------------- key file
    if (kind === "answer_key") {
      emit({ type: "progress", phase: "parse", percent: at("parse", 0.4), message: "Reading answer key entries…" });
      const keyMap = parseKeyLinesPublic(extracted.lines);
      let applied = 0;
      if (keyMap.size > 0) {
        emit({
          type: "progress",
          phase: "save",
          percent: at("save", 0.2),
          message: `Matching ${keyMap.size} key entries to bank questions…`,
        });
        const conds = targetSourceId ? [eq(questions.sourceId, targetSourceId)] : [];
        const existing = await db
          .select({
            id: questions.id,
            questionNumber: questions.questionNumber,
            options: questions.options,
            answerSource: questions.answerSource,
          })
          .from(questions)
          .where(conds.length ? and(...conds) : undefined);
        const updates: Promise<unknown>[] = [];
        for (const q of existing) {
          if (q.questionNumber === null) continue;
          const hit = keyMap.get(q.questionNumber);
          if (!hit) continue;
          if (!(hit.letter in (q.options as Record<string, string>))) continue;
          if (q.answerSource === "manual") continue; // never overwrite manual edits
          // Global key uploads fill gaps only; scoped uploads (targetSourceId)
          // may overwrite previously resolved answers in that source.
          if (!targetSourceId && q.answerSource !== "none") continue;
          updates.push(
            db
              .update(questions)
              .set({
                correctAnswer: hit.letter,
                answerSource: "pdf_answer_key",
                verificationStatus: "verified",
                updatedAt: new Date(),
              })
              .where(eq(questions.id, q.id)),
          );
          applied++;
        }
        await Promise.all(updates);
      }
      if (applied === 0) warnings.push("No bank questions could be matched to this answer key yet.");
      await db
        .update(sources)
        .set({
          status: applied > 0 ? "done" : "partial",
          pageCount: extracted.pageCount,
          keyAnswersFound: applied,
          warnings,
        })
        .where(eq(sources.id, src.id));

      emit({ type: "progress", phase: "done", percent: 100, message: "Answer key applied." });
      return {
        sourceId: src.id,
        kind,
        filename,
        pageCount: extracted.pageCount,
        kindDetected: extracted.kind,
        keyAnswersApplied: applied,
        warnings,
        timings: { ...extracted.timings, totalMs: Date.now() - pipeStart },
      };
    }

    // ------------------------------------------------------------ question PDF
    emit({ type: "progress", phase: "parse", percent: at("parse", 0.2), message: "Identifying questions and options…" });
    const parseStart = Date.now();
    const parsed = parseMcqPdf(extracted.lines);
    const parseMs = Date.now() - parseStart;
    warnings.push(...parsed.warnings);
    emit({
      type: "progress",
      phase: "parse",
      percent: at("parse", 1),
      message: `Found ${parsed.questions.length} question(s)${parsed.keyLocated ? " + answer key" : ""}.`,
    });

    const rows = parsed.questions.map((q) => {
      const topicGuess = classifyTopic(`${q.text} ${Object.values(q.options).join(" ")}`);
      return {
        sourceId: src.id,
        sourceLabel: filename,
        pageNumber: q.pageStart,
        questionNumber: q.number,
        text: q.text || "(question text could not be extracted)",
        options: q.options,
        correctAnswer: q.correctAnswer,
        answerSource: q.correctAnswer ? q.answerSource : "none",
        verificationStatus: q.verificationStatus,
        topic: topicGuess,
        explanation: q.explanation,
        warnings: [...q.warnings, ...(q.pageEnd > q.pageStart ? ["spans_multiple_pages"] : [])],
        contentHash: hash(q.text, q.options),
      };
    });

    emit({ type: "progress", phase: "dedupe", percent: at("dedupe", 0.3), message: "Checking for duplicates…" });
    const dedupeStart = Date.now();
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.contentHash)) r.warnings.push("duplicate_within_file");
      seen.add(r.contentHash);
    }
    const uniqueHashes = [...seen];
    if (uniqueHashes.length) {
      const existing = await db
        .select({ h: questions.contentHash })
        .from(questions)
        .where(inArray(questions.contentHash, uniqueHashes));
      const existSet = new Set(existing.map((e) => e.h));
      for (const r of rows) if (existSet.has(r.contentHash)) r.warnings.push("duplicate_of_existing");
    }

    const dedupeMs = Date.now() - dedupeStart;
    const saveStart = Date.now();
    for (let i = 0; i < rows.length; i += 200) {
      emit({
        type: "progress",
        phase: "save",
        percent: at("save", rows.length ? i / rows.length : 1),
        message: `Saving questions to the bank (${Math.min(i + 200, rows.length)}/${rows.length})…`,
      });
      await db.insert(questions).values(rows.slice(i, i + 200));
    }
    const saveMs = Date.now() - saveStart;

    const verified = rows.filter((r) => r.verificationStatus === "verified").length;
    await db
      .update(sources)
      .set({
        status: rows.length ? (verified === rows.length ? "done" : "partial") : "failed",
        pageCount: extracted.pageCount,
        questionsFound: rows.length,
        keyAnswersFound: parsed.keyMatched,
        warnings,
      })
      .where(eq(sources.id, src.id));

    emit({ type: "progress", phase: "done", percent: 100, message: "Extraction complete." });

    return {
      sourceId: src.id,
      kind,
      filename,
      pageCount: extracted.pageCount,
      kindDetected: extracted.kind,
      questionsFound: rows.length,
      answersResolved: verified,
      needsVerification: rows.length - verified,
      keyLocated: parsed.keyLocated,
      keyMatched: parsed.keyMatched,
      warnings,
      timings: {
        ...extracted.timings,
        parseMs,
        dedupeMs,
        saveMs,
        totalMs: Date.now() - pipeStart,
      },
    };
  } catch (e: any) {
    const message = e?.message || "Failed to process the PDF.";
    await db.update(sources).set({ status: "failed", warnings: [message] }).where(eq(sources.id, src.id));
    const err = new Error(message) as Error & { sourceId?: string };
    err.sourceId = src.id;
    throw err;
  }
}

export function validateUpload(file: unknown): { file: File; error?: undefined } | { error: string; file?: undefined } {
  if (!(file instanceof File)) return { error: "No PDF file was uploaded." };
  const filename = (file.name || "document.pdf").slice(0, 200);
  if (!/\.pdf$/i.test(filename) && file.type !== "application/pdf") {
    return { error: "Only PDF files are accepted." };
  }
  if (file.size === 0) return { error: "The uploaded file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "File exceeds the 20 MB limit." };
  return { file };
}
