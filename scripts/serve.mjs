#!/usr/bin/env node
// MCQForge — one-command local website.
//
//   npm run site            # http://localhost:3000
//   npm run site -- --port 4000
//
// What the wrapper does:
//   1. If DATABASE_URL is set, it uses that Postgres server.
//   2. Otherwise it boots a zero-install embedded PostgreSQL (data in .data/pg),
//      creates the `mcqforge` database on first run and reuses it after.
//   3. Applies SQL migrations (scripts/migrate.mjs) — idempotent.
//   4. Builds the Next.js app once (skipped when .next already exists, use
//      --build to force) and serves it with `next start` on 0.0.0.0.
//
// Ctrl+C shuts the web server and the embedded database down cleanly.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const PORT = Number(flag("port", process.env.PORT || 3000));
const HOST = process.env.HOSTNAME || "0.0.0.0";
const PG_PORT = Number(flag("pg-port", process.env.MCQ_PG_PORT || 54329));
const DATA_DIR = path.resolve(root, flag("data-dir", process.env.MCQ_DATA_DIR || ".data/pg"));
const DB_NAME = process.env.MCQ_DB_NAME || "mcqforge";
const USE_EMBEDDED = !process.env.DATABASE_URL;

const log = (...a) => console.log("[mcqforge]", ...a);
const step = (...a) => console.log("\n[mcqforge]", ...a);

function waitForPort(port, host = "127.0.0.1", timeoutMs = 30_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error(`Timed out waiting for ${host}:${port}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function waitForHttp(url, timeoutMs = 180_000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) resolve(false);
        else setTimeout(attempt, 500);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

async function freePortOrInUse(port) {
  // Returns true when something is already listening on the port.
  try {
    await waitForPort(port, "127.0.0.1", 400);
    return true;
  } catch {
    return false;
  }
}

async function startEmbedded() {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const firstRun = !existsSync(path.join(DATA_DIR, "PG_VERSION"));

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PG_PORT,
    persistent: true,
  });

  if (firstRun) {
    step(`First run — initialising embedded PostgreSQL in ${path.relative(root, DATA_DIR)}/`);
    await pg.initialise();
  }

  const alreadyRunning = await freePortOrInUse(PG_PORT);
  if (alreadyRunning) {
    log(`Reusing the PostgreSQL already listening on port ${PG_PORT}.`);
  } else {
    step(`Starting embedded PostgreSQL on port ${PG_PORT}…`);
    await pg.start();
  }

  if (firstRun) {
    try {
      await pg.createDatabase(DB_NAME);
      log(`Created database "${DB_NAME}".`);
    } catch (err) {
      if (!/already exists/i.test(String(err?.message))) throw err;
    }
  }

  const stop = async () => {
    if (alreadyRunning) return;
    try {
      await pg.stop();
      log("Embedded PostgreSQL stopped.");
    } catch {
      /* already down */
    }
  };

  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/${DB_NAME}`,
    stop,
  };
}

async function main() {
  let pgHandle = null;
  let databaseUrl = process.env.DATABASE_URL;

  if (USE_EMBEDDED) {
    pgHandle = await startEmbedded();
    databaseUrl = pgHandle.url;
  } else {
    log("Using DATABASE_URL from the environment.");
  }

  const env = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "production" };

  const { migrate } = await import("./migrate.mjs");
  await migrate({ connectionString: databaseUrl });

  const needsBuild = has("build") || !existsSync(path.join(root, ".next", "BUILD_ID"));
  if (needsBuild) {
    step("Building the site (one-time step, takes ~30s)…");
    await run(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"], env);
  } else {
    log("Using the existing production build (.next). Re-run with --build to rebuild.");
  }

  step("Starting the website…");
  const server = spawn(
    process.execPath,
    [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "--hostname", HOST, "--port", String(PORT)],
    { cwd: root, env, stdio: "inherit" },
  );

  let shuttingDown = false;
  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    step("Shutting down…");
    try {
      server.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    if (pgHandle) await pgHandle.stop();
    process.exit(code);
  };

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  server.on("exit", (code) => shutdown(code ?? 0));

  const healthy = await waitForHttp(`http://127.0.0.1:${PORT}/api/health`);
  if (healthy) {
    step(`MCQForge is live → http://localhost:${PORT}`);
  } else {
    log("Server did not answer /api/health in time — check the logs above.");
  }
}

main().catch(async (err) => {
  console.error("\n[mcqforge] Failed:", err?.message || err);
  process.exit(1);
});
