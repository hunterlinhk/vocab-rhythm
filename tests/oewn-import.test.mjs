import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { createTestViteServer } from "./vite-test-helper.mjs";

const vite = await createTestViteServer();
after(() => vite.close());

const { assembleWordEntry } = await vite.ssrLoadModule("/src/lib/lexicon.shared.ts");
const { getBook } = await vite.ssrLoadModule("/src/data/words.ts");
const rows = JSON.parse(
  await readFile(new URL("../src/data/oewn-2025-pilot.json", import.meta.url), "utf8"),
);
const initializer = await readFile(
  new URL("../scripts/db-setup.mjs", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(
  await readFile(new URL("../ops/oewn-2025-ngsl/manifest.json", import.meta.url), "utf8"),
);

function content(row) {
  return {
    normalized_word: row.normalized_word,
    source_id: "oewn-2025",
    source_entry_ref: row.source_entry_ref,
    sense_key: row.sense_key,
    priority: row.priority,
    translation: null,
    part_of_speech: row.part_of_speech,
    phonetic: row.phonetic,
    definition_en: row.definition_en,
    sentence: row.sentence,
    sentence_translation: null,
    subject: null,
    verb: null,
    object: null,
  };
}

test("the pinned official source contributes real, traceable NGSL language data", () => {
  const ngsl = getBook("ngsl-1.2");
  assert.equal(rows.length, 26);
  for (const row of rows) {
    const original = ngsl.words.find((item) => item.word === row.word);
    assert.ok(original, `NGSL must contain ${row.word}`);
    assert.ok(row.definition_en);
    assert.ok(row.source_entry_ref.startsWith(`${row.word}%`));
    const resolved = assembleWordEntry(original, [content(row)]);
    assert.equal(resolved.entry.bookId, "ngsl-1.2");
    assert.equal(resolved.entry.rank, original.rank);
    assert.equal(resolved.entry.definitionEn, row.definition_en);
    assert.equal(resolved.entry.partOfSpeech, row.part_of_speech);
    assert.deepEqual(resolved.origins.definitionEn, {
      sourceId: "oewn-2025",
      sourceEntryRef: row.source_entry_ref,
    });
    assert.equal(resolved.entry.cn, undefined);
  }
});

test("another book reuses OEWN while its private meaning remains intact", () => {
  const row = rows.find((item) => item.word === "learn");
  assert.ok(row);
  const result = assembleWordEntry({ word: "learn", bookId: "custom-1", cn: "我的解释" }, [
    content(row),
  ]);
  assert.equal(result.entry.cn, "我的解释");
  assert.equal(result.entry.definitionEn, row.definition_en);
  assert.equal(result.entry.partOfSpeech, "verb");
  assert.equal(result.origins.cn, undefined);
});

test("repeatable initialization imports the full pinned OEWN set and preserves the reviewed pilots", () => {
  assert.equal(manifest.expected.lexemes, 2742);
  assert.equal(manifest.expected.senses, 19028);
  assert.equal(manifest.expected.reviewed, 26);
  assert.match(initializer, /Open English WordNet 2025/);
  assert.match(initializer, /CC-BY-4\.0/);
  assert.match(initializer, /Princeton University under the WordNet License/);
  assert.match(initializer, /source_sha256/);
  assert.match(initializer, /source_entry_ref/);
  assert.match(initializer, /ON CONFLICT \(lexeme_id, source_id, sense_key\)/);
  assert.match(initializer, /for \(const file of manifest\.files\)/);
  assert.match(initializer, /src\/data\/oewn-2025-pilot\.json/);
  assert.equal(new Set(rows.map((row) => row.source_entry_ref)).size, 26);
  assert.match(initializer, /await importPilot\(manifest\)/);
});
