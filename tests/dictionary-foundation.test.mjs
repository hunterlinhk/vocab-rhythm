import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { createTestDatabase } from "./database-test-helper.mjs";
import { createTestViteServer } from "./vite-test-helper.mjs";

const vite = await createTestViteServer();
after(() => vite.close());
const { hydrateEntries } = await vite.ssrLoadModule("/src/lib/lexicon.server.ts");
const { rowToEntry } = await vite.ssrLoadModule("/src/lib/library.shared.ts");

test("custom wordbook rows link into the shared lexicon and only published public expressions hydrate", async () => {
  const { client, db, schema, createUserStore } = await createTestDatabase(vite);
  try {
    await db.insert(schema.user).values({ id: "dictionary-owner", name: "Dictionary Owner", email: "dictionary-owner@example.test" });
    await db.insert(schema.lexiconSources).values([
      {
        id: "oewn-2025",
        title: "Open English WordNet 2025",
        sourceUrl: "https://en-word.net/",
        licenseId: "CC-BY-4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        attribution: "OEWN",
        sourceKind: "external",
      },
      {
        id: "cadence-round2-editorial-bccb9a1ab863",
        title: "Round 2",
        sourceUrl: "https://coci.ink/",
        attribution: "Cadence",
        accessTier: "restricted",
        sourceKind: "editorial",
      },
      {
        id: "ecdict",
        title: "ECDICT",
        sourceUrl: "https://github.com/skywind3000/ECDICT",
        licenseId: "MIT",
        licenseUrl: "https://github.com/skywind3000/ECDICT/blob/master/LICENSE",
        attribution: "ECDICT",
      },
      {
        id: "cadence_headword_ranking",
        title: "Cadence headword ranking",
        sourceUrl: "https://coci.ink/",
        attribution: "Cadence",
        sourceKind: "editorial",
      },
      {
        id: "cadence_enhanced_entries",
        title: "Cadence authored lexicon",
        sourceUrl: "https://coci.ink/",
        attribution: "Cadence",
        accessTier: "restricted",
        sourceKind: "editorial",
      },
    ]);
    await db.insert(schema.lexemes).values([
      { normalizedWord: "take", lemma: "take" },
      { normalizedWord: "take-in", lemma: "take-in" },
      { normalizedWord: "take-out", lemma: "take-out" },
      { normalizedWord: "pilotword", lemma: "pilotword" },
      { normalizedWord: "round2word", lemma: "round2word" },
    ]);
    const lexemes = await db.select().from(schema.lexemes);
    const ids = new Map(lexemes.map((row) => [row.normalizedWord, row.id]));
    await db.insert(schema.lexiconEntries).values([
      {
        lexemeId: ids.get("pilotword"),
        sourceId: "oewn-2025",
        sourceEntryRef: "pilot-sense",
        senseKey: "pilot-sense",
        priority: 100,
        translation: "pilot translation",
        partOfSpeech: "noun",
        senseRole: "primary",
      },
      {
        lexemeId: ids.get("round2word"),
        sourceId: "cadence-round2-editorial-bccb9a1ab863",
        sourceEntryRef: "round2-sense",
        senseKey: "round2-sense",
        priority: 110,
        translation: "pending translation",
        partOfSpeech: "noun",
        senseRole: "primary",
        publicationStatus: "pending_review",
        reviewDecision: "propose_primary",
      },
      {
        lexemeId: ids.get("take"),
        sourceId: "cadence_enhanced_entries",
        sourceEntryRef: "1",
        senseKey: "take.verb.1",
        priority: 200,
        translation: "精编释义",
        partOfSpeech: "verb",
        definitionEn: "to carry or move something from one place to another",
        sentence: "She took the book home.",
        sentenceTranslation: "她把书带回了家。",
        contentType: "sense",
        senseRole: "primary",
        publicationStatus: "published",
        editorialData: {
          index: 1,
          label_zh: "带走",
          definition_zh: "把某物从一处带到另一处。",
          understanding_examples: [{ en: "She took the book home.", zh: "她把书带回了家。" }],
        },
      },
    ]);
    await db.insert(schema.dictionarySourceEntries).values({
      sourceId: "ecdict",
      sourceEntryRef: "ecdict-take",
      lexemeId: ids.get("take"),
      definitionRaw: "ECDICT conflicting definition",
      translationRaw: "ECDICT conflicting translation",
      definitionPosCodes: ["n"],
    });
    await db.insert(schema.dictionaryHeadwords).values({
      sourceId: "cadence_headword_ranking",
      headwordNorm: "take",
      headword: "take",
      lexemeId: ids.get("take"),
      sourceRank: 1,
    });
    await db.insert(schema.dictionaryExpressionLinks).values({
      sourceId: "cadence_headword_ranking",
      sourceEntryRef: "1",
      expressionNorm: "take-in",
      expression: "take-in",
      expressionLexemeId: ids.get("take-in"),
      attachTo: "take",
      attachToNorm: "take",
      parentLexemeId: ids.get("take"),
      handling: "attach_to_parent",
    });
    await db.insert(schema.dictionaryExpressionReviews).values({
      sourceId: "cadence_headword_ranking",
      expressionNorm: "unreviewed-expression",
      expression: "unreviewed-expression",
      reason: "needs review",
      reviewJson: {},
    });
    await db.insert(schema.lexiconDocuments).values([
      {
        sourceId: "cadence_enhanced_entries",
        documentKey: "expression:take-in",
        documentType: "expression",
        lexemeId: ids.get("take-in"),
        parentLexemeId: ids.get("take"),
        priority: 200,
        publicationStatus: "published",
        contentJson: {
          expression: "take-in",
          part_of_speech: "noun",
          senses: [{ id: "take-in.noun.1", label_zh: "骗局", definition_en: "an act of deceiving someone", definition_zh: "欺骗行为" }],
        },
      },
      {
        sourceId: "cadence_enhanced_entries",
        documentKey: "expression:take-out",
        documentType: "expression",
        lexemeId: ids.get("take-out"),
        parentLexemeId: ids.get("take"),
        priority: 200,
        publicationStatus: "pending_review",
        contentJson: { expression: "take-out", part_of_speech: "noun", senses: [] },
      },
    ]);

    const store = createUserStore(db, "dictionary-owner");
    const privateRead = await store.table("lexicon_documents").select("document_key");
    assert.equal(privateRead.data.length, 0);

    await db.update(schema.lexiconSources)
      .set({ accessTier: "public" })
      .where(eq(schema.lexiconSources.id, "cadence_enhanced_entries"));
    const publicRead = await store.table("lexicon_documents").select("document_key");
    assert.deepEqual(publicRead.data.map((row) => row.document_key), ["expression:take-in"]);

    const [authoredEntry] = await hydrateEntries(store, [{ word: "take" }]);
    assert.equal(authoredEntry.cn, "精编释义");
    assert.equal(authoredEntry.definitionEn, "to carry or move something from one place to another");
    assert.equal(authoredEntry.dictionarySource, undefined);
    assert.equal(authoredEntry.sentence, "She took the book home.");

    const { data: book, error: bookError } = await store.table("word_books").insert({
      name: "My book",
      source: "custom",
      owner_user_id: "dictionary-owner",
    }).select("id").single();
    assert.equal(bookError, null);
    assert.equal((await store.table("word_entries").insert({
      book_id: book.id,
      position: 0,
      word: "TAKE",
      translation: "我的词书释义",
    })).error, null);
    await store.table("attempts").insert({
      id: "00000000-0000-0000-0000-000000000123",
      mode: "word",
      book_id: book.id,
      word: "TAKE",
      translation: "我的词书释义",
    });
    await store.table("word_mastery").insert({ book_id: book.id, word: "TAKE", translation: "我的词书释义" });
    await store.table("book_progress").insert({ book_id: book.id, mode: "word", cursor_index: 1 });
    const linked = await store.table("word_entries").select("word, lexeme_id, translation").eq("book_id", book.id).single();
    assert.equal(linked.data.lexeme_id, ids.get("take"));

    const [entry] = await hydrateEntries(store, [rowToEntry({ ...linked.data, book_id: book.id })]);
    assert.equal(entry.cn, "我的词书释义");
    assert.deepEqual(entry.extendedExpressions?.map((item) => item.expression), ["take-in"]);
    assert.equal(entry.extendedExpressions?.[0]?.senses[0]?.definitionZh, "欺骗行为");

    const round2Before = await db.select().from(schema.lexiconEntries).where(eq(schema.lexiconEntries.sourceId, "cadence-round2-editorial-bccb9a1ab863"));
    const pilotBefore = await db.select().from(schema.lexiconEntries).where(eq(schema.lexiconEntries.sourceId, "oewn-2025"));
    const userRecordsBefore = await Promise.all(
      ["word_books", "word_entries", "attempts", "word_mastery", "book_progress"].map((table) =>
        store.table(table).select("*"),
      ),
    );
    const rollback = await readFile(new URL("../scripts/rollback-dictionary-foundation.sql", import.meta.url), "utf8");
    await client.exec(rollback);
    assert.deepEqual(
      await db.select().from(schema.lexiconEntries).where(eq(schema.lexiconEntries.sourceId, "cadence-round2-editorial-bccb9a1ab863")),
      round2Before,
    );
    assert.deepEqual(
      await db.select().from(schema.lexiconEntries).where(eq(schema.lexiconEntries.sourceId, "oewn-2025")),
      pilotBefore,
    );
    for (let index = 0; index < userRecordsBefore.length; index++) {
      const table = ["word_books", "word_entries", "attempts", "word_mastery", "book_progress"][index];
      assert.deepEqual((await store.table(table).select("*" )).data, userRecordsBefore[index].data);
    }
    assert.equal((await db.select().from(schema.dictionarySourceEntries)).length, 0);
    assert.equal((await db.select().from(schema.dictionaryHeadwords)).length, 0);
    assert.equal((await db.select().from(schema.dictionaryExpressionLinks)).length, 0);
    assert.equal((await db.select().from(schema.dictionaryExpressionReviews)).length, 0);
    assert.equal((await db.select().from(schema.lexiconDocuments).where(eq(schema.lexiconDocuments.sourceId, "cadence_enhanced_entries"))).length, 0);
    assert.equal((await db.select().from(schema.lexiconEntries).where(eq(schema.lexiconEntries.sourceId, "cadence_enhanced_entries"))).length, 0);
    assert.equal((await db.select().from(schema.lexemes)).length, 5);
  } finally {
    await client.close();
  }
});
