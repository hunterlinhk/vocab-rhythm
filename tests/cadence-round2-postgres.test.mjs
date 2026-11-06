import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { buildBundle } from "../scripts/prepare-cadence-round2-editorial.mjs";
import { createTestDatabase } from "./database-test-helper.mjs";
import { createTestViteServer } from "./vite-test-helper.mjs";

const vite = await createTestViteServer();
after(() => vite.close());
const { hydrateEntries } = await vite.ssrLoadModule("/src/lib/lexicon.server.ts");
const [contentText, decisionsText, pilotText, bundleImportSql] = await Promise.all([
  readFile(new URL("../ops/cadence-round2-editorial/source/rewritten_learning_content.json", import.meta.url), "utf8"),
  readFile(new URL("../ops/cadence-round2-editorial/source/round2_decisions.jsonl", import.meta.url), "utf8"),
  readFile(new URL("../src/data/oewn-2025-pilot.json", import.meta.url), "utf8"),
  readFile(new URL("../ops/cadence-round2-editorial/01-import-pending.sql", import.meta.url), "utf8"),
]);
const content = JSON.parse(contentText);
const pilot = JSON.parse(pilotText);
const editorialBundle = buildBundle({ contentText, decisionsText, pilotRows: pilot });
const sourceManifest = JSON.parse(await readFile(new URL("../ops/oewn-2025-ngsl/manifest.json", import.meta.url), "utf8"));

async function seedLexicon(db, schema) {
  const byWord = new Map();
  for (const row of [...pilot, ...content.entries.map((entry) => ({
    normalized_word: entry.headword.trim().toLowerCase(),
    word: entry.headword.trim(),
  }))]) {
    if (!byWord.has(row.normalized_word)) byWord.set(row.normalized_word, row.word);
  }
  await db.insert(schema.lexemes).values(
    [...byWord].map(([normalizedWord, lemma]) => ({ normalizedWord, lemma })),
  ).onConflictDoNothing();
  const lexemes = await db.select().from(schema.lexemes);
  const idByWord = new Map(lexemes.map((row) => [row.normalizedWord, row.id]));
  await db.insert(schema.lexiconSources).values({
    id: "oewn-2025",
    title: "Open English WordNet 2025",
    version: "2025-12-31",
    sourceUrl: "https://en-word.net/downloads/english-wordnet-2025-json.zip",
    licenseId: "CC-BY-4.0",
    licenseUrl: "https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md",
    attribution: "Open English WordNet 2025; CC BY 4.0.",
    accessTier: "public",
    sourceSha256: sourceManifest.archive_sha256,
    sourceKind: "external",
  });
  await db.insert(schema.lexiconEntries).values(pilot.map((row) => ({
    lexemeId: idByWord.get(row.normalized_word),
    sourceId: "oewn-2025",
    sourceEntryRef: row.source_entry_ref,
    senseKey: row.sense_key,
    priority: row.priority,
    partOfSpeech: row.part_of_speech,
    phonetic: row.phonetic,
    definitionEn: row.definition_en,
    sentence: row.sentence,
    contentType: "sense",
    senseRole: "primary",
    publicationStatus: "published",
  })));
}

async function readBySource(store, sourceId) {
  const result = await store.table("lexicon_entries")
    .select("lexeme_id, source_id, source_entry_ref, sense_key, priority, translation, part_of_speech, phonetic, definition_en, sentence, sentence_translation, subject, verb, object, content_type, sense_role, publication_status, review_decision, related_sense_key, usage_note_zh")
    .eq("source_id", sourceId)
    .order("sense_key", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

test("new schema imports Round 2 idempotently, gates publication, and rolls back only editorial rows", async () => {
  const { client, db, schema, createUserStore } = await createTestDatabase(vite);
  try {
    await db.insert(schema.user).values({ id: "learner-a", name: "Learner A", email: "learner-a@example.test" });
    await db.insert(schema.user).values({ id: "learner-b", name: "Learner B", email: "learner-b@example.test" });
    await seedLexicon(db, schema);
    const storeA = createUserStore(db, "learner-a");
    const { data: book, error: bookError } = await storeA.table("word_books").insert({
      name: "Private learning book",
      source: "custom",
      owner_user_id: "learner-a",
    }).select("id").single();
    assert.equal(bookError, null);
    assert.ok(book?.id);
    assert.equal((await storeA.table("word_entries").insert({
      book_id: book.id,
      position: 0,
      word: "privateword",
      translation: "我的词义",
    })).error, null);
    const userRecords = {
      attempts: await storeA.table("attempts").insert({
        id: "00000000-0000-0000-0000-000000000111",
        mode: "word",
        book_id: book.id,
        word: "privateword",
        translation: "我的词义",
      }),
      mastery: await storeA.table("word_mastery").insert({ book_id: book.id, word: "privateword" }),
      progress: await storeA.table("book_progress").insert({ book_id: book.id, mode: "word", cursor_index: 1 }),
    };
    assert.ok(Object.values(userRecords).every((result) => result.error === null));

    const pilotBefore = await db.select().from(schema.lexiconEntries).where(eq(schema.lexiconEntries.sourceId, "oewn-2025"));
    assert.equal(pilotBefore.length, 26);
    await client.exec(bundleImportSql);
    await client.exec(bundleImportSql);

    const summary = await client.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE publication_status = 'pending_review')::int AS pending,
      count(*) FILTER (WHERE content_type = 'sense' AND sense_role = 'primary')::int AS primary_senses,
      count(*) FILTER (WHERE content_type = 'sense' AND sense_role = 'supplementary')::int AS supplementary_senses,
      count(*) FILTER (WHERE content_type = 'usage_note')::int AS usage_notes,
      count(*) FILTER (WHERE review_decision = 'defer_no_suitable_sense')::int AS deferred,
      count(*) FILTER (WHERE review_decision = 'propose_primary')::int AS proposed
      FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863'`);
    assert.deepEqual(summary.rows[0], {
      total: 88,
      pending: 88,
      primary_senses: 40,
      supplementary_senses: 3,
      usage_notes: 45,
      deferred: 38,
      proposed: 7,
    });
    const pending = await readBySource(storeA, "cadence-round2-editorial-bccb9a1ab863");
    assert.equal(pending.length, 0);

    await client.query("UPDATE public.lexicon_sources SET access_tier = 'public' WHERE id = $1", [
      "cadence-round2-editorial-bccb9a1ab863",
    ]);
    assert.equal((await readBySource(storeA, "cadence-round2-editorial-bccb9a1ab863")).length, 0);
    await client.query("UPDATE public.lexicon_entries SET publication_status = 'published' WHERE source_id = $1", [
      "cadence-round2-editorial-bccb9a1ab863",
    ]);
    const published = await readBySource(storeA, "cadence-round2-editorial-bccb9a1ab863");
    assert.equal(published.length, 88);
    const noteRows = await client.query(`SELECT l.normalized_word, e.usage_note_zh, e.related_sense_key
      FROM public.lexicon_entries e JOIN public.lexemes l ON l.id = e.lexeme_id
      WHERE e.source_id = 'cadence-round2-editorial-bccb9a1ab863' AND e.content_type = 'usage_note'`);
    assert.equal(noteRows.rows.length, 45);
    for (const entry of content.entries) {
      const word = entry.headword.trim().toLowerCase();
      const note = noteRows.rows.find((row) => row.normalized_word === word);
      assert.equal(note?.usage_note_zh, entry.usage_note_zh);
      const sense = editorialBundle.rows.find((row) => row.normalizedWord === word && row.contentType === "sense");
      assert.equal(note?.related_sense_key, sense?.senseKey ?? entry.current_primary_sense_id);
    }
    const aEntry = content.entries.find((entry) => entry.headword.trim().toLowerCase() === "a");
    assert.ok(aEntry);
    const hydrated = await hydrateEntries(storeA, [{ word: "a", bookId: book.id, cn: "词书本地释义" }]);
    assert.equal(hydrated[0].cn, "词书本地释义");
    assert.equal(hydrated[0].usageNotes?.[0]?.text, aEntry.usage_note_zh);
    assert.equal(hydrated[0].definitionEn?.includes(aEntry.usage_note_zh), false);

    const rollback = await readFile(
      new URL("../ops/cadence-round2-editorial/02-rollback-editorial-source.sql", import.meta.url),
      "utf8",
    );
    await client.exec(rollback);
    const remainingEditorial = await db.select().from(schema.lexiconEntries).where(
      eq(schema.lexiconEntries.sourceId, "cadence-round2-editorial-bccb9a1ab863"),
    );
    const pilotAfter = await db.select().from(schema.lexiconEntries).where(eq(schema.lexiconEntries.sourceId, "oewn-2025"));
    assert.equal(remainingEditorial.length, 0);
    assert.deepEqual(pilotAfter, pilotBefore);
    for (const table of ["attempts", "word_mastery", "book_progress", "word_books", "word_entries"]) {
      assert.equal((await storeA.table(table).select("*")).data.length, 1);
    }
    assert.equal((await createUserStore(db, "learner-b").table("word_books").select("id")).data.length, 0);
  } finally {
    await client.close();
  }
});
