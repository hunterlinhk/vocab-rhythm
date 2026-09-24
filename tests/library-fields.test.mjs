import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
after(() => vite.close());

const { ENTRY_COLS, EntryInput, normalizeEntries, parsePastedWords, rowToEntry } =
  await vite.ssrLoadModule("/src/lib/library.shared.ts");
const { insertEntries } = await vite.ssrLoadModule("/src/lib/library.server.ts");
const { getBook } = await vite.ssrLoadModule("/src/data/words.ts");

const complete = {
  word: "apple",
  source_rank: 42,
  source_sfi: 76.5,
  source_frequency_per_million: 1234,
  translation: " 苹果 ",
  part_of_speech: " noun ",
  phonetic: " /ˈæpəl/ ",
  sentence: " An apple fell. ",
  sentence_translation: " 一个苹果掉了。 ",
  subject: " An apple ",
  verb: " fell ",
  object: " the ground ",
};

test("full-book and review queries select every imported learning field", () => {
  assert.deepEqual(
    ENTRY_COLS.split(", ").filter((column) => column !== "book_id"),
    Object.keys(EntryInput.shape),
  );
});

test("official and custom imports retain all optional learning fields", async () => {
  for (const bookId of ["official-test", "custom-test"]) {
    const inserted = [];
    const client = {
      from(table) {
        assert.equal(table, "word_entries");
        return {
          async insert(rows) {
            inserted.push(...rows);
            return { error: null };
          },
        };
      },
    };
    const count = await insertEntries(client, bookId, [EntryInput.parse(complete)]);
    assert.equal(count, 1);
    assert.equal(inserted[0].part_of_speech, "noun");
    const entry = rowToEntry(inserted[0]);
    assert.deepEqual(entry, {
      word: "apple",
      bookId,
      rank: 42,
      sfi: 76.5,
      frequencyPerMillion: 1234,
      cn: "苹果",
      partOfSpeech: "noun",
      phonetic: "/ˈæpəl/",
      sentence: "An apple fell.",
      sentenceCn: "一个苹果掉了。",
      subject: "An apple",
      verb: "fell",
      object: "the ground",
      svo: { s: "An apple", v: "fell", o: "the ground" },
    });
  }
});

test("sparse imported entries remain valid and duplicate words keep the first row", () => {
  const rows = normalizeEntries([
    EntryInput.parse({ word: "apple", part_of_speech: "noun" }),
    EntryInput.parse({ word: "apple", translation: "duplicate" }),
    EntryInput.parse({ word: "blank" }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].part_of_speech, "noun");
  assert.equal(rows[0].translation, null);
  assert.equal(rows[1].part_of_speech, null);
  assert.equal(rowToEntry({ ...rows[1], book_id: "custom-test" }).partOfSpeech, undefined);
});

test("partial sentence structure fields survive a database read", () => {
  const [row] = normalizeEntries([EntryInput.parse({ word: "apple", subject: "It" })]);
  const entry = rowToEntry({ ...row, book_id: "official-test" });
  assert.equal(entry.subject, "It");
  assert.equal(entry.verb, undefined);
  assert.equal(entry.svo, undefined);
});

test("pasted tabular imports retain every optional field and legacy input still works", () => {
  const pasted = `word\ttranslation\tpart_of_speech\tphonetic\tsentence\tsentence_translation\tsubject\tverb\tobject\tsource_rank\tsource_sfi\tsource_frequency_per_million\napple\t苹果\tnoun\t/ˈæpəl/\tAn apple fell.\t一个苹果掉了。\tAn apple\tfell\tthe ground\t42\t76.5\t1234`;
  assert.deepEqual(parsePastedWords(pasted), [EntryInput.parse(complete)]);
  assert.deepEqual(parsePastedWords("apple\t苹果\nbanana"), [
    { word: "apple", translation: "苹果" },
    { word: "banana", translation: null },
  ]);
});

test("bundled official entries keep source statistics and learning fields when imported", async () => {
  const sourceEntry = getBook("ngsl-1.2").words[0];
  const inserted = [];
  const client = {
    from(table) {
      assert.equal(table, "word_entries");
      return {
        async insert(rows) {
          inserted.push(...rows);
          return { error: null };
        },
      };
    },
  };
  await insertEntries(client, "ngsl-copy", [
    {
      ...sourceEntry,
      cn: "这个",
      partOfSpeech: " determiner ",
      phonetic: "/ðə/",
      sentence: "The book is here.",
      sentenceCn: "书在这里。",
      svo: { s: "The book", v: "is", o: "here" },
    },
  ]);
  const entry = rowToEntry(inserted[0]);
  assert.equal(entry.bookId, "ngsl-copy");
  assert.equal(entry.rank, 1);
  assert.equal(entry.sfi, sourceEntry.sfi);
  assert.equal(entry.frequencyPerMillion, sourceEntry.frequencyPerMillion);
  assert.equal(entry.cn, "这个");
  assert.equal(entry.partOfSpeech, "determiner");
  assert.equal(entry.phonetic, "/ðə/");
  assert.equal(entry.sentence, "The book is here.");
  assert.equal(entry.sentenceCn, "书在这里。");
  assert.deepEqual(entry.svo, { s: "The book", v: "is", o: "here" });
});
