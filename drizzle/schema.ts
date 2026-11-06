import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    uniqueIndex("account_provider_account_unique").on(table.providerId, table.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  createdAt: createdAt(),
});

export const attempts = pgTable(
  "attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("word"),
    bookId: text("book_id").notNull().default("core"),
    word: text("word").notNull(),
    translation: text("translation"),
    correct: boolean("correct").notNull().default(true),
    mistouch: boolean("mistouch").notNull().default(false),
    typoCount: integer("typo_count").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: createdAt(),
    isReview: boolean("is_review").notNull().default(false),
    skipped: boolean("skipped").notNull().default(false),
    reviewMode: text("review_mode"),
    countedForReview: boolean("counted_for_review"),
    hintCount: integer("hint_count").notNull().default(0),
    reviewSessionId: uuid("review_session_id"),
    sessionStage: text("session_stage"),
    timeZone: text("time_zone"),
    reviewWordKey: text("review_word_key").generatedAlwaysAs(
      sql.raw("lower(btrim(regexp_replace(regexp_replace(word, '[[:space:]]+', ' ', 'g'), '[‘’]', chr(39), 'g')))"),
    ),
  },
  (table) => [
    index("attempts_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("attempts_user_book_word_idx").on(table.userId, table.bookId, table.word, table.createdAt.desc()),
    index("attempts_stats_recent_idx").on(table.userId, table.createdAt.desc(), table.id.desc()).where(sql`${table.skipped} = false`),
    index("attempts_review_session_idx").on(
      table.userId,
      table.reviewWordKey,
      table.reviewMode,
      table.reviewSessionId,
      table.createdAt,
      table.id,
    ).where(sql`${table.reviewSessionId} is not null`),
    check("attempts_review_mode_check", sql`${table.reviewMode} is null or ${table.reviewMode} in ('recognition', 'spelling')`),
    check("attempts_counted_review_check", sql`${table.countedForReview} is distinct from true or (${table.reviewMode} is not null and not ${table.skipped})`),
    check("attempts_sentence_not_reviewable_check", sql`${table.mode} <> 'sentence' or (${table.reviewMode} is null and ${table.countedForReview} is distinct from true)`),
    check("attempts_review_mode_owner_check", sql`${table.reviewMode} is null or (${table.reviewMode} = 'recognition' and ${table.mode} = 'memorize') or (${table.reviewMode} = 'spelling' and ${table.mode} = 'word')`),
    check("attempts_review_stage_owner_check", sql`${table.reviewMode} is null or (${table.reviewMode} = 'recognition' and ${table.mode} = 'memorize' and ${table.sessionStage} in ('context', 'recall')) or (${table.reviewMode} = 'spelling' and ${table.mode} = 'word' and ${table.sessionStage} = 'word_spelling')`),
    check("attempts_review_session_check", sql`${table.reviewMode} is null or ${table.reviewSessionId} is not null`),
    check("attempts_session_stage_check", sql`${table.sessionStage} is null or (${table.mode} = 'word' and ${table.sessionStage} = 'word_spelling') or (${table.mode} = 'memorize' and ${table.sessionStage} in ('context', 'recall', 'spell'))`),
    check("attempts_hint_count_check", sql`${table.hintCount} >= 0`),
  ],
);

export const userSettings = pgTable("user_settings", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  dailyGoal: integer("daily_goal").notNull().default(20),
  activeBook: text("active_book").notNull().default("core"),
  updatedAt: updatedAt(),
  memorizeSpelling: boolean("memorize_spelling").notNull().default(true),
  strictSpelling: boolean("strict_spelling").notNull().default(false),
  includeSpellingInReview: boolean("include_spelling_in_review"),
  includeSpellingInReviewFirstChoice: boolean("include_spelling_in_review_first_choice"),
  shareReviewProgress: boolean("share_review_progress").notNull().default(true),
});

export const bookProgress = pgTable(
  "book_progress",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    bookId: text("book_id").notNull(),
    mode: text("mode").notNull().default("word"),
    cursorIndex: integer("cursor_index").notNull().default(0),
    updatedAt: updatedAt(),
    sessionState: jsonb("session_state").notNull().default({}),
    revision: integer("revision").notNull().default(0),
  },
  (table) => [
    primaryKey({ name: "book_progress_pkey", columns: [table.userId, table.bookId, table.mode] }),
    check("book_progress_mode_check", sql`${table.mode} in ('word', 'sentence', 'memorize')`),
    check("book_progress_revision_check", sql`${table.revision} >= 0`),
  ],
);

export const wordMastery = pgTable(
  "word_mastery",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    word: text("word").notNull(),
    bookId: text("book_id").notNull().default("core"),
    translation: text("translation"),
    contextOk: boolean("context_ok").notNull().default(false),
    recallOk: boolean("recall_ok").notNull().default(false),
    spellOk: boolean("spell_ok").notNull().default(false),
    rounds: integer("rounds").notNull().default(0),
    reinforcedAt: timestamp("reinforced_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ name: "word_mastery_pkey", columns: [table.userId, table.bookId, table.word] })],
);

export const wordBooks = pgTable(
  "word_books",
  {
    id: text("id").primaryKey().default(sql.raw("'b_' || replace(gen_random_uuid()::text, '-', '')")),
    name: text("name").notNull(),
    description: text("description"),
    source: text("source").notNull().default("custom"),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    wordCount: integer("word_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("word_books_owner_idx").on(table.ownerUserId),
    check("word_books_source_check", sql`${table.source} in ('official', 'custom')`),
    check("word_books_owner_matches_source", sql`(${table.source} = 'official' and ${table.ownerUserId} is null) or (${table.source} = 'custom' and ${table.ownerUserId} is not null)`),
  ],
);

export const lexemes = pgTable(
  "lexemes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    language: text("language").notNull().default("en"),
    normalizedWord: text("normalized_word").notNull(),
    lemma: text("lemma").notNull(),
    createdAt: createdAt(),
  },
  (table) => [unique("lexemes_language_normalized_word_unique").on(table.language, table.normalizedWord)],
);

export const wordEntries = pgTable(
  "word_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: text("book_id").notNull().references(() => wordBooks.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    word: text("word").notNull(),
    translation: text("translation"),
    phonetic: text("phonetic"),
    sentence: text("sentence"),
    sentenceTranslation: text("sentence_translation"),
    subject: text("subject"),
    verb: text("verb"),
    object: text("object"),
    createdAt: createdAt(),
    partOfSpeech: text("part_of_speech"),
    sourceRank: integer("source_rank"),
    sourceSfi: numeric("source_sfi"),
    sourceFrequencyPerMillion: numeric("source_frequency_per_million"),
    lexemeId: uuid("lexeme_id").references(() => lexemes.id),
  },
  (table) => [
    unique("word_entries_book_word_unique").on(table.bookId, table.word),
    index("word_entries_book_pos_idx").on(table.bookId, table.position),
    index("word_entries_lexeme_idx").on(table.lexemeId),
  ],
);

export const lexiconSources = pgTable(
  "lexicon_sources",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    version: text("version"),
    sourceUrl: text("source_url").notNull(),
    licenseId: text("license_id"),
    licenseUrl: text("license_url"),
    attribution: text("attribution").notNull(),
    accessTier: text("access_tier").notNull().default("public"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    sourceSha256: text("source_sha256"),
    licenseNotice: text("license_notice"),
    transformation: text("transformation"),
    sourceKind: text("source_kind").notNull().default("external"),
  },
  (table) => [
    check("lexicon_sources_access_tier_check", sql`${table.accessTier} in ('public', 'restricted')`),
    check("lexicon_sources_source_kind_check", sql`${table.sourceKind} in ('external', 'editorial')`),
    check("lexicon_sources_external_license_required", sql`${table.sourceKind} = 'editorial' or (${table.licenseId} is not null and ${table.licenseUrl} is not null)`),
    check("lexicon_sources_sha256_check", sql`${table.sourceSha256} is null or ${table.sourceSha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const lexiconEntries = pgTable(
  "lexicon_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lexemeId: uuid("lexeme_id").notNull().references(() => lexemes.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull().references(() => lexiconSources.id),
    sourceEntryRef: text("source_entry_ref"),
    senseKey: text("sense_key").notNull().default("primary"),
    priority: integer("priority").notNull().default(0),
    translation: text("translation"),
    partOfSpeech: text("part_of_speech"),
    phonetic: text("phonetic"),
    definitionEn: text("definition_en"),
    sentence: text("sentence"),
    sentenceTranslation: text("sentence_translation"),
    subject: text("subject"),
    verb: text("verb"),
    object: text("object"),
    createdAt: createdAt(),
    contentType: text("content_type").notNull().default("sense"),
    senseRole: text("sense_role").default("candidate"),
    publicationStatus: text("publication_status").notNull().default("published"),
    reviewDecision: text("review_decision"),
    relatedSenseKey: text("related_sense_key"),
    usageNoteZh: text("usage_note_zh"),
  },
  (table) => [
    unique("lexicon_entries_lexeme_source_sense_unique").on(table.lexemeId, table.sourceId, table.senseKey),
    index("lexicon_entries_lexeme_priority_idx").on(table.lexemeId, table.priority.desc()),
    index("lexicon_entries_publication_lookup_idx").on(table.lexemeId, table.publicationStatus, table.contentType, table.senseRole, table.priority.desc()),
    check("lexicon_entries_content_type_check", sql`${table.contentType} in ('sense', 'usage_note')`),
    check("lexicon_entries_sense_role_check", sql`${table.senseRole} is null or ${table.senseRole} in ('primary', 'supplementary', 'candidate')`),
    check("lexicon_entries_publication_status_check", sql`${table.publicationStatus} in ('pending_review', 'approved', 'published', 'rejected')`),
    check("lexicon_entries_review_decision_check", sql`${table.reviewDecision} is null or ${table.reviewDecision} in ('propose_primary', 'defer_no_suitable_sense')`),
    check("lexicon_entries_content_shape_check", sql`(${table.contentType} = 'sense' and ${table.senseRole} is not null and ${table.usageNoteZh} is null) or (${table.contentType} = 'usage_note' and ${table.senseRole} is null and ${table.translation} is null and ${table.partOfSpeech} is null and ${table.phonetic} is null and ${table.definitionEn} is null and ${table.sentence} is null and ${table.sentenceTranslation} is null and ${table.subject} is null and ${table.verb} is null and ${table.object} is null and ${table.usageNoteZh} is not null)`),
  ],
);

export const userBookReviewSettings = pgTable(
  "user_book_review_settings",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    bookId: text("book_id").notNull(),
    includeInReview: boolean("include_in_review").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: "user_book_review_settings_pkey", columns: [table.userId, table.bookId] }),
    check("user_book_review_settings_book_id_check", sql`btrim(${table.bookId}) <> ''`),
  ],
);

export const reviewSessionResults = pgTable(
  "review_session_results",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    bookId: text("book_id").notNull(),
    word: text("word").notNull(),
    wordKey: text("word_key").notNull(),
    reviewMode: text("review_mode").notNull(),
    sessionId: uuid("session_id").notNull(),
    outcome: text("outcome"),
    countedForReview: boolean("counted_for_review"),
    finalCorrect: boolean("final_correct"),
    hadRealError: boolean("had_real_error").notNull().default(false),
    realWrongCount: integer("real_wrong_count").notNull().default(0),
    usedHint: boolean("used_hint").notNull().default(false),
    hintCount: integer("hint_count").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    validAttemptCount: integer("valid_attempt_count").notNull().default(0),
    lastAttemptId: uuid("last_attempt_id").references(() => attempts.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    timeZone: text("time_zone").notNull(),
    learningDay: date("learning_day").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    revision: integer("revision").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: "review_session_results_pkey", columns: [table.userId, table.bookId, table.wordKey, table.reviewMode, table.sessionId] }),
    index("review_session_results_replay_idx").on(table.userId, table.wordKey, table.reviewMode, table.completedAt, table.bookId, table.sessionId),
    index("review_session_results_book_replay_idx").on(table.userId, table.bookId, table.wordKey, table.reviewMode, table.completedAt, table.sessionId),
    check("review_session_results_word_key_check", sql`${table.wordKey} <> '' and ${table.wordKey} = lower(btrim(regexp_replace(regexp_replace(${table.word}, '[[:space:]]+', ' ', 'g'), '[‘’]', chr(39), 'g')))`),
    check("review_session_results_review_mode_check", sql`${table.reviewMode} in ('recognition', 'spelling')`),
    check("review_session_results_outcome_check", sql`${table.outcome} is null or ${table.outcome} in ('smooth', 'strained', 'failed')`),
    check("review_session_results_real_wrong_count_check", sql`${table.realWrongCount} >= 0`),
    check("review_session_results_hint_count_check", sql`${table.hintCount} >= 0`),
    check("review_session_results_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check("review_session_results_valid_attempt_count_check", sql`${table.validAttemptCount} >= 0`),
    check("review_session_results_revision_check", sql`${table.revision} >= 0`),
  ],
);

export const reviewScheduleDecisions = pgTable(
  "review_schedule_decisions",
  {
    decisionId: uuid("decision_id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    bookId: text("book_id").notNull(),
    word: text("word").notNull(),
    wordKey: text("word_key").notNull(),
    reviewMode: text("review_mode").notNull(),
    sessionId: uuid("session_id").notNull(),
    decisionRevision: integer("decision_revision").notNull(),
    supersedesDecisionId: uuid("supersedes_decision_id"),
    learningDay: date("learning_day").notNull(),
    sessionOutcome: text("session_outcome"),
    effectiveInclusion: boolean("effective_inclusion"),
    isInitialLearning: boolean("is_initial_learning").notNull().default(false),
    stateAdvanced: boolean("state_advanced").notNull(),
    intervalAdvanced: boolean("interval_advanced").notNull(),
    scheduleAction: text("schedule_action").notNull(),
    decisionReason: text("decision_reason").notNull(),
    schedulerVersion: text("scheduler_version").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    beforeState: jsonb("before_state").notNull(),
    afterState: jsonb("after_state").notNull(),
    createdAt: createdAt(),
    scopeKey: text("scope_key").notNull().default("shared"),
  },
  (table) => [
    unique("review_schedule_decisions_scope_revision_unique").on(table.userId, table.scopeKey, table.bookId, table.wordKey, table.reviewMode, table.sessionId, table.decisionRevision),
    foreignKey({ name: "review_schedule_decisions_supersedes_fkey", columns: [table.supersedesDecisionId], foreignColumns: [table.decisionId] }),
    index("review_schedule_decisions_replay_idx").on(table.userId, table.wordKey, table.reviewMode, table.learningDay, table.createdAt),
    check("review_schedule_decisions_word_key_check", sql`${table.wordKey} <> '' and ${table.wordKey} = lower(btrim(regexp_replace(regexp_replace(${table.word}, '[[:space:]]+', ' ', 'g'), '[‘’]', chr(39), 'g')))`),
    check("review_schedule_decisions_review_mode_check", sql`${table.reviewMode} in ('recognition', 'spelling')`),
    check("review_schedule_decisions_revision_check", sql`${table.decisionRevision} >= 0`),
    check("review_schedule_decisions_outcome_check", sql`${table.sessionOutcome} is null or ${table.sessionOutcome} in ('smooth', 'strained', 'failed')`),
    check("review_schedule_decisions_action_check", sql`${table.scheduleAction} in ('initialize', 'grow', 'hold', 'failure_reset_short', 'none')`),
    check("review_schedule_decisions_reason_check", sql`${table.decisionReason} in ('first_learning', 'normal_growth', 'same_day_repeat', 'failure_reset', 'inclusion_pending', 'excluded_by_choice', 'excluded_by_preference', 'excluded_by_book_setting', 'no_valid_attempts')`),
    check("review_schedule_decisions_scope_key_check", sql`${table.scopeKey} = 'shared' or (${table.scopeKey} like 'book:%' and length(${table.scopeKey}) > 5)`),
  ],
);

export const reviewStates = pgTable(
  "review_states",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    word: text("word").notNull(),
    wordKey: text("word_key").notNull(),
    sourceBookId: text("source_book_id"),
    reviewMode: text("review_mode").notNull(),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    nextDueAt: timestamp("next_due_at", { withTimezone: true }),
    intervalSeconds: integer("interval_seconds"),
    consecutiveCorrect: integer("consecutive_correct").notNull().default(0),
    totalWrong: integer("total_wrong").notNull().default(0),
    hintCount: integer("hint_count").notNull().default(0),
    difficulty: numeric("difficulty"),
    schedulerData: jsonb("scheduler_data").notNull().default({}),
    lastAttemptId: uuid("last_attempt_id").references(() => attempts.id, { onDelete: "set null" }),
    lastSessionId: uuid("last_session_id"),
    lastLearningDay: date("last_learning_day"),
    successfulGrowthDay: date("successful_growth_day"),
    pendingAction: text("pending_action").notNull().default("none"),
    lastOutcome: text("last_outcome"),
    lastDecisionReason: text("last_decision_reason"),
    schedulerVersion: text("scheduler_version"),
    lastDecisionId: uuid("last_decision_id"),
    revision: integer("revision").notNull().default(0),
    updatedAt: updatedAt(),
    scopeKey: text("scope_key").notNull().default("shared"),
  },
  (table) => [
    primaryKey({ name: "review_states_pkey", columns: [table.userId, table.wordKey, table.reviewMode, table.scopeKey] }),
    foreignKey({
      name: "review_states_last_decision_fk",
      columns: [table.lastDecisionId],
      foreignColumns: [reviewScheduleDecisions.decisionId],
    }).onDelete("set null"),
    index("review_states_due_idx").on(table.userId, table.reviewMode, table.nextDueAt).where(sql`${table.nextDueAt} is not null`),
    index("review_states_scoped_due_idx").on(table.userId, table.reviewMode, table.scopeKey, table.nextDueAt).where(sql`${table.nextDueAt} is not null`),
    check("review_states_word_key_check", sql`${table.wordKey} <> '' and ${table.wordKey} = lower(btrim(regexp_replace(regexp_replace(${table.word}, '[[:space:]]+', ' ', 'g'), '[‘’]', chr(39), 'g')))`),
    check("review_states_review_mode_check", sql`${table.reviewMode} in ('recognition', 'spelling')`),
    check("review_states_interval_check", sql`${table.intervalSeconds} is null or ${table.intervalSeconds} >= 0`),
    check("review_states_counts_check", sql`${table.consecutiveCorrect} >= 0 and ${table.totalWrong} >= 0 and ${table.hintCount} >= 0`),
    check("review_states_pending_action_check", sql`${table.pendingAction} in ('initialize', 'grow', 'hold', 'failure_reset_short', 'none')`),
    check("review_states_outcome_check", sql`${table.lastOutcome} is null or ${table.lastOutcome} in ('smooth', 'strained', 'failed')`),
    check("review_states_revision_check", sql`${table.revision} >= 0`),
    check("review_states_scope_key_check", sql`${table.scopeKey} = 'shared' or (${table.scopeKey} like 'book:%' and length(${table.scopeKey}) > 5)`),
  ],
);

export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("assistant_messages_user_idx").on(table.userId, table.createdAt)],
);

export const schema = {
  account,
  assistantMessages,
  attempts,
  bookProgress,
  lexiconEntries,
  lexiconSources,
  lexemes,
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
  wordEntries,
  wordMastery,
};
