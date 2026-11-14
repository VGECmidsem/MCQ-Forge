# Running MCQForge from GitHub

Four ways to get the app running, depending on what you want to do. All of them start from the
same repository: **https://github.com/VGECmidsem/MCQ-Forge**

| I want to… | Use | Time | Needs |
| --- | --- | --- | --- |
| **Just see it work** | [A. GitHub Codespaces](#a-github-codespaces-easiest-no-install) | ~3 min | a GitHub account |
| **Host it at a public URL** | [B. Deploy from GitHub](#b-deploy-from-github-public-website) | ~10 min | GitHub + a host account |
| **Run it on my computer** | [C. Clone and run locally](#c-run-it-on-your-own-computer) | ~3 min | Node.js 22 |
| **Keep it up to date / contribute** | [D. Everyday git workflow](#d-everyday-git-workflow) | — | git |

---

## A. GitHub Codespaces (easiest, no install)

This is the "run it in GitHub" way — the whole app runs in a container in your browser.

1. Open **https://github.com/VGECmidsem/MCQ-Forge**
2. Click the green **Code** button → **Codespaces** tab → **Create codespace on main**
   (or press <kbd>.</kbd> on the repo page for github.dev — note that *that* only edits code,
   it does **not** run the app).
3. Wait for setup. The repo ships a `.devcontainer`, so it installs dependencies automatically
   and then starts the app via `npm run site`.
4. When the terminal shows

   ```
   [mcqforge] MCQForge is live → http://localhost:3000
   ```

   VS Code pops a **"Open in Browser"** notification for port 3000 — click it. If you missed it,
   open the **Ports** tab (next to Terminal) and click the forwarded **3000** address.

The embedded PostgreSQL starts with the app, so there is nothing else to install. Your questions
persist inside the Codespace as long as it isn't deleted.

**Useful commands in the Codespace terminal**

```bash
npm run site                 # start the app (port 3000)
npm run site -- --build      # rebuild after pulling new code
npm run site -- --port 4000  # different port (forward 4000 in the Ports tab)
docker compose up -d --build # alternative: app + Postgres containers
```

> ⚠️ A Codespace **stops automatically** after ~30 min of inactivity and is deleted after a
> retention period (30 days by default). Treat it as a demo environment, not a permanent home for
> your question bank — use *Question Bank → JSON export* for backups, or option B for something
> permanent.

---

## B. Deploy from GitHub (public website)

You don't need this repo on your machine — the host builds it from GitHub.

### Railway (recommended, free tier)

1. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** →
   authorise and pick **MCQ-Forge**.
   Railway reads the included `railway.json` and `Dockerfile`; no extra configuration.
2. In the same project: **New → Database → PostgreSQL**.
3. Open the web service → **Variables** → add
   `DATABASE_URL` with the value `${{Postgres.DATABASE_URL}}` (Railway's reference syntax).
4. **Settings → Networking → Generate Domain**. Open that URL — that is your site.

Migrations run automatically on every deploy; Railway waits for `/api/health` first.

### Render

1. [render.com](https://render.com) → **New → Web Service** → connect **MCQ-Forge**.
2. Runtime **Node**; Build `npm ci && npm run build`;
   Start `node scripts/migrate.mjs && node node_modules/next/dist/bin/next start -H 0.0.0.0 -p $PORT`.
3. **New → PostgreSQL** → copy its *Internal Connection String* into the web service's
   `DATABASE_URL` → deploy.

### Vercel (needs an external database)

`vercel.json` is included. Vercel is serverless, so Postgres must be reachable over the internet:

```bash
npm i -g vercel
vercel link                          # choose the GitHub repo when prompted
vercel env add DATABASE_URL production   # paste your Neon/Supabase connection string
DATABASE_URL='postgresql://…' npm run db:migrate   # create the tables once, from anywhere
vercel --prod
```

Full details, HTTPS on your own server, backups and schema changes: **[DEPLOY.md](DEPLOY.md)**.

---

## C. Run it on your own computer

You can clone via HTTPS (no setup) or SSH (needs a key added to GitHub).

```bash
# HTTPS — simplest
git clone https://github.com/VGECmidsem/MCQ-Forge.git
cd MCQ-Forge

# or SSH — if you have a key on your GitHub account
git clone git@github.com:VGECmidsem/MCQ-Forge.git
```

Then:

```bash
npm install
npm run site            # → http://localhost:3000
```

Requires **Node.js 22+** (`node -v`). No PostgreSQL install needed — the app boots its own.

---

## D. Everyday git workflow

```bash
git checkout main && git pull          # get the latest
npm install                            # only when package.json changed
npm run site -- --build                # rebuild + start
```

**Working on a change:**

```bash
git checkout -b my-feature
# …edit files…
npm run lint && npm run typecheck      # must pass (CI enforces both)
git add -A && git commit -m "Describe the change"
git push -u origin my-feature
```

Then open a **Pull Request** on GitHub. The included workflow
(`.github/workflows/ci.yml`) runs lint, typecheck and a production build on every push and PR —
green checks mean the code builds anywhere, with no database required.

**Schema changes:** edit `src/db/schema.ts`, run `npm run db:generate`, and commit the new file
in `drizzle/`. It is applied automatically on the next start or deploy.

---

## Common problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Failed: DATABASE_URL is required` | used `npm run dev` / `npm start` without a database | use `npm run site`, or set `DATABASE_URL` |
| Codespace shows "port 3000 not forwarded" | app not started yet | run `npm run site`; check the **Ports** tab |
| Page loads but every action errors | database not running | restart `npm run site` (it starts Postgres too) |
| `EADDRINUSE :3000` | app already running | stop the old terminal, or `npm run site -- --port 4000` |
| Upload stuck on *Queued* | server process died | check the terminal for a stack trace |
| Build fails on a host with `Error: DATABASE_URL is required` | stale branch | this was fixed on `main`; make sure you deploy current `main` |

---

## What is *not* on GitHub

- **GitHub Pages is not an option.** Pages only serves static files — no Node process, no
  PostgreSQL, no OCR. The Pages site currently enabled on this repo renders `README.md` with
  Jekyll, which looks like a published app but isn't. Use Codespaces (A) or a real host (B).
- Question data lives in PostgreSQL, not in the repo. Nothing you upload is committed — commit
  history stays clean and safe to share.
