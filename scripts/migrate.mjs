#!/usr/bin/env node
// Applies every Drizzle SQL migration in ./drizzle exactly once.
//
//   DATABASE_URL=postgres://... node scripts/migrate.mjs
//
// Applied files are recorded in the `_mcq_migrations` table, so this command is
// safe to run on every deploy (and re-runs do nothing).

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "drizzle");

export async function migrate({ connectionString, silent = false } = {}) {
  const url = connectionString || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to run migrations");

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const log = (...a) => {
    if (!silent) console.log(...a);
  };
  try {
    await client.query(
      `create table if not exists _mcq_migrations (
         hash text primary key,
         applied_at timestamptz not null default now()
       )`,
    );

    let files = [];
    try {
      files = (await readdir(migrationsDir))
        .filter((f) => f.endsWith(".sql"))
        .sort();
    } catch {
      log("No drizzle/ directory — nothing to migrate.");
      return { applied: 0 };
    }

    const done = new Set(
      (await client.query("select hash from _mcq_migrations")).rows.map((r) => r.hash),
    );

    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      log(`Applying ${file} (${statements.length} statements)…`);
      await client.query("begin");
      try {
        for (const statement of statements) await client.query(statement);
        await client.query("insert into _mcq_migrations (hash) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
      applied++;
    }
    log(applied ? `Applied ${applied} migration(s).` : "Database schema is up to date.");
    return { applied };
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
