import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

export async function createTestDatabase(vite) {
  const client = new PGlite();
  for (const migration of [
    "0000_cadence_initial.sql",
    "0001_short_review_decision_fk.sql",
    "0002_dictionary_foundation.sql",
    "0003_dictionary_expression_reviews.sql",
  ]) {
    const sql = await readFile(new URL(`../drizzle/migrations/${migration}`, import.meta.url), "utf8");
    await client.exec(sql.replace(/^--> statement-breakpoint\s*$/gm, ""));
  }
  const { schema } = await vite.ssrLoadModule("/drizzle/schema.ts");
  const { createUserStore } = await vite.ssrLoadModule("/src/server/user-store.ts");
  return { client, db: drizzle(client, { schema }), schema, createUserStore };
}
