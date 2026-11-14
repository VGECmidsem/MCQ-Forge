# Manual verification checklist

A copy-paste-free walkthrough of MCQForge in a browser. Every label below matches the
text on screen. Total time: **~10 minutes**.

- [ ] **A.** Get it running
- [ ] **B.** Load questions (2 min)
- [ ] **C.** Check extraction quality (3 min)
- [ ] **D.** Edit & verify the bank (2 min)
- [ ] **E.** Take a mock test (3 min)
- [ ] **F.** Read the results
- [ ] **G.** Backup / restore
- [ ] **H.** Extras (dark mode, mobile)

---

## A. Get it running

**Option 1 — the live preview (already running for you)**
Open the preview panel for this session. The dashboard should load with the nav bar
(Dashboard · Upload PDFs · Question Bank · New Test · My Tests).

**Option 2 — on your own machine**

```bash
git clone https://github.com/VGECmidsem/MCQ-Forge.git
cd MCQ-Forge
git checkout arena/19231e3d-mcq-forge     # this branch, if not merged yet
npm install
npm run site                               # → http://localhost:3000
```

Wait for the line `[mcqforge] MCQForge is live → http://localhost:3000`.
If it prints `Failed:` instead, stop and report the error.

✅ **Pass:** the dashboard renders with stats cards (`Questions in bank`, `Verified answers`,
`Needs verification`, `PDFs processed`, `Attempts submitted`, `Average score`).

---

## B. Load questions (2 min)

1. On the dashboard, click **Load demo question bank** (the sparkle button, top right).
2. Green text appears: *Loaded 18 demo questions — try generating a test!*
3. Click it a second time → *The demo bank is already loaded.* (correct, no duplicates)

Now upload real PDFs. Generate the sample files first (in the repo):

```bash
node scripts/make-samples.mjs      # writes 4 PDFs to scratch/samples/
```

Go to **Upload PDFs** in the nav and drag in **`scratch/samples/sample-vertical-key.pdf`**.

✅ **Pass:** a progress row appears (*Queued* → processing → done) and the source is listed in
*Recent imports* with ~5 questions found.

Then upload the other three, one at a time:

| File | What it proves | Expect |
| --- | --- | --- |
| `sample-horizontal-inline.pdf` | inline `Ans:` answers, horizontal options | 4 questions |
| `sample-bold-marked.pdf` | answers marked only in bold | 3 questions |
| `sample-scanned.pdf` | image-only page → OCR | 3 questions, OCR takes a few seconds |

---

## C. Check extraction quality (3 min)

Go to **Question Bank**.

1. Each question shows its text, options, a status pill (**Verified** / **Needs verification**),
   and the source PDF name.
2. Filter with **All statuses → Needs verification**.
3. Filter with **All topics → Physics** (or any topic) and confirm the list narrows.
4. Type a word from a question into the search box (e.g. `circuit`) and press Enter.
5. Click **Find duplicates** → a dialog reports exact/near duplicates it found.
   (Your own uploads may legitimately duplicate the demo bank — that is expected.)

✅ **Pass:** filters/search return sensible subsets; nothing renders as `undefined` or blank.

---

## D. Edit & verify the bank (2 min)

Still on **Question Bank**:

1. Click **Edit** on any question → dialog opens with text, options, answer, explanation, topic.
2. Change the **Topic / category**, pick a different **Correct answer**, press **Save**.
3. The row updates immediately.
4. Click **Add question** → fill in a question + 4 options + answer → **Save** → it appears at the
   top of the list.
5. Open **Delete** on that new question → confirm → it disappears.

✅ **Pass:** edits persist after a hard refresh (F5) — this proves data reached PostgreSQL.

---

## E. Take a mock test (3 min)

1. **New Test** in the nav.
2. Set **Question pool → Entire bank**, **Number of questions → 10**.
3. Leave **Shuffle question order** and **Shuffle options within each question** ticked.
4. Set **Marks per question** 1 and **Negative marks per wrong answer** 0.25, duration 5.
5. Click **Start test**.

In the exam:

- Answer a few with the **A/B/C/D** buttons (or keyboard **1–4** / **a–d**).
- Use **←/→** arrow keys to move between questions.
- Click **Mark for review** on one question, then open **Question palette**.
- Refresh the page (F5) → it resumes on the same question with your answers intact (`Autosaved`).
- Double-check the countdown is ticking.

✅ **Pass:** answers survive a refresh; palette shows answered/unanswered/marked states distinctly.

6. Click **Submit now** → confirm.

---

## F. Read the results

✅ **Pass:** all of these are present and consistent:

- **Score** donut / percentage
- **Attempted**, **Correct**, **Incorrect**, **Unanswered** — and the four numbers add up to the total
- **Accuracy** and **Time taken**
- **Marks obtained** vs max, with negative marks subtracted
- **Question-by-question review** — each row shows *your pick* vs **Correct answer**,
  plus **Explanation** where the PDF had one

Then click **Retake this test** → a fresh attempt opens with the same questions in a new order
(shuffled options may move an answer to a different letter — that is intended).

---

## G. Backup / restore

1. **Question Bank** → the three export buttons **JSON / CSV / XLSX**.
2. Click **JSON** → a file like `mcqforge-backup-2026-11-14.json` downloads.
3. Click **Restore backup** → pick that same file.
4. ✅ **Pass:** *Imported 0 question(s), skipped N duplicates/invalid.* — restoring your own
   backup must never duplicate rows.

Optionally open the CSV/XLSX in Excel/Sheets and confirm the columns
(`question_text`, `option_a`…, `correct_answer`, `topic`, …) are filled in.

---

## H. Extras

- **Dark mode:** click the moon/sun icon in the nav. The page switches instantly, and the icon
  changes. Refresh → it stays dark (remembered). **No token/crypto is needed for this.**
- **Mobile:** shrink the browser to phone width. The nav collapses to a ☰ menu, and the exam
  palette becomes a drawer.
- **Health check:** visit `/api/health` → should show `{"ok":true}`.

---

## If something fails

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Failed: DATABASE_URL is required` | Running `npm run dev`/`start` without a DB | Use `npm run site`, or set `DATABASE_URL` |
| Dashboard shows an error banner | Postgres not reachable | Check `npm run site` output; confirm nothing else uses port 54329 |
| Upload stuck on *Queued* | Server process died | Check the terminal for errors |
| OCR page flagged, not extracted | Model file missing | Confirm `assets/tesseract/eng.traineddata` exists |
| Everything 500s after pulling new code | Schema changed | `npm run db:migrate` |

Report the exact screen + any terminal output, and it can be fixed quickly.

---

## Automated version

If you would rather run the same checks from a terminal:

```bash
npm run lint && npm run typecheck && npm run build   # static checks (no DB needed)
npm run db:migrate                                   # apply schema (needs DATABASE_URL)
curl -s localhost:3000/api/health                    # expect {"ok":true}
curl -s localhost:3000/api/stats                     # question/test counts as JSON
```
