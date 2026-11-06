import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { eq, sql } from "drizzle-orm";
import {
  account,
  assistantMessages,
  attempts,
  bookProgress,
  profiles,
  reviewScheduleDecisions,
  reviewSessionResults,
  reviewStates,
  session,
  user,
  userBookReviewSettings,
  userSettings,
  verification,
  wordBooks,
  wordMastery,
} from "../../drizzle/schema";
import { getDatabase } from "./db";
import { createUserStore } from "./user-store";
import { rebuildReviewProjectionsForUser } from "../lib/review-sessions.server";

async function linkAnonymousLearningData(anonymousUserId: string, newUserId: string) {
  const db = getDatabase();
  await db.transaction(async (tx) => {
    const [profileRows, settingsRows, progressRows, masteryRows, bookReviewRows, sessionRows, stateRows] =
      await Promise.all([
        tx.select().from(profiles).where(eq(profiles.id, anonymousUserId)),
        tx.select().from(userSettings).where(eq(userSettings.userId, anonymousUserId)),
        tx.select().from(bookProgress).where(eq(bookProgress.userId, anonymousUserId)),
        tx.select().from(wordMastery).where(eq(wordMastery.userId, anonymousUserId)),
        tx.select().from(userBookReviewSettings).where(eq(userBookReviewSettings.userId, anonymousUserId)),
        tx.select().from(reviewSessionResults).where(eq(reviewSessionResults.userId, anonymousUserId)),
        tx.select().from(reviewStates).where(eq(reviewStates.userId, anonymousUserId)),
      ]);

    if (profileRows.length)
      await tx.insert(profiles).values({ ...profileRows[0]!, id: newUserId }).onConflictDoNothing();
    if (settingsRows.length)
      await tx.insert(userSettings).values({ ...settingsRows[0]!, userId: newUserId }).onConflictDoNothing();
    if (progressRows.length)
      await tx.insert(bookProgress).values(progressRows.map((row) => ({ ...row, userId: newUserId }))).onConflictDoNothing();
    if (bookReviewRows.length)
      await tx.insert(userBookReviewSettings)
        .values(bookReviewRows.map((row) => ({ ...row, userId: newUserId })))
        .onConflictDoNothing();

    for (const row of masteryRows)
      await tx.insert(wordMastery)
        .values({ ...row, userId: newUserId })
        .onConflictDoUpdate({
          target: [wordMastery.userId, wordMastery.bookId, wordMastery.word],
          set: {
            contextOk: sql`${wordMastery.contextOk} OR excluded.context_ok`,
            recallOk: sql`${wordMastery.recallOk} OR excluded.recall_ok`,
            spellOk: sql`${wordMastery.spellOk} OR excluded.spell_ok`,
            rounds: sql`greatest(${wordMastery.rounds}, excluded.rounds)`,
            reinforcedAt: sql`greatest(${wordMastery.reinforcedAt}, excluded.reinforced_at)`,
            translation: sql`coalesce(${wordMastery.translation}, excluded.translation)`,
            updatedAt: sql`greatest(${wordMastery.updatedAt}, excluded.updated_at)`,
          },
        });

    if (sessionRows.length)
      await tx.insert(reviewSessionResults)
        .values(sessionRows.map((row) => ({ ...row, userId: newUserId })))
        .onConflictDoNothing();
    if (stateRows.length)
      await tx.insert(reviewStates).values(stateRows.map((row) => ({ ...row, userId: newUserId }))).onConflictDoNothing();

    await tx.update(wordBooks).set({ ownerUserId: newUserId }).where(eq(wordBooks.ownerUserId, anonymousUserId));
    await tx.update(attempts).set({ userId: newUserId }).where(eq(attempts.userId, anonymousUserId));
    await tx.update(assistantMessages).set({ userId: newUserId }).where(eq(assistantMessages.userId, anonymousUserId));
    await tx.update(reviewScheduleDecisions)
      .set({ userId: newUserId })
      .where(eq(reviewScheduleDecisions.userId, anonymousUserId));

    await tx.delete(profiles).where(eq(profiles.id, anonymousUserId));
    await tx.delete(userSettings).where(eq(userSettings.userId, anonymousUserId));
    await tx.delete(bookProgress).where(eq(bookProgress.userId, anonymousUserId));
    await tx.delete(wordMastery).where(eq(wordMastery.userId, anonymousUserId));
    await tx.delete(userBookReviewSettings).where(eq(userBookReviewSettings.userId, anonymousUserId));
    await tx.delete(reviewSessionResults).where(eq(reviewSessionResults.userId, anonymousUserId));
    await tx.delete(reviewStates).where(eq(reviewStates.userId, anonymousUserId));
  });

  await rebuildReviewProjectionsForUser(createUserStore(db, newUserId), newUserId);
}

export function isAllowedAuthOrigin(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "https:" ||
    (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname));
}

function createAuth() {
  const secret = process.env["BETTER_AUTH_SECRET"];
  if (!secret || secret.length < 32)
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  const googleClientId = process.env["GOOGLE_CLIENT_ID"];
  const googleClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const baseURL = process.env["BETTER_AUTH_URL"] || process.env["APP_ORIGIN"];
  const appOrigin = process.env["APP_ORIGIN"];
  if (Boolean(googleClientId) !== Boolean(googleClientSecret))
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together");
  if (process.env["NODE_ENV"] === "production") {
    if (!baseURL || !appOrigin) throw new Error("BETTER_AUTH_URL and APP_ORIGIN are required in production");
    if (!isAllowedAuthOrigin(baseURL) || !isAllowedAuthOrigin(appOrigin))
      throw new Error("BETTER_AUTH_URL and APP_ORIGIN must use HTTPS in production outside loopback tests");
  }
  return betterAuth({
    appName: "Cadence",
    ...(baseURL ? { baseURL } : {}),
    secret,
    ...(appOrigin ? { trustedOrigins: [appOrigin] } : {}),
    database: drizzleAdapter(getDatabase(), {
      provider: "pg",
      schema: { user, session, account, verification },
      usePlural: false,
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 6 },
    socialProviders: googleClientId && googleClientSecret
      ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
      : {},
    plugins: [anonymous({ onLinkAccount: async ({ anonymousUser, newUser }) => {
      await linkAnonymousLearningData(anonymousUser.user.id, newUser.user.id);
    } })],
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  });
}

type AuthInstance = ReturnType<typeof createAuth>;
let instance: AuthInstance | undefined;

export function getAuth(): AuthInstance {
  instance ??= createAuth();
  return instance;
}
