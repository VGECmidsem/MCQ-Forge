# Publishing & running MCQForge as a website

MCQForge is a full **Next.js server application** with a **PostgreSQL** database. It is not a
static site, so "publishing" it means running one Node process next to one Postgres database.
Below are four ways to do that, from fastest to most production-ready.

| Path | Time | Best for | Cost |
| --- | --- | --- | --- |
| 1. `npm run site` (local) | ~2 min | Using it on your own machine/laptop | Free |
| 2. Docker Compose (VPS) | ~10 min | A real public URL on your own server | VPS price |
| 3. Railway / Render (managed) | ~10 min | A public URL without servers to maintain | Free tier / ~$5 |
| 4. Vercel + Neon | ~10 min | Global CDN hosting, serverless | Free tier |

> **Requirements in every case:** Node.js 22+ (for the local path) and a database URL in
> `DATABASE_URL`. Tables are created for you — no manual SQL.

---

## 1. Local: one command, zero setup

```bash
git clone https://github.com/VGECmidsem/MCQ-Forge.git
cd MCQ-Forge
npm install
npm run site            # → http://localhost:3000
```

`npm run site` is a wrapper around the app that:

1. downloads and boots an **embedded PostgreSQL** (no Postgres install, data kept in `.data/pg`),
2. creates the `mcqforge` database on first run,
3. applies the SQL migrations in `drizzle/`,
4. builds the app once and serves it on `http://localhost:3000` (bound to `0.0.0.0`, so other
   devices on your LAN can open `http://<your-ip>:3000` too).

Useful flags:

```bash
npm run site -- --port 4000        # different port
npm run site -- --build            # force a rebuild after code changes
npm run site -- --data-dir /path   # keep the database somewhere else
DATABASE_URL=postgres://… npm run site   # use an existing Postgres instead
```

Click **“Load demo question bank”** on the dashboard to fill it with 18 sample questions, or
upload one of the sample PDFs (`node scripts/make-samples.mjs`).

To stop it, press `Ctrl+C` — the web server and the embedded database shut down together.

**Development mode** (hot reload while you edit code) needs a real `DATABASE_URL`:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/mcqforge npm run db:migrate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/mcqforge npm run dev
```

---

## 2. Publish on your own server (Docker Compose)

The repo ships a `Dockerfile` and a `docker-compose.yml` with Postgres included.

```bash
# on a VPS with Docker installed
git clone https://github.com/VGECmidsem/MCQ-Forge.git
cd MCQ-Forge
docker compose up -d --build      # → http://<server-ip>:3000
docker compose logs -f web        # watch migrations + startup
```

Before exposing it publicly, change the database password in `docker-compose.yml`
(`POSTGRES_PASSWORD` **and** the matching part of `DATABASE_URL`), and put HTTPS in front
(e.g. Caddy or `nginx` + Let's Encrypt):

```caddyfile
mcq.example.com {
    reverse_proxy localhost:3000
}
```

Data lives in the `pgdata` Docker volume, so `docker compose down` keeps your questions;
`docker compose down -v` deletes them.

Without Compose, any Docker host works:

```bash
docker build -t mcqforge .
docker run -p 3000:3000 -e DATABASE_URL=postgres://user:pass@host:5432/mcqforge mcqforge
```

---

## 3. Publish on Railway or Render (managed Postgres, no server admin)

**Railway**

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → pick `MCQ-Forge`.
   Railway reads `railway.json` and builds the included `Dockerfile`.
2. In the same project, **New → Database → PostgreSQL**.
3. On the web service, add a variable
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}` (Railway's reference syntax).
4. **Settings → Networking → Generate Domain.** That URL is your website.
   Migrations run automatically on each deploy (`node scripts/migrate.mjs` in the start command),
   and Railway waits for `/api/health` before routing traffic.

**Render**

1. [render.com](https://render.com) → **New → Web Service** → connect the repo.
2. Runtime **Node**, build `npm ci && npm run build`,
   start `node scripts/migrate.mjs && node node_modules/next/dist/bin/next start -H 0.0.0.0 -p $PORT`.
3. **New → PostgreSQL** (free tier is fine) → copy its *Internal Connection String* into the web
   service's `DATABASE_URL` environment variable.
4. Deploy. Health check path: `/api/health`.

Both platforms give you `https://<name>.up.railway.app` / `https://<name>.onrender.com`
immediately — that is the site your students open.

---

## 4. Publish on Vercel (serverless) + a hosted Postgres

`vercel.json` is included, but Vercel must be able to reach Postgres over the public internet, so
use a hosted database such as [Neon](https://neon.tech) (free tier) or Supabase.

```bash
# 1. create a Neon project, copy its pooled connection string (sslmode=require)
# 2. create the tables once, from your machine:
DATABASE_URL='postgresql://…neon.tech/mcqforge?sslmode=require' npm run db:migrate

# 3. deploy
npm i -g vercel
vercel link
vercel env add DATABASE_URL production     # paste the Neon URL
vercel --prod                              # → https://<project>.vercel.app
```

Notes for Vercel:

- `vercel.json` sets the upload route to 3000 MB / 300 s so scanned PDFs can be OCR'd.
- Vercel's filesystem is read-only outside `/tmp`; nothing here writes to disk, so this is fine.
- OCR language data is bundled in `assets/tesseract/`, so no CDN access is needed at runtime.
- If a big scan times out on the Hobby plan, keep PDFs under ~20 MB or use options 2/3.

---

## Environment variables

Set these on whichever platform you choose (all optional except `DATABASE_URL`):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | **Required.** PostgreSQL connection string. |
| `GEMINI_API_KEY` | Enables *Solve with AI* via Gemini (recommended). |
| `GEMINI_MODEL` | Default `gemini-2.0-flash`. |
| `OPENAI_API_KEY` | Alternative: any OpenAI-compatible chat API. |
| `OPENAI_BASE_URL` | Default `https://api.openai.com/v1`. |
| `OPENAI_MODEL` | Default `gpt-4o-mini`. |

Everything works without AI keys — unresolved answers simply stay marked *Needs Verification*.

---

## Keeping it published: updates and backups

```bash
git pull && npm install && npm run site -- --build     # local
docker compose up -d --build                            # Docker/VPS
git push origin main                                    # Railway/Render auto-redeploy
```

**Backups:** *Question Bank → Export → JSON backup* produces a complete dump that
*Import* restores later. For the database itself:

```bash
docker compose exec db pg_dump -U mcqforge mcqforge > backup.sql   # Docker
pg_dump "$DATABASE_URL" > backup.sql                               # any Postgres
```

**Schema changes:** edit `src/db/schema.ts`, then `npm run db:generate` (writes a new SQL file
into `drizzle/`) and commit it — migrations apply automatically on the next start/deploy.

---

## Which option should I pick?

- **Just want to use it now** → `npm run site`.
- **Need a URL to share with the class, and I have a VPS** → Docker Compose + Caddy.
- **Need a URL, no server to babysit** → Railway (Dockerfile) or Render.
- **Want a global CDN and don't mind an external database** → Vercel + Neon.

Nothing in the app requires a specific host: it needs one Node process and one Postgres URL.
