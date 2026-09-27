import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
after(() => vite.close());

const { assembleWordEntry } = await vite.ssrLoadModule("/src/lib/lexicon.shared.ts");
const { hydrateEntries } = await vite.ssrLoadModule("/src/lib/lexicon.server.ts");
const { normalizeEntries, rowToEntry } = await vite.ssrLoadModule("/src/lib/library.shared.ts");
const { getBook } = await vite.ssrLoadModule("/src/data/words.ts");

const shared = {
  normalized_word: "the",
  source_id: "open-dictionary-v1",
  source_entry_ref: "sense-42",
  sense_key: "determiner-1",
  priority: 10,
  translation: "这；那",
  part_of_speech: "determiner",
  phonetic: "/ðə/",
  definition_en: "Used before a noun.",
  sentence: "The book is here.",
  sentence_translation: "书在这里。",
  subject: "The book",
  verb: "is",
  object: "here",
};

test("two books reuse one language record while keeping book identity and rank", () => {
  const ngsl = getBook("ngsl-1.2").words[0];
  assert.equal(ngsl.word, "the");
  const custom = { word: "the", bookId: "my-book", rank: 7 };
  const first = assembleWordEntry(ngsl, [shared]);
  const second = assembleWordEntry(custom, [shared]);
  for (const result of [first, second]) {
    assert.equal(result.entry.cn, "这；那");
    assert.equal(result.entry.definitionEn, "Used before a noun.");
    assert.equal(result.entry.partOfSpeech, "determiner");
    assert.deepEqual(result.origins.cn, {
      sourceId: "open-dictionary-v1",
      sourceEntryRef: "sense-42",
    });
  }
  assert.equal(first.entry.bookId, "ngsl-1.2");
  assert.equal(first.entry.rank, 1);
  assert.equal(second.entry.bookId, "my-book");
  assert.equal(second.entry.rank, 7);
});

test("custom-book language fields stay private and take precedence", () => {
  const result = assembleWordEntry(
    { word: "the", bookId: "my-book", cn: "我自己的解释", sentence: "The train left." },
    [shared],
  );
  assert.equal(result.entry.cn, "我自己的解释");
  assert.equal(result.origins.cn, undefined);
  assert.equal(result.entry.phonetic, "/ðə/");
  assert.equal(result.origins.phonetic?.sourceId, "open-dictionary-v1");
  assert.equal(result.entry.sentence, "The train left.");
  assert.equal(result.entry.sentenceCn, undefined);
  assert.equal(result.origins.sentence, undefined);
  const partial = assembleWordEntry({ word: "the", bookId: "my-book", subject: "My subject" }, [
    shared,
  ]);
  assert.equal(partial.entry.subject, "My subject");
  assert.equal(partial.entry.sentence, undefined);
});

test("each selected source remains traceable and examples are not mixed", () => {
  const secondary = {
    ...shared,
    source_id: "ipa-source-v2",
    source_entry_ref: "the-uk",
    priority: 5,
    translation: null,
    part_of_speech: null,
    phonetic: "/ðiː/",
    definition_en: "An unrelated sense.",
    sentence: null,
    sentence_translation: "不对应的译文",
  };
  const result = assembleWordEntry({ word: "the", bookId: "cet4" }, [
    { ...shared, phonetic: null, definition_en: null },
    secondary,
  ]);
  assert.equal(result.entry.phonetic, "/ðiː/");
  assert.equal(result.origins.phonetic?.sourceId, "ipa-source-v2");
  assert.equal(result.entry.sentenceCn, "书在这里。");
  assert.equal(result.entry.definitionEn, undefined);
  assert.equal(result.origins.sentence?.sourceId, "open-dictionary-v1");
});

test("unreviewed OEWN senses remain stored without choosing a WordEntry learning sense", () => {
  const oewn = {
    ...shared,
    source_id: "oewn-2025",
    source_entry_ref: "bank%1:14:00::",
    sense_key: "bank%1:14:00::",
    priority: 0,
    translation: null,
    definition_en: "a financial institution",
    part_of_speech: "noun",
    phonetic: "/bæŋk/",
    sentence: "The bank is open.",
  };
  const other = {
    ...oewn,
    source_entry_ref: "bank%1:17:00::",
    sense_key: "bank%1:17:00::",
    definition_en: "land beside a river",
  };
  const entry = { word: "bank", bookId: "ngsl-1.2", rank: 100 };
  const unresolved = assembleWordEntry(entry, [oewn, other]);
  assert.equal(unresolved.entry.definitionEn, undefined);
  assert.equal(unresolved.entry.partOfSpeech, undefined);
  assert.equal(unresolved.entry.phonetic, undefined);
  assert.equal(unresolved.entry.sentence, undefined);
  assert.deepEqual(unresolved.origins, {});

  const reviewed = assembleWordEntry(entry, [{ ...oewn, priority: 100 }, other]);
  assert.equal(reviewed.entry.definitionEn, "a financial institution");
  assert.deepEqual(reviewed.origins.definitionEn, {
    sourceId: "oewn-2025",
    sourceEntryRef: "bank%1:14:00::",
  });
  const local = assembleWordEntry({ ...entry, definitionEn: "My own meaning" }, [oewn, other]);
  assert.equal(local.entry.definitionEn, "My own meaning");
});

test("batched lookup links bundled and custom words through the same lexeme", async () => {
  const calls = [];
  const client = {
    from(table) {
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in(column, values) {
          calls.push({ table, column, values });
          this.values = values;
          return this;
        },
        or(filter) {
          calls.push({ table, filter });
          return this;
        },
        order() {
          return this;
        },
        range() {
          return Promise.resolve({
            data: this.values.includes("lexeme-the")
              ? [{ ...shared, lexeme_id: "lexeme-the" }]
              : [],
            error: null,
          });
        },
        then(resolve) {
          return Promise.resolve({
            data: this.values.includes("the") ? [{ id: "lexeme-the", normalized_word: "the" }] : [],
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  };
  const entries = await hydrateEntries(client, [
    { word: "the", bookId: "ngsl-1.2", rank: 1 },
    rowToEntry({
      ...normalizeEntries([{ word: "The", translation: "私有解释" }])[0],
      book_id: "custom-1",
    }),
  ]);
  assert.equal(calls.filter((call) => call.table === "lexemes").length, 1);
  assert.equal(calls.filter((call) => call.table === "lexicon_entries" && call.column).length, 1);
  assert.ok(calls.some((call) => call.filter === "source_id.neq.oewn-2025,priority.gte.100"));
  assert.equal(entries[0].cn, "这；那");
  assert.equal(entries[1].cn, "私有解释");
  assert.equal(entries[1].partOfSpeech, "determiner");
  assert.deepEqual(
    entries.map((entry) => entry.bookId),
    ["ngsl-1.2", "custom-1"],
  );
});

test("existing book reads still work before the Lexicon migration is applied", async () => {
  const original = [{ word: "the", bookId: "ngsl-1.2", rank: 1 }];
  const client = {
    from(table) {
      assert.equal(table, "lexemes");
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return Promise.resolve({
            data: null,
            error: { code: "PGRST205", message: "missing table" },
          });
        },
      };
    },
  };
  assert.equal(await hydrateEntries(client, original), original);
});

test("migration stores source licensing and links words without moving learning records", async () => {
  const sql = await readFile(
    new URL("../drizzle/migrations/0006_shared_lexicon.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE public\.lexicon_sources/);
  assert.match(sql, /license_id text NOT NULL/);
  assert.match(sql, /attribution text NOT NULL/);
  assert.match(sql, /source_url text NOT NULL/);
  assert.match(sql, /source_entry_ref text/);
  assert.match(sql, /source_id text NOT NULL REFERENCES public\.lexicon_sources/);
  assert.match(sql, /ADD COLUMN lexeme_id uuid REFERENCES public\.lexemes/);
  assert.match(sql, /CREATE TRIGGER word_entries_link_lexeme/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.(attempts|word_mastery|book_progress)/);
});
