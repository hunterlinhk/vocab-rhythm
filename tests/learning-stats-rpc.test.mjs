import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
after(() => vite.close());
const { buildLearningStats, localDayAt } = await vite.ssrLoadModule("/src/lib/learning-state.shared.ts");
const migration = await readFile(new URL("../drizzle/migrations/0017_learning_stats_rpc.sql", import.meta.url), "utf8");
const userA = "00000000-0000-0000-0000-000000000001";
const userB = "00000000-0000-0000-0000-000000000002";

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
    CREATE TABLE public.user_settings (user_id uuid PRIMARY KEY, share_review_progress boolean NOT NULL DEFAULT true);
    CREATE TABLE public.attempts (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, book_id text NOT NULL, word text NOT NULL,
      translation text, mode text NOT NULL DEFAULT 'word', correct boolean NOT NULL DEFAULT true,
      mistouch boolean NOT NULL DEFAULT false, typo_count integer NOT NULL DEFAULT 0,
      skipped boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL,
      review_word_key text GENERATED ALWAYS AS (
        lower(btrim(regexp_replace(regexp_replace(word, '[[:space:]]+', ' ', 'g'), '[‘’]', chr(39), 'g')))
      ) STORED
    );
    GRANT SELECT ON public.user_settings, public.attempts TO authenticated;
    ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_settings ON public.user_settings TO authenticated USING (auth.uid() = user_id);
    CREATE POLICY own_attempts ON public.attempts TO authenticated USING (auth.uid() = user_id);
  `);
  await db.exec(migration);
  return db;
}

function attempt(id, createdAt, changes = {}) {
  return {
    id: `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`,
    user_id: userA, book_id: "book-a", word: "Growth", translation: "增长",
    mode: "word", correct: true, mistouch: false, typo_count: 0,
    skipped: false, created_at: createdAt, ...changes,
  };
}

async function insertAttempts(db, rows) {
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500);
    const values = batch.map((_, index) =>
      `(${Array.from({ length: 11 }, (__, column) => `$${index * 11 + column + 1}`).join(",")})`,
    ).join(",");
    const params = batch.flatMap((row) => [
      row.id, row.user_id, row.book_id, row.word, row.translation, row.mode,
      row.correct, row.mistouch, row.typo_count, row.skipped, row.created_at,
    ]);
    await db.query(`INSERT INTO public.attempts
      (id,user_id,book_id,word,translation,mode,correct,mistouch,typo_count,skipped,created_at)
      VALUES ${values}`, params);
  }
}

async function asUser(db, userId, statement, params = []) {
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${userId}';`);
  try {
    return await db.query(statement, params);
  } finally {
    await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
  }
}

function canonical(stats) {
  return {
    ...stats,
    recent: stats.recent.map((row) => ({ ...row, at: new Date(row.at).toISOString() })),
  };
}

test("stats RPC matches buildLearningStats across scopes, errors, skips, and more than 2000 rows", async () => {
  const db = await database();
  try {
    const now = new Date();
    const recent = new Date(now.getTime() - 60_000).toISOString();
    const yesterday = new Date(now.getTime() - 26 * 60 * 60_000).toISOString();
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60_000).toISOString();
    const rows = [
      attempt(1, recent, { word: "  DON’T   WORRY ", correct: false, translation: "最近错误" }),
      attempt(2, recent, { book_id: "book-b", word: "don't worry", typo_count: 3 }),
      attempt(3, yesterday, { word: "Don't Worry", mistouch: true, typo_count: 4 }),
      attempt(4, yesterday, { word: "Growth", correct: false, mode: "memorize" }),
      attempt(5, old, { word: "Growth", correct: false, translation: "旧错误" }),
      attempt(6, recent, { word: "Growth", skipped: true, correct: false }),
      attempt(7, recent, { user_id: userB, word: "Secret", correct: false }),
      ...Array.from({ length: 2100 }, (_, index) =>
        attempt(index + 8, old, { word: `word-${index}`, correct: index % 2 === 0 })),
    ];
    await insertAttempts(db, rows);
    await db.query("INSERT INTO public.user_settings (user_id, share_review_progress) VALUES ($1,true)", [userA]);
    for (const share of [true, false]) {
      await db.query("UPDATE public.user_settings SET share_review_progress=$1 WHERE user_id=$2", [share, userA]);
      for (const zone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
        const actual = (await asUser(db, userA, "SELECT public.get_learning_stats_v1($1) AS stats", [zone])).rows[0].stats;
        const expected = buildLearningStats(rows.filter((row) => row.user_id === userA)
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)), zone, new Date(), share);
        assert.deepEqual(canonical(actual), canonical(expected));
      }
    }
    const isolated = (await asUser(db, userB, "SELECT public.get_learning_stats_v1('UTC') AS stats")).rows[0].stats;
    assert.equal(isolated.totalCount, 1);
  } finally {
    await db.close();
  }
});

test("today count uses the local midnight bounds, including 23-hour and 25-hour DST days", async () => {
  const db = await database();
  try {
    for (const [day, hours] of [["2026-03-08", 23], ["2026-11-01", 25]]) {
      const result = await db.query(`SELECT extract(epoch FROM (
        (($1::date + 1)::timestamp AT TIME ZONE 'America/Los_Angeles') -
        ($1::date::timestamp AT TIME ZONE 'America/Los_Angeles')
      )) / 3600 AS hours`, [day]);
      assert.equal(Number(result.rows[0].hours), hours);
    }
    const boundaries = await db.query(`SELECT
      ((now() AT TIME ZONE 'America/Los_Angeles')::date::timestamp AT TIME ZONE 'America/Los_Angeles') AS start_at,
      (((now() AT TIME ZONE 'America/Los_Angeles')::date + 1)::timestamp AT TIME ZONE 'America/Los_Angeles') AS end_at`);
    const start = new Date(boundaries.rows[0].start_at);
    const end = new Date(boundaries.rows[0].end_at);
    const rows = [
      attempt(1, new Date(start.getTime() - 1000).toISOString()),
      attempt(2, new Date(start.getTime() + 1000).toISOString()),
      attempt(3, new Date(end.getTime() - 1000).toISOString()),
      attempt(4, end.toISOString()),
      attempt(5, new Date(start.getTime() + 2000).toISOString(), { skipped: true }),
    ];
    await insertAttempts(db, rows);
    const count = (await asUser(db, userA,
      "SELECT public.get_today_practice_count_v1('America/Los_Angeles') AS count")).rows[0].count;
    assert.equal(Number(count), 2);
    assert.equal(Number(count), rows.filter((row) => !row.skipped &&
      localDayAt(row.created_at, "America/Los_Angeles") === localDayAt(new Date(), "America/Los_Angeles")).length);
  } finally {
    await db.close();
  }
});

test("streak accepts an empty today and stops at the first missing local day", async () => {
  const db = await database();
  try {
    const zone = "America/Los_Angeles";
    const dates = await db.query(`SELECT
      (((now() AT TIME ZONE $1)::date - 1)::timestamp + interval '12 hours') AT TIME ZONE $1 AS yesterday,
      (((now() AT TIME ZONE $1)::date - 2)::timestamp + interval '12 hours') AT TIME ZONE $1 AS two_days_ago,
      (((now() AT TIME ZONE $1)::date - 4)::timestamp + interval '12 hours') AT TIME ZONE $1 AS four_days_ago`, [zone]);
    const row = dates.rows[0];
    const attempts = [
      attempt(1, new Date(row.yesterday).toISOString()),
      attempt(2, new Date(row.two_days_ago).toISOString()),
      attempt(3, new Date(row.four_days_ago).toISOString()),
    ];
    await insertAttempts(db, attempts);
    const stats = (await asUser(db, userA, "SELECT public.get_learning_stats_v1($1) AS stats", [zone])).rows[0].stats;
    assert.equal(stats.todayCount, 0);
    assert.equal(stats.streakDays, 2);
    assert.deepEqual(canonical(stats), canonical(buildLearningStats(attempts, zone, new Date())));
  } finally {
    await db.close();
  }
});

test("stats functions enforce authenticated owner-scoped reads", async () => {
  const db = await database();
  try {
    await insertAttempts(db, [attempt(1, new Date().toISOString())]);
    await db.exec("SET ROLE anon;");
    await assert.rejects(db.query("SELECT public.get_learning_stats_v1('UTC')"));
    await assert.rejects(db.query("SELECT public.get_today_practice_count_v1('UTC')"));
    await db.exec("RESET ROLE;");
    const userCount = (await asUser(db, userB, "SELECT public.get_today_practice_count_v1('UTC') AS count")).rows[0].count;
    assert.equal(Number(userCount), 0);
    const noIdentity = await db.query("SELECT has_function_privilege('anon', 'public.get_learning_stats_v1(text)', 'EXECUTE') AS allowed");
    assert.equal(noIdentity.rows[0].allowed, false);
  } finally {
    await db.close();
  }
});
