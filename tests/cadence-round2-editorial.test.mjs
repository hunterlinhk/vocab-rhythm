import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "vite";
import { buildBundle, mapEditorialContent } from "../scripts/prepare-cadence-round2-editorial.mjs";

const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
after(() => vite.close());

const sourceDir = new URL("../ops/cadence-round2-editorial/source/", import.meta.url);
const [contentText, decisionsText, pilotText] = await Promise.all([
  readFile(new URL("rewritten_learning_content.json", sourceDir), "utf8"),
  readFile(new URL("round2_decisions.jsonl", sourceDir), "utf8"),
  readFile(new URL("../src/data/oewn-2025-pilot.json", import.meta.url), "utf8"),
]);
const pilotRows = JSON.parse(pilotText);
const bundle = buildBundle({ contentText, decisionsText, pilotRows });
const migration0006 = await readFile(
  new URL("../drizzle/migrations/0006_shared_lexicon.sql", import.meta.url),
  "utf8",
);
const migration0007 = await readFile(
  new URL("../drizzle/migrations/0007_seed_oewn_2025_pilot.sql", import.meta.url),
  "utf8",
);
const migration0018 = await readFile(
  new URL("../drizzle/migrations/0018_lexicon_editorial_content.sql", import.meta.url),
  "utf8",
);

function parseJsonl(source) {
  return source
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("all 45 editorial entries map to the unchanged Round 2 audit outcomes", () => {
  const content = JSON.parse(contentText);
  const decisions = parseJsonl(decisionsText);
  const rows = mapEditorialContent(content, decisions, pilotRows);
  const counts = rows.reduce((result, row) => {
    result[row.editorialKind] = (result[row.editorialKind] ?? 0) + 1;
    return result;
  }, {});
  assert.equal(rows.length, 45);
  assert.deepEqual(counts, {
    missing_core_sense: 38,
    additional_common_sense: 3,
    definition_rewrite: 2,
    usage_note: 2,
  });
  assert.equal(rows.filter((row) => row.reviewDecision === "defer_no_suitable_sense").length, 38);
  assert.equal(rows.filter((row) => row.reviewDecision === "propose_primary").length, 7);
  assert.equal(rows.filter((row) => row.senseRole === "primary").length, 40);
  assert.equal(rows.filter((row) => row.senseRole === "supplementary").length, 3);
  assert.equal(rows.filter((row) => row.contentType === "usage_note").length, 2);
  assert.ok(rows.every((row) => row.publicationStatus === "pending_review"));
  assert.ok(rows.every((row) => row.senseKey.startsWith("cadence-round2:")));
  assert.ok(
    rows.every(
      (row) => row.oewnSenseId == null || row.relatedSenseKey === row.currentPrimarySenseId,
    ),
  );
  assert.ok(
    rows.every(
      (row) => row.contentType !== "usage_note" || (!row.translation && !row.definitionEn),
    ),
  );
  assert.equal(rows.filter((row) => row.currentPrimarySenseId).length, 7);
});

test("mapping rejects changed decisions, fabricated IDs, and pilot overlap", () => {
  const content = JSON.parse(contentText);
  const decisions = parseJsonl(decisionsText);
  const mismatched = decisions.map((row, index) =>
    index === 0 ? { ...row, final_primary_sense_id: "invented%1:00:00::" } : row,
  );
  assert.throws(
    () => mapEditorialContent(content, mismatched, pilotRows),
    /Primary sense ID mismatch/,
  );
  const fabricated = structuredClone(content);
  fabricated.entries[0].oewn_sense_id = "invented%1:00:00::";
  assert.throws(
    () => mapEditorialContent(fabricated, decisions, pilotRows),
    /not an audited candidate/,
  );
  const pilotOverlap = structuredClone(content);
  pilotOverlap.entries[0].headword = pilotRows[0].word;
  assert.throws(
    () => mapEditorialContent(pilotOverlap, decisions, pilotRows),
    /overlaps a preserved pilot/,
  );
});

test("import bundle is deterministic and keeps editorial rows pending and separate", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../ops/cadence-round2-editorial/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const importSql = await readFile(
    new URL("../ops/cadence-round2-editorial/01-import-pending.sql", import.meta.url),
    "utf8",
  );
  const rollbackSql = await readFile(
    new URL("../ops/cadence-round2-editorial/02-rollback-editorial-source.sql", import.meta.url),
    "utf8",
  );
  assert.equal(manifest.source_id, bundle.sourceId);
  assert.equal(manifest.counts.input_entries, 45);
  assert.equal(manifest.counts.stored_primary_senses, 40);
  assert.equal(manifest.counts.stored_supplementary_senses, 3);
  assert.equal(manifest.counts.stored_usage_notes, 2);
  assert.match(importSql, /'editorial'.*'restricted'/s);
  assert.match(importSql, /'pending_review'/);
  assert.match(importSql, /source_entry_ref, sense_key/);
  assert.match(importSql, /DO \$\$/);
  assert.match(rollbackSql, /access_tier = 'restricted'/);
  assert.ok(
    rollbackSql.indexOf("access_tier = 'restricted'") <
      rollbackSql.indexOf("DELETE FROM public.lexicon_entries"),
  );
  assert.deepEqual(bundle.manifest.output_sha256, manifest.output_sha256);
});

test("migration, import, row security, and rollback preserve the 26 pilot senses", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated;
      CREATE ROLE anon;
      CREATE ROLE service_role;
      CREATE TABLE public.word_entries (id bigserial PRIMARY KEY, word text NOT NULL);
    `);
    await db.exec(migration0006);
    await db.exec(migration0007);
    await db.exec(migration0018);
    await db.exec("INSERT INTO public.word_entries (word) VALUES ('a')");
    const pilotBefore = await db.query(
      "SELECT sense_key, priority FROM public.lexicon_entries WHERE source_id = 'oewn-2025' ORDER BY sense_key",
    );
    assert.equal(pilotBefore.rows.length, 26);

    await db.exec(bundle.importSql);
    const source = await db.query(
      "SELECT source_kind, access_tier, license_id, license_url FROM public.lexicon_sources WHERE id = $1",
      [bundle.sourceId],
    );
    assert.deepEqual(source.rows[0], {
      source_kind: "editorial",
      access_tier: "restricted",
      license_id: null,
      license_url: null,
    });
    const summary = await db.query(
      `SELECT count(*)::int AS total,
        count(*) FILTER (WHERE publication_status = 'pending_review')::int AS pending,
        count(*) FILTER (WHERE content_type = 'sense' AND sense_role = 'primary')::int AS primary_senses,
        count(*) FILTER (WHERE content_type = 'sense' AND sense_role = 'supplementary')::int AS supplementary_senses,
        count(*) FILTER (WHERE content_type = 'usage_note')::int AS usage_notes,
        count(*) FILTER (WHERE review_decision = 'defer_no_suitable_sense')::int AS deferred,
        count(*) FILTER (WHERE review_decision = 'propose_primary')::int AS proposed,
        count(*) FILTER (WHERE source_entry_ref IS NOT NULL)::int AS fake_source_refs
       FROM public.lexicon_entries WHERE source_id = $1`,
      [bundle.sourceId],
    );
    assert.deepEqual(summary.rows[0], {
      total: 45,
      pending: 45,
      primary_senses: 40,
      supplementary_senses: 3,
      usage_notes: 2,
      deferred: 38,
      proposed: 7,
      fake_source_refs: 0,
    });
    const malformedNotes = await db.query(
      `SELECT count(*)::int AS total FROM public.lexicon_entries
       WHERE source_id = $1 AND content_type = 'usage_note'
       AND (sense_role IS NOT NULL OR definition_en IS NOT NULL OR translation IS NOT NULL OR usage_note_zh IS NULL)`,
      [bundle.sourceId],
    );
    assert.equal(malformedNotes.rows[0].total, 0);

    await db.exec("SET ROLE authenticated");
    try {
      const restrictedRead = await db.query(
        "SELECT count(*)::int AS total FROM public.lexicon_entries WHERE source_id = $1",
        [bundle.sourceId],
      );
      assert.equal(restrictedRead.rows[0].total, 0);
    } finally {
      await db.exec("RESET ROLE");
    }

    await db.query("UPDATE public.lexicon_sources SET access_tier = 'public' WHERE id = $1", [
      bundle.sourceId,
    ]);
    await db.exec("SET ROLE authenticated");
    try {
      const pendingRead = await db.query(
        "SELECT count(*)::int AS total FROM public.lexicon_entries WHERE source_id = $1",
        [bundle.sourceId],
      );
      assert.equal(pendingRead.rows[0].total, 0);
    } finally {
      await db.exec("RESET ROLE");
    }

    await db.query(
      `UPDATE public.lexicon_entries SET publication_status = 'published'
       WHERE id = (SELECT id FROM public.lexicon_entries WHERE source_id = $1 AND sense_role = 'primary' ORDER BY sense_key LIMIT 1)`,
      [bundle.sourceId],
    );
    await db.exec("SET ROLE authenticated");
    try {
      const publishedRead = await db.query(
        "SELECT count(*)::int AS total FROM public.lexicon_entries WHERE source_id = $1",
        [bundle.sourceId],
      );
      assert.equal(publishedRead.rows[0].total, 1);
    } finally {
      await db.exec("RESET ROLE");
    }

    const rollbackSql = await readFile(
      new URL("../ops/cadence-round2-editorial/02-rollback-editorial-source.sql", import.meta.url),
      "utf8",
    );
    await db.exec(rollbackSql);
    const remainingSource = await db.query(
      "SELECT count(*)::int AS total FROM public.lexicon_sources WHERE id = $1",
      [bundle.sourceId],
    );
    const userEntry = await db.query(
      "SELECT count(*)::int AS total FROM public.word_entries WHERE word = 'a'",
    );
    const pilotAfter = await db.query(
      "SELECT sense_key, priority FROM public.lexicon_entries WHERE source_id = 'oewn-2025' ORDER BY sense_key",
    );
    assert.equal(remainingSource.rows[0].total, 0);
    assert.equal(userEntry.rows[0].total, 1);
    assert.deepEqual(pilotAfter.rows, pilotBefore.rows);
  } finally {
    await db.close();
  }
});
