import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { buildBundle, mapEditorialContent } from "../scripts/prepare-cadence-round2-editorial.mjs";
import { createTestViteServer } from "./vite-test-helper.mjs";

const vite = await createTestViteServer();
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

function parseJsonl(source) {
  return source.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

test("all Round 2 source entries map to 43 senses and 45 linked usage notes", () => {
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
  assert.ok(notes.every((row) => row.senseRole == null && row.translation == null && row.relatedSenseKey));
  assert.equal(new Set(notes.map((row) => row.normalizedWord)).size, 45);
  const noteByWord = new Map(notes.map((row) => [row.normalizedWord, row]));
  const senseByWord = new Map(senses.map((row) => [row.normalizedWord, row]));
  for (const entry of content.entries) {
    const word = entry.headword.trim().toLowerCase();
    const note = noteByWord.get(word);
    assert.equal(note.usageNoteZh, entry.usage_note_zh);
    const sense = senseByWord.get(word);
    assert.equal(note.relatedSenseKey, sense?.senseKey ?? entry.current_primary_sense_id);
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

test("mapping rejects changed decisions, invented IDs, missing notes, and pilot overlap", () => {
  const content = JSON.parse(contentText);
  const decisions = parseJsonl(decisionsText);
  const mismatched = decisions.map((row, index) =>
    index === 0 ? { ...row, final_primary_sense_id: "invented%1:00:00::" } : row,
  );
  assert.throws(() => mapEditorialContent(content, mismatched, pilotRows), /Primary sense ID mismatch/);
  const fabricated = structuredClone(content);
  fabricated.entries[0].oewn_sense_id = "invented%1:00:00::";
  assert.throws(() => mapEditorialContent(fabricated, decisions, pilotRows), /not an audited candidate/);
  const pilotOverlap = structuredClone(content);
  pilotOverlap.entries[0].headword = pilotRows[0].word;
  assert.throws(() => mapEditorialContent(pilotOverlap, decisions, pilotRows), /overlaps a preserved pilot/);
  const missingNote = structuredClone(content);
  missingNote.entries[0].usage_note_zh = "  ";
  assert.throws(() => mapEditorialContent(missingNote, decisions, pilotRows), /Missing usage note/);
});

test("pending import is deterministic, restricted, and preserves all review decisions", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../ops/cadence-round2-editorial/manifest.json", import.meta.url), "utf8"),
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
  assert.ok(rollbackSql.indexOf("access_tier = 'restricted'") < rollbackSql.indexOf("DELETE FROM public.lexicon_entries"));
  assert.deepEqual(bundle.manifest.output_sha256, manifest.output_sha256);
});

test("published usage notes stay separate and word-book content stays first", () => {
  const entry = JSON.parse(contentText).entries[0];
  const rows = bundle.rows
    .filter((row) => row.normalizedWord === entry.headword.toLowerCase())
    .map((row) => ({
      source_id: row.sourceId,
      source_entry_ref: row.sourceEntryRef,
      sense_key: row.senseKey,
      priority: row.priority,
      translation: row.translation,
      part_of_speech: row.partOfSpeech,
      definition_en: row.definitionEn,
      content_type: row.contentType,
      sense_role: row.senseRole,
      publication_status: row.publicationStatus,
      related_sense_key: row.relatedSenseKey,
      usage_note_zh: row.usageNoteZh,
    }));
  const sense = rows.find((row) => row.content_type === "sense");
  const note = rows.find((row) => row.content_type === "usage_note");
  const pending = assembleWordEntry({ word: entry.headword }, [sense, note]);
  assert.equal(pending.entry.cn, undefined);
  assert.equal(pending.entry.usageNotes, undefined);
  const result = assembleWordEntry(
    { word: entry.headword, bookId: "local-book", cn: "词书本地释义" },
    [
      { ...sense, publication_status: "published" },
      { ...note, publication_status: "published" },
    ],
  );
  assert.equal(result.entry.cn, "词书本地释义");
  assert.equal(result.entry.definitionEn, sense.definition_en);
  assert.equal(result.entry.usageNotes?.[0]?.text, note.usage_note_zh);
  assert.equal(result.entry.definitionEn?.includes(note.usage_note_zh), false);
});
