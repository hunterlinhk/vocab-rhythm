import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createTestViteServer } from "./vite-test-helper.mjs";
import { createTestDatabase } from "./database-test-helper.mjs";

const vite = await createTestViteServer();
after(() => vite.close());
const { localDayAt } = await vite.ssrLoadModule("/src/lib/learning-state.shared.ts");

async function addUser(db, schema, id) {
  await db.insert(schema.user).values({ id, name: id, email: `${id}@example.test` });
}

test("Drizzle today counts respect the user's local day, skips, and account scope", async () => {
  const { client, db, schema, createUserStore } = await createTestDatabase(vite);
  try {
    await addUser(db, schema, "learner-a");
    await addUser(db, schema, "learner-b");
    const storeA = createUserStore(db, "learner-a");
    const storeB = createUserStore(db, "learner-b");
    const zone = "America/Los_Angeles";
    const bounds = await client.query(`SELECT
      ((now() AT TIME ZONE $1)::date::timestamp AT TIME ZONE $1) AS start_at,
      (((now() AT TIME ZONE $1)::date + 1)::timestamp AT TIME ZONE $1) AS end_at`, [zone]);
    const start = new Date(bounds.rows[0].start_at);
    const end = new Date(bounds.rows[0].end_at);
    const samples = [
      { id: "00000000-0000-0000-0000-000000000001", at: new Date(start.getTime() - 1000), skipped: false },
      { id: "00000000-0000-0000-0000-000000000002", at: new Date(start.getTime() + 1000), skipped: false },
      { id: "00000000-0000-0000-0000-000000000003", at: new Date(end.getTime() - 1000), skipped: false },
      { id: "00000000-0000-0000-0000-000000000004", at: end, skipped: false },
      { id: "00000000-0000-0000-0000-000000000005", at: new Date(start.getTime() + 2000), skipped: true },
    ];
    for (const row of samples) {
      const { error } = await storeA.table("attempts").insert({
        id: row.id,
        mode: "word",
        book_id: "ngsl-1.2",
        word: "apple",
        correct: true,
        skipped: row.skipped,
        created_at: row.at.toISOString(),
      });
      assert.equal(error, null);
    }
    assert.equal(await storeA.todayPracticeCount(zone), 2);
    assert.equal(await storeB.todayPracticeCount(zone), 0);
    assert.equal(
      samples.filter((row) => !row.skipped && localDayAt(row.at, zone) === localDayAt(new Date(), zone)).length,
      2,
    );
  } finally {
    await client.close();
  }
});

test("PostgreSQL local days retain their 23-hour and 25-hour DST boundaries", async () => {
  const { client } = await createTestDatabase(vite);
  try {
    for (const [day, hours] of [["2026-03-08", 23], ["2026-11-01", 25]]) {
      const result = await client.query(`SELECT extract(epoch FROM (
        (($1::date + 1)::timestamp AT TIME ZONE 'America/Los_Angeles') -
        ($1::date::timestamp AT TIME ZONE 'America/Los_Angeles')
      )) / 3600 AS hours`, [day]);
      assert.equal(Number(result.rows[0].hours), hours);
    }
  } finally {
    await client.close();
  }
});
