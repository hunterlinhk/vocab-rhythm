import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "./database-test-helper.mjs";
import { createTestViteServer } from "./vite-test-helper.mjs";

const vite = await createTestViteServer();
after(() => vite.close());

test("production auth origins require HTTPS except for loopback E2E hosts", async () => {
  const { isAllowedAuthOrigin } = await vite.ssrLoadModule("/src/server/auth.ts");
  assert.equal(isAllowedAuthOrigin("https://cadence.example"), true);
  assert.equal(isAllowedAuthOrigin("http://localhost:3000"), true);
  assert.equal(isAllowedAuthOrigin("http://127.0.0.1:3000"), true);
  assert.equal(isAllowedAuthOrigin("http://cadence.example"), false);
  assert.throws(() => isAllowedAuthOrigin("not a URL"), /Invalid URL/);
});

async function database() {
  const result = await createTestDatabase(vite);
  await result.db.insert(result.schema.user).values([
    { id: "learner-a", name: "Learner A", email: "learner-a@example.test" },
    { id: "learner-b", name: "Learner B", email: "learner-b@example.test" },
  ]);
  return result;
}

test("learning records and custom books stay isolated between accounts", async () => {
  const { client, db, schema, createUserStore } = await database();
  try {
    const storeA = createUserStore(db, "learner-a");
    const storeB = createUserStore(db, "learner-b");
    const attemptA = "00000000-0000-0000-0000-000000000201";
    const attemptB = "00000000-0000-0000-0000-000000000202";
    assert.equal((await storeA.table("attempts").insert({ id: attemptA, mode: "word", book_id: "ngsl-1.2", word: "apple" })).error, null);
    assert.equal((await storeB.table("attempts").insert({ id: attemptB, mode: "word", book_id: "ngsl-1.2", word: "secret" })).error, null);
    assert.equal((await storeA.table("attempts").select("id, word")).data.length, 1);
    assert.equal((await storeB.table("attempts").select("id, word")).data[0].word, "secret");
    assert.match(
      (await storeB.table("attempts").insert({ id: crypto.randomUUID(), user_id: "learner-a", word: "forged" })).error.message,
      /another user's data/,
    );
    assert.match(
      (await storeA.table("attempts").update({ user_id: "learner-b" }).eq("id", attemptA)).error.message,
      /Ownership and source fields cannot be changed/,
    );
    assert.equal((await storeA.table("attempts").upsert({
      id: attemptB,
      user_id: "learner-a",
      mode: "word",
      book_id: "ngsl-1.2",
      word: "overwritten",
    }, { onConflict: "id" })).error, null);
    const [untouched] = await db.select().from(schema.attempts).where(eq(schema.attempts.id, attemptB));
    assert.equal(untouched.userId, "learner-b");
    assert.equal(untouched.word, "secret");

    const { data: book, error: bookError } = await storeA.table("word_books").insert({ name: "Private", source: "custom" }).select("id").single();
    assert.equal(bookError, null);
    assert.ok(book?.id);
    assert.equal((await storeA.table("word_entries").insert({ book_id: book.id, word: "privateword" })).error, null);
    assert.equal((await storeB.table("word_books").select("id")).data.length, 0);
    assert.equal((await storeB.table("word_entries").select("word").eq("book_id", book.id)).data.length, 0);
    assert.match(
      (await storeB.table("word_entries").insert({ book_id: book.id, word: "intrusion" })).error.message,
      /own custom books/,
    );
    assert.match(
      (await storeA.table("word_books").update({ owner_user_id: "learner-b" }).eq("id", book.id)).error.message,
      /Ownership and source fields cannot be changed/,
    );
  } finally {
    await client.close();
  }
});

test("restricted and pending lexicon records are hidden until both gates are released", async () => {
  const { client, db, schema, createUserStore } = await database();
  try {
    const [lexeme] = await db.insert(schema.lexemes).values({ normalizedWord: "newword", lemma: "newword" }).returning();
    await db.insert(schema.lexiconSources).values({
      id: "editorial-test",
      title: "Pending editorial test",
      sourceUrl: "https://example.test/editorial",
      attribution: "Cadence editorial test",
      accessTier: "restricted",
      sourceKind: "editorial",
    });
    await db.insert(schema.lexiconEntries).values({
      lexemeId: lexeme.id,
      sourceId: "editorial-test",
      senseKey: "newword:pending",
      priority: 110,
      translation: "新词",
      definitionEn: "A pending sense.",
      contentType: "sense",
      senseRole: "primary",
      publicationStatus: "pending_review",
    });
    const store = createUserStore(db, "learner-a");
    const query = () => store.table("lexicon_entries").select("sense_key").eq("source_id", "editorial-test");
    assert.equal((await query()).data.length, 0);
    await db.update(schema.lexiconSources).set({ accessTier: "public" }).where(eq(schema.lexiconSources.id, "editorial-test"));
    assert.equal((await query()).data.length, 0);
    await db.update(schema.lexiconEntries).set({ publicationStatus: "published" }).where(
      eq(schema.lexiconEntries.sourceId, "editorial-test"),
    );
    assert.deepEqual((await query()).data, [{ sense_key: "newword:pending" }]);
  } finally {
    await client.close();
  }
});
