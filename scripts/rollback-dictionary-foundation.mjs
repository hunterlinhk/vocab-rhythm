import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sql = await readFile(resolve(root, "scripts/rollback-dictionary-foundation.sql"), "utf8");
const client = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });

try {
  await client.unsafe(sql);
  console.log("Dictionary foundation rows removed; lexemes, OEWN, Round 2, and user learning data were preserved.");
} finally {
  await client.end({ timeout: 5 });
}
