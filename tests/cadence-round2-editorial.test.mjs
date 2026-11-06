import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "vite";
import { buildBundle, mapEditorialContent } from "../scripts/prepare-cadence-round2-editorial.mjs";

const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
after(() => vite.close());
const { assembleWordEntry } = await vite.ssrLoadModule("/src/lib/lexicon.shared.ts");

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

test("all 45 source entries map to 43 senses and 45 linked usage notes", () => {
  const content = JSON.parse(contentText);
  const decisions = parseJsonl(decisionsText);
  const rows = mapEditorialContent(content, decisions, pilotRows);
  const senses = rows.filter((row) => row.contentType === "sense");
  const notes = rows.filter((row) => row.contentType === "usage_note");
  const counts = content.entries.reduce((result, row) => {
    result[row.entry_type] = (result[row.entry_type] ?? 0) + 1;
    return result;
  }, {});
  assert.equal(rows.length, 88);
  assert.deepEqual(counts, {
    missing_core_sense: 38,
    additional_common_sense: 3,
    definition_rewrite: 2,
    usage_note: 2,
  });
  assert.equal(senses.length, 43);
  assert.equal(notes.length, 45);
  assert.equal(senses.filter((row) => row.senseRole === "primary").length, 40);
  assert.equal(senses.filter((row) => row.senseRole === "supplementary").length, 3);
  assert.equal(rows.filter((row) => row.reviewDecision === "defer_no_suitable_sense").length, 38);
  assert.equal(rows.filter((row) => row.reviewDecision === "propose_primary").length, 7);
  assert.equal(rows.filter((row) => row.reviewDecision != null).length, 45);
  assert.ok(rows.every((row) => row.publicationStatus === "pending_review"));
  assert.ok(rows.every((row) => row.senseKey.startsWith("cadence-round2:")));
  assert.ok(notes.every((row) => row.usageNoteZh?.trim()));
  assert.ok(
    notes.every(
      (row) =>
        row.senseRole == null &&
        row.translation == null &&
        row.partOfSpeech == null &&
        row.definitionEn == null &&
        row.relatedSenseKey,
    ),
  );
  assert.equal(new Set(notes.map((row) => row.normalizedWord)).size, 45);
  const noteByWord = new Map(notes.map((row) => [row.normalizedWord, row]));
  const senseByWord = new Map(senses.map((row) => [row.normalizedWord, row]));
  for (const entry of content.entries) {
    const word = entry.headword.trim().toLowerCase();
    const note = noteByWord.get(word);
    assert.equal(note.usageNoteZh, entry.usage_note_zh);
    const sense = senseByWord.get(word);
    if (sense) assert.equal(note.relatedSenseKey, sense.senseKey);
    else assert.equal(note.relatedSenseKey, entry.current_primary_sense_id);
    for (const row of [sense, note].filter(Boolean)) {
      assert.equal(row.oewnSenseId, entry.oewn_sense_id);
      assert.equal(row.currentPrimarySenseId, entry.current_primary_sense_id);
    }
  }
  assert.equal(notes.filter((row) => row.relatedSenseKey.startsWith("cadence-round2:")).length, 43);
  assert.equal(notes.filter((row) => !row.relatedSenseKey.startsWith("cadence-round2:")).length, 2);
  assert.equal(new Set(rows.filter((row) => row.currentPrimarySenseId).map((row) => row.normalizedWord)).size, 7);
  assert.equal(rows.filter((row) => row.sourceEntryRef != null).length, 0);
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
  const missingNote = structuredClone(content);
  missingNote.entries[0].usage_note_zh = "  ";
  assert.throws(() => mapEditorialContent(missingNote, decisions, pilotRows), /Missing usage note/);
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
  assert.equal(manifest.counts.stored_content_rows, 88);
  assert.equal(manifest.counts.stored_senses, 43);
  assert.equal(manifest.counts.stored_primary_senses, 40);
  assert.equal(manifest.counts.stored_supplementary_senses, 3);
  assert.equal(manifest.counts.stored_usage_notes, 45);
  assert.deepEqual(manifest.counts.usage_note_links, {
    linked_to_editorial_sense: 43,
    linked_to_existing_oewn_sense: 2,
  });
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

test("migration, idempotent import, publication, and rollback preserve audit, pilot, and user data", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated;
      CREATE ROLE anon;
      CREATE ROLE service_role;
      CREATE TABLE public.word_entries (id bigserial PRIMARY KEY, word text NOT NULL);
      CREATE TABLE public.attempts (id text PRIMARY KEY, payload text NOT NULL);
      CREATE TABLE public.word_mastery (id text PRIMARY KEY, payload text NOT NULL);
      CREATE TABLE public.book_progress (id text PRIMARY KEY, payload text NOT NULL);
    `);
    await db.exec(migration0006);
    await db.exec(migration0007);
    await db.exec(migration0018);
    await db.exec("INSERT INTO public.word_entries (word) VALUES ('a')");
    await db.exec(`
      INSERT INTO public.attempts VALUES ('attempt-1', 'keep');
      INSERT INTO public.word_mastery VALUES ('mastery-1', 'keep');
      INSERT INTO public.book_progress VALUES ('progress-1', 'keep');
    `);
    const pilotBefore = await db.query(
      `SELECT sense_key, priority, translation, part_of_speech, phonetic, definition_en, sentence,
        sentence_translation, subject, verb, object
       FROM public.lexicon_entries WHERE source_id = 'oewn-2025' ORDER BY sense_key`,
    );
    assert.equal(pilotBefore.rows.length, 26);
    const userRowsBefore = (await Promise.all([
      db.query("SELECT * FROM public.attempts ORDER BY id"),
      db.query("SELECT * FROM public.word_mastery ORDER BY id"),
      db.query("SELECT * FROM public.book_progress ORDER BY id"),
    ])).map((result) => result.rows);

    await db.exec(bundle.importSql);
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
      total: 88,
      pending: 88,
      primary_senses: 40,
      supplementary_senses: 3,
      usage_notes: 45,
      deferred: 38,
      proposed: 7,
      fake_source_refs: 0,
    });
    const senseCount = await db.query(
      "SELECT count(*)::int AS total FROM public.lexicon_entries WHERE source_id = $1 AND content_type = 'sense'",
      [bundle.sourceId],
    );
    assert.equal(senseCount.rows[0].total, 43);
    const noteRows = await db.query(
      `SELECT l.normalized_word, l.lemma, e.sense_key, e.usage_note_zh, e.related_sense_key,
        e.review_decision, e.source_entry_ref
       FROM public.lexicon_entries e JOIN public.lexemes l ON l.id = e.lexeme_id
       WHERE e.source_id = $1 AND e.content_type = 'usage_note' ORDER BY l.normalized_word`,
      [bundle.sourceId],
    );
    const input = JSON.parse(contentText).entries;
    assert.equal(noteRows.rows.length, 45);
    for (const entry of input) {
      const normalized = entry.headword.trim().toLowerCase();
      const note = noteRows.rows.find((row) => row.normalized_word === normalized);
      assert.ok(note, `Missing usage note for ${entry.headword}`);
      assert.equal(note.usage_note_zh, entry.usage_note_zh);
      assert.equal(note.source_entry_ref, null);
      const sense = bundle.rows.find(
        (row) => row.normalizedWord === normalized && row.contentType === "sense",
      );
      assert.equal(note.related_sense_key, sense?.senseKey ?? entry.current_primary_sense_id);
      assert.equal(note.review_decision, sense ? null : "propose_primary");
    }
    const malformedNotes = await db.query(
      `SELECT count(*)::int AS total FROM public.lexicon_entries
       WHERE source_id = $1 AND content_type = 'usage_note'
       AND (sense_role IS NOT NULL OR definition_en IS NOT NULL OR translation IS NOT NULL
         OR part_of_speech IS NOT NULL OR phonetic IS NOT NULL OR sentence IS NOT NULL
         OR sentence_translation IS NOT NULL OR subject IS NOT NULL OR verb IS NOT NULL
         OR object IS NOT NULL OR usage_note_zh IS NULL OR related_sense_key IS NULL)`,
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

    await db.query("UPDATE public.lexicon_entries SET publication_status = 'published' WHERE source_id = $1", [bundle.sourceId]);
    await db.exec("SET ROLE authenticated");
    try {
      const publishedRead = await db.query(
        "SELECT count(*)::int AS total FROM public.lexicon_entries WHERE source_id = $1",
        [bundle.sourceId],
      );
      assert.equal(publishedRead.rows[0].total, 88);
      const publishedTypes = await db.query(
        `SELECT content_type, count(*)::int AS total FROM public.lexicon_entries
         WHERE source_id = $1 GROUP BY content_type ORDER BY content_type`,
        [bundle.sourceId],
      );
      assert.deepEqual(publishedTypes.rows, [
        { content_type: "sense", total: 43 },
        { content_type: "usage_note", total: 45 },
      ]);
    } finally {
      await db.exec("RESET ROLE");
    }

    const publishedRows = await db.query(
      `SELECT l.normalized_word, e.source_id, e.source_entry_ref, e.sense_key, e.priority,
        e.translation, e.part_of_speech, e.phonetic, e.definition_en, e.sentence,
        e.sentence_translation, e.subject, e.verb, e.object, e.content_type, e.sense_role,
        e.publication_status, e.review_decision, e.related_sense_key, e.usage_note_zh
       FROM public.lexicon_entries e JOIN public.lexemes l ON l.id = e.lexeme_id
       WHERE e.source_id = $1 AND e.publication_status = 'published'
       ORDER BY l.normalized_word, e.content_type, e.sense_key`,
      [bundle.sourceId],
    );
    for (const entry of input) {
      const normalized = entry.headword.trim().toLowerCase();
      const rows = publishedRows.rows.filter((row) => row.normalized_word === normalized);
      const assembled = assembleWordEntry(
        { word: entry.headword, bookId: "local-book", cn: "词书本地释义" },
        rows,
      );
      const note = assembled.entry.usageNotes?.[0];
      assert.equal(assembled.entry.cn, "词书本地释义");
      assert.equal(assembled.entry.usageNotes?.length, 1);
      assert.equal(note?.text, entry.usage_note_zh);
      const sense = rows.find((row) => row.content_type === "sense");
      assert.equal(note?.relatedSenseKey, sense?.sense_key ?? entry.current_primary_sense_id);
      if (sense) {
        assert.equal(note?.relatedTranslation, sense.translation ?? undefined);
        assert.equal(note?.relatedDefinitionEn, sense.definition_en ?? undefined);
        if (sense.sense_role === "supplementary") {
          assert.equal(
            assembled.entry.additionalSenses?.some((row) => row.senseKey === sense.sense_key),
            true,
          );
        } else {
          assert.equal(assembled.entry.definitionEn, sense.definition_en);
          assert.equal(assembled.entry.definitionEn?.includes(entry.usage_note_zh), false);
        }
      } else {
        assert.equal(note?.relatedTranslation, undefined);
      }
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
      `SELECT sense_key, priority, translation, part_of_speech, phonetic, definition_en, sentence,
        sentence_translation, subject, verb, object
       FROM public.lexicon_entries WHERE source_id = 'oewn-2025' ORDER BY sense_key`,
    );
    const userRowsAfter = (await Promise.all([
      db.query("SELECT * FROM public.attempts ORDER BY id"),
      db.query("SELECT * FROM public.word_mastery ORDER BY id"),
      db.query("SELECT * FROM public.book_progress ORDER BY id"),
    ])).map((result) => result.rows);
    assert.equal(remainingSource.rows[0].total, 0);
    assert.equal(userEntry.rows[0].total, 1);
    assert.deepEqual(pilotAfter.rows, pilotBefore.rows);
    assert.deepEqual(userRowsAfter, userRowsBefore);
  } finally {
    await db.close();
  }
});
