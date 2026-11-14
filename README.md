# MCQForge — PDF → Question Bank → Mock Test Studio

Extract multiple-choice questions from PDF files (text-based *or* scanned), resolve the correct
answers, curate a persistent question bank, and generate timed, exam-style mock tests with full
performance analytics.

## Feature overview

| Area | What it does |
| --- | --- |
| PDF upload | Multi-file upload with 20 MB / per-file validation, progress queue, per-file type (question paper or standalone answer key). Files are processed in memory; **original PDFs are never stored** — only extracted questions land in PostgreSQL. |
| Text extraction | pdf.js (server side) with positional line reconstruction: vertical or horizontal option layouts, multi-line stems, questions spanning pages, repeated header/footer removal. |
| OCR | Scanned/image-only pages are rendered with pdf.js + `@napi-rs/canvas` and read with `tesseract.js` (`eng`). Pages that fail OCR are flagged instead of dropped. |
| MCQ parsing | Deterministic state machine — numbered questions in every common numbering style (`1.`, `(1)`, `Q.1`, `Question 12`, `5)`), options marked `(A)` / `A)` / `A.`, 2–6 options, inline and trailing explanations. |
| Answer resolution (priority) | ① End-of-document / heading-anchored answer keys (tables, `1. B`, `12) (A)`, two-row OMR rows, keys with explanations) matched by number — with order fallback when numbering doesn't overlap; ② tick marks (✓), bold-marked options, inline `Ans:`/`Answer:` labels; ③ AI solving (opt-in, per selection); ④ everything unresolved is flagged **Needs Verification** — never guessed. |
| Answer keys in separate files | Upload a key-only PDF; "Fill unresolved only" mode fills gaps without overwriting, or target a specific source to re-apply a whole key. |
| Review dashboard | Search, status/topic/source filters, duplicate & warning filters, full edit dialog (text, options, answer, explanation, topic), delete, bulk verify/retopic/delete, exact + near-duplicate scan (near-dups reported, never auto-deleted), manual question entry. |
| AI answers | Select unresolved questions → *Solve with AI*. Strictly-JSON LLM call (Gemini or OpenAI-compatible), per-question confidence (`unknown` stays flagged), explanation stored. AI answers are labelled `ai_generated` and visually distinct from PDF answers. Keys stay server-side. |
| Question bank | Persistent PostgreSQL storage, source/page/number retained per question, auto topic classification, JSON/CSV/Excel export, JSON backup restore with duplicate skipping, full wipe with confirmation. |
| Mock tests | Configurable: pool (all / sources / topics / hand-picked), question count, shuffle questions, **shuffle options per-question with scoring mapped back to the true answer**, timer, marks/question, negative marking, opt-in unverified questions (excluded from grading). |
| Exam UI | One question at a time, A–D choice buttons, prev/next, mark-for-review, jump palette with answered/unanswered/marked states, live countdown, keyboard shortcuts (1–4, arrows), autosave + resume, guarded submit. Mobile responsive with palette drawer. |
| Results | Score donut, attempted/correct/incorrect/unanswered/ungraded, marks & negative marks, accuracy, time taken, topic-wise bars, full question review with your pick vs correct answer + explanations, filters (incorrect/marked), retake and new-random-test actions. |

## Tech stack

- **Next.js 16 (App Router) + React 19 + TypeScript**, Tailwind CSS v4, Lucide icons
- **PostgreSQL + Drizzle ORM** (`sources`, `questions`, `tests`, `attempts`)
- pdf.js `pdfjs-dist` (server-side text extraction + rendering), `tesseract.js` OCR, `xlsx` export
- Deterministic parsing wherever possible — AI is used only for question solving, never for extraction

## Environment variables (all optional, server-side only)

```env
GEMINI_API_KEY=...        # enables AI answer generation via Gemini (recommended)
GEMINI_MODEL=gemini-2.0-flash
# — OR —
OPENAI_API_KEY=...        # any OpenAI-compatible chat-completions API
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

Without an AI key everything still works: answer keys, marked answers, manual editing, tests,
and the whole bank are fully functional — unresolved questions just remain *Needs Verification*.

## Testing the pipeline

Generate sample PDFs covering every supported layout and run them through `/upload`:

```bash
node scripts/make-samples.mjs   # writes 4 sample PDFs to scratch/samples/
```

- `sample-vertical-key.pdf` — vertical options + trailing answer key with explanations
- `sample-horizontal-inline.pdf` — horizontal options + inline `Ans:` markers + multi-line stems
- `sample-bold-marked.pdf` — correct answers marked in bold (no key at all)
- `sample-scanned.pdf` — image-only page that exercises the OCR pipeline

There's also a one-click **demo question bank** on the home dashboard for instant testing.
