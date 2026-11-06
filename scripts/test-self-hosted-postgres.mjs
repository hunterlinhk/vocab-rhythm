import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempDir = await mkdtemp(resolve(tmpdir(), "cadence-postgres-e2e-"));
const databaseDir = resolve(tempDir, "data");
const password = "cadence-local-test-only";
const port = await getFreePort();
const appPort = await getFreePort();
const databaseUrl = `postgres://postgres:${password}@127.0.0.1:${port}/cadence_e2e`;
const origin = `http://127.0.0.1:${appPort}`;
const pg = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password,
  port,
  persistent: false,
  autoRehydrateSymlinks: true,
  postgresFlags: ["-h", "127.0.0.1", "-c", "shared_buffers=64MB", "-c", "max_connections=30"],
  onLog: () => {},
  onError: (error) => process.stderr.write(`${String(error)}\n`),
});

let app;
let vite;
let sql;
let appOutput = "";

try {
  process.stdout.write("Starting embedded PostgreSQL\n");
  await withTimeout(pg.initialise(), 120_000, "PostgreSQL initialization");
  process.stdout.write("Initialized embedded PostgreSQL\n");
  await withTimeout(pg.start(), 30_000, "PostgreSQL startup");
  process.stdout.write("Started embedded PostgreSQL\n");
  await withTimeout(pg.createDatabase("cadence_e2e"), 15_000, "E2E database creation");
  process.stdout.write("Created E2E database\n");

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DB_POOL_SIZE: "5",
    BETTER_AUTH_SECRET: "cadence-local-e2e-secret-with-more-than-32-characters",
    BETTER_AUTH_URL: origin,
    APP_ORIGIN: origin,
    GOOGLE_CLIENT_ID: "cadence-e2e.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "local-e2e-google-oauth-secret",
    HOST: "127.0.0.1",
    PORT: String(appPort),
    NODE_ENV: "production",
  };
  Object.assign(process.env, env);

  await runDatabaseSetup(env);
  process.stdout.write("Applied migrations and data import once\n");
  await runDatabaseSetup(env);
  process.stdout.write("Verified repeatable migrations and data import\n");
  sql = postgres(databaseUrl, { max: 3, prepare: false });
  const dataCounts = await verifyInitializedData(sql);

  app = spawn(process.execPath, [resolve(root, ".output/server/index.mjs")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const captureAppOutput = (chunk) => {
    appOutput = (appOutput + chunk.toString()).slice(-8000);
  };
  app.stdout.on("data", captureAppOutput);
  app.stderr.on("data", captureAppOutput);
  app.once("error", captureAppOutput);
  await waitForServer(origin, app, () => appOutput);
  process.stdout.write("Started production Node server\n");
  const viteRoot = await createServer({
    configFile: false,
    resolve: { alias: { "@": resolve(root, "src") } },
    server: { middlewareMode: true },
  });
  vite = viteRoot;

  const [{ getDatabase }, { createUserStore }, review, lexicon, library, words, learning] = await Promise.all([
    vite.ssrLoadModule("/src/server/db.ts"),
    vite.ssrLoadModule("/src/server/user-store.ts"),
    vite.ssrLoadModule("/src/lib/review-sessions.server.ts"),
    vite.ssrLoadModule("/src/lib/lexicon.server.ts"),
    vite.ssrLoadModule("/src/lib/library.shared.ts"),
    vite.ssrLoadModule("/src/data/words.ts"),
    vite.ssrLoadModule("/src/lib/learning-state.shared.ts"),
  ]);
  const database = getDatabase();

  const google = await authRequest(origin, "sign-in/social", {
    provider: "google",
    callbackURL: `${origin}/learn`,
  });
  assert.equal(new URL(google.body.url).hostname, "accounts.google.com");
  assert.equal(new URL(google.body.url).searchParams.get("client_id"), env.GOOGLE_CLIENT_ID);
  assert.equal(
    new URL(google.body.url).searchParams.get("redirect_uri"),
    `${origin}/api/auth/callback/google`,
  );

  const guest = await authRequest(origin, "sign-in/anonymous", {});
  const guestCookie = sessionCookie(guest.response);
  assert.equal(guest.body.user.isAnonymous, true);
  const guestUserId = guest.body.user.id;
  const guestSession = await authRequest(origin, "get-session", undefined, guestCookie, "GET");
  assert.equal(guestSession.body.user.id, guestUserId);
  const guestStore = createUserStore(database, guestUserId);
  const guestAttemptId = crypto.randomUUID();
  await insertAttempt(guestStore, guestAttemptId, guestUserId, {
    word: "apple",
    translation: "苹果",
    correct: true,
  });
  const guestAttemptOwner = await sql`SELECT user_id FROM public.attempts WHERE id = ${guestAttemptId}`;
  assert.equal(guestAttemptOwner[0]?.user_id, guestUserId);
  const guestBook = await guestStore.table("word_books").insert({
    name: "Guest private book",
    description: null,
    source: "custom",
    owner_user_id: guestUserId,
  }).select("id").single();
  assert.equal(guestBook.error, null);
  await guestStore.table("word_entries").insert({
    book_id: guestBook.data.id,
    position: 0,
    word: "guestword",
    translation: "访客词",
  });

  const linked = await authRequest(origin, "sign-up/email", {
    email: `guest-${Date.now()}@example.test`,
    name: "Linked learner",
    password: "Local_test_123!",
  }, guestCookie);
  const linkedCookie = sessionCookie(linked.response);
  const linkedUserId = linked.body.user.id;
  assert.notEqual(linkedUserId, guestUserId);
  const linkedSession = await authRequest(origin, "get-session", undefined, linkedCookie, "GET");
  assert.equal(linkedSession.body.user.id, linkedUserId);
  assert.equal(linkedSession.body.user.isAnonymous, false);

  const { user } = await import("../drizzle/schema.ts");
  const anonymousRows = await database.select().from(user).where((await import("drizzle-orm")).eq(user.id, guestUserId));
  assert.equal(anonymousRows.length, 0);

  const signedOut = await authRequest(origin, "sign-out", {}, linkedCookie);
  assert.ok(signedOut.response.ok);
  const login = await authRequest(origin, "sign-in/email", {
    email: linked.body.user.email,
    password: "Local_test_123!",
  });
  const accountCookie = sessionCookie(login.response);
  assert.equal(login.body.user.id, linkedUserId);

  const second = await authRequest(origin, "sign-up/email", {
    email: `second-${Date.now()}@example.test`,
    name: "Second learner",
    password: "Local_test_456!",
  });
  const secondUserId = second.body.user.id;
  const storeA = createUserStore(database, linkedUserId);
  const storeB = createUserStore(database, secondUserId);

  const transferredAttempt = await storeA.table("attempts")
    .select("id, word")
    .eq("id", guestAttemptId)
    .single();
  if (!transferredAttempt.data) {
    const [attemptOwner] = await sql`SELECT user_id FROM public.attempts WHERE id = ${guestAttemptId}`;
    const [oldUser] = await sql`SELECT is_anonymous FROM public.user WHERE id = ${guestUserId}`;
    const linkageState = { attemptOwner: attemptOwner?.user_id ?? null, oldUserAnonymous: oldUser?.is_anonymous ?? null };
    throw new Error(`Anonymous data was not linked: ${JSON.stringify({ guestUserId, linkedUserId, linkageState })}`);
  }
  assert.equal(transferredAttempt.data.word, "apple");
  const transferredBook = await storeA.table("word_books")
    .select("id, owner_user_id")
    .eq("id", guestBook.data.id)
    .single();
  assert.equal(transferredBook.data.owner_user_id, linkedUserId);
  const hiddenAttempt = await storeB.table("attempts").select("id").eq("id", guestAttemptId);
  assert.equal(hiddenAttempt.data.length, 0);
  const hiddenBook = await storeB.table("word_books").select("id").eq("id", guestBook.data.id);
  assert.equal(hiddenBook.data.length, 0);
  const maliciousWrite = await storeB.table("attempts").insert({
    id: crypto.randomUUID(),
    user_id: linkedUserId,
    mode: "word",
    book_id: "ngsl-1.2",
    word: "leak",
  });
  assert.match(maliciousWrite.error?.message ?? "", /another user's data/);

  const customBook = await storeA.table("word_books").insert({
    name: "Account A private book",
    description: "isolated",
    source: "custom",
    owner_user_id: linkedUserId,
  }).select("id").single();
  assert.equal(customBook.error, null);
  await storeA.table("word_entries").insert({
    book_id: customBook.data.id,
    position: 0,
    word: "privateword",
    translation: "私有释义",
  });
  const crossBookWrite = await storeB.table("word_entries").insert({
    book_id: customBook.data.id,
    position: 1,
    word: "intrusion",
  });
  assert.match(crossBookWrite.error?.message ?? "", /own custom books/);

  const pilotContent = JSON.parse(await readFile(resolve(root, "src/data/oewn-2025-pilot.json"), "utf8"));
  const pilotWord = pilotContent[0].word;
  const wordEntryRows = await storeA.table("word_entries")
    .select(library.ENTRY_COLS)
    .eq("book_id", "ngsl-1.2")
    .eq("word", pilotWord)
    .limit(1);
  assert.equal(wordEntryRows.error, null);
  const hydrated = await lexicon.hydrateEntries(storeA, wordEntryRows.data.map(library.rowToEntry));
  assert.ok(hydrated[0]?.rank);
  assert.ok(hydrated[0]?.definitionEn);

  const pendingSourceId = "cadence-round2-editorial-bccb9a1ab863";
  const pendingVisible = await storeA.table("lexicon_entries")
    .select("sense_key")
    .eq("source_id", pendingSourceId);
  assert.equal(pendingVisible.data.length, 0);

  const reviewSessionId = crypto.randomUUID();
  await insertReviewAttempt(storeA, linkedUserId, reviewSessionId, "context");
  await insertReviewAttempt(storeA, linkedUserId, reviewSessionId, "recall");
  await review.finalizeReviewSession(storeA, {
    userId: linkedUserId,
    bookId: "ngsl-1.2",
    word: "learn",
    reviewMode: "recognition",
  }, reviewSessionId);
  const reviewRows = await storeA.table("review_states")
    .select("word, next_due_at, interval_seconds")
    .eq("word_key", "learn")
    .eq("review_mode", "recognition");
  assert.equal(reviewRows.data.length, 1);
  assert.equal(reviewRows.data[0].interval_seconds, 86400);
  const privateReviewRows = await storeB.table("review_states").select("word_key");
  assert.equal(privateReviewRows.data.length, 0);

  const todayA = await storeA.todayPracticeCount("UTC");
  const todayB = await storeB.todayPracticeCount("UTC");
  assert.ok(todayA >= 3);
  assert.equal(todayB, 0);
  const attemptRows = await storeA.table("attempts")
    .select("id, user_id, mode, book_id, word, translation, correct, mistouch, typo_count, duration_ms, created_at, is_review, skipped, review_mode, counted_for_review, hint_count, review_session_id, session_stage, time_zone")
    .order("created_at", { ascending: false });
  const stats = learning.buildLearningStats(attemptRows.data, "UTC", new Date());
  assert.ok(stats.totalCount >= 3);

  const editorial = JSON.parse(await readFile(resolve(root, "ops/cadence-round2-editorial/source/rewritten_learning_content.json"), "utf8"));
  const notes = await sql`
    SELECT l.normalized_word, e.usage_note_zh, e.related_sense_key
    FROM public.lexicon_entries e JOIN public.lexemes l ON l.id = e.lexeme_id
    WHERE e.source_id = ${pendingSourceId} AND e.content_type = 'usage_note'
    ORDER BY l.normalized_word`;
  assert.equal(notes.length, 45);
  for (const entry of editorial.entries) {
    const note = notes.find((row) => row.normalized_word === entry.headword.trim().toLowerCase());
    assert.equal(note?.usage_note_zh, entry.usage_note_zh);
  }

  const memory = {
    node: await processMemory(app.pid),
    postgres: await postgresMemory(databaseDir),
  };
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    data: dataCounts,
    auth: ["email sign-up", "email login", "Google OAuth initiation", "anonymous session", "anonymous data linking"],
    permissions: ["attempt isolation", "custom book isolation", "cross-account write blocked"],
    features: ["review scheduling", "local-day stats", "OEWN lookup", "Round 2 pending visibility"],
    memory,
  }, null, 2)}\n`);
} finally {
  if (sql) await sql.end({ timeout: 2 });
  if (vite) await vite.close();
  if (app && !app.killed) {
    app.kill();
    await Promise.race([new Promise((resolve) => app.once("exit", resolve)), delay(5000)]);
  }
  await withTimeout(pg.stop(), 10_000, "PostgreSQL shutdown").catch(() => {});
  await rm(tempDir, { recursive: true, force: true });
}

async function runDatabaseSetup(env) {
  const result = spawnSync(process.execPath, [resolve(root, "scripts/db-setup.mjs")], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0)
    throw new Error(`Database initialization failed:\n${result.stdout}\n${result.stderr}`);
  process.stdout.write(result.stdout.trim() + "\n");
}

async function verifyInitializedData(client) {
  const [ngsl] = await client`SELECT count(*)::int AS count FROM public.word_entries WHERE book_id = 'ngsl-1.2'`;
  const [oewn] = await client`SELECT count(*)::int AS count, count(*) FILTER (WHERE priority = 100)::int AS pilots FROM public.lexicon_entries WHERE source_id = 'oewn-2025'`;
  const [round2] = await client`SELECT count(*)::int AS count, count(*) FILTER (WHERE content_type = 'sense')::int AS senses, count(*) FILTER (WHERE content_type = 'usage_note')::int AS notes FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863' AND publication_status = 'pending_review'`;
  assert.deepEqual(ngsl, { count: 2809 });
  assert.deepEqual(oewn, { count: 19028, pilots: 26 });
  assert.deepEqual(round2, { count: 88, senses: 43, notes: 45 });
  return { ngsl: ngsl.count, oewn: oewn.count, pilots: oewn.pilots, round2: round2.count, round2Senses: round2.senses, usageNotes: round2.notes };
}

async function insertAttempt(store, id, userId, overrides = {}) {
  const result = await store.table("attempts").insert({
    id,
    user_id: userId,
    mode: "word",
    book_id: "ngsl-1.2",
    word: "test",
    translation: null,
    correct: true,
    mistouch: false,
    typo_count: 0,
    duration_ms: 0,
    is_review: false,
    skipped: false,
    hint_count: 0,
    ...overrides,
  });
  if (result.error) throw new Error(result.error.message);
  const [saved] = await sql`SELECT count(*)::int AS count FROM public.attempts WHERE id = ${id}`;
  assert.equal(saved.count, 1, "Drizzle attempt insert must be persisted in PostgreSQL");
}

async function insertReviewAttempt(store, userId, sessionId, stage) {
  await insertAttempt(store, crypto.randomUUID(), userId, {
    mode: "memorize",
    word: "learn",
    translation: "学习",
    is_review: true,
    review_mode: "recognition",
    counted_for_review: true,
    review_session_id: sessionId,
    session_stage: stage,
    time_zone: "UTC",
  });
}

async function authRequest(base, path, body, cookie, method = "POST") {
  const headers = new Headers({ origin: base });
  if (method !== "GET") headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${base}/api/auth/${path}`, {
    method,
    headers,
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!response.ok) throw new Error(`Auth ${path} failed (${response.status}): ${text}`);
  return { response, body: parsed };
}

function sessionCookie(response) {
  const cookies = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const cookie = cookies.find((value) => value.includes("session_token"))?.split(";")[0];
  if (!cookie) throw new Error("Better Auth did not return a session cookie");
  return cookie;
}

async function waitForServer(base, process, getOutput) {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (process.exitCode !== null)
      throw new Error(`Node server exited with code ${process.exitCode}:\n${getOutput()}`);
    try {
      const response = await fetch(`${base}/api/auth/get-session`);
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Node production server did not become ready:\n${getOutput()}`);
}

async function processMemory(pid) {
  if (process.platform === "win32") {
    const command = `(Get-Process -Id ${pid} | Select-Object WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress)`;
    return JSON.parse(spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" }).stdout);
  }
  const status = await readFile(`/proc/${pid}/status`, "utf8");
  return parseProcStatus(status);
}

async function postgresMemory(databaseDir) {
  if (process.platform === "win32") {
    const escapedDirectory = databaseDir.replace(/'/g, "''");
    const command = `$databaseDir = '${escapedDirectory}'; $all = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'postgres.exe' }); $root = $all | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($databaseDir) } | Select-Object -First 1; if (-not $root) { exit 1 }; $ids = @([int]$root.ProcessId); do { $previous = $ids.Count; foreach ($process in $all) { if ($ids -contains [int]$process.ParentProcessId -and $ids -notcontains [int]$process.ProcessId) { $ids += [int]$process.ProcessId } } } while ($ids.Count -gt $previous); Get-Process -Id $ids | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout.trim()) return null;
    const processes = JSON.parse(result.stdout);
    const rows = Array.isArray(processes) ? processes : [processes];
    return {
      processCount: rows.length,
      workingSetBytes: rows.reduce((total, row) => total + row.WorkingSet64, 0),
      privateBytes: rows.reduce((total, row) => total + row.PrivateMemorySize64, 0),
      processes: rows,
    };
  }
  const listing = spawnSync("ps", ["-eo", "pid,ppid,rss,args"], { encoding: "utf8" }).stdout;
  const rows = listing.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]), rssKb: Number(match[3]), args: match[4] }] : [];
  });
  const root = rows.find((row) => row.args.includes(databaseDir));
  if (!root) return null;
  const ids = new Set([root.pid]);
  let changed;
  do {
    changed = false;
    for (const row of rows) {
      if (ids.has(row.parentPid) && !ids.has(row.pid)) {
        ids.add(row.pid);
        changed = true;
      }
    }
  } while (changed);
  const processes = rows.filter(({ pid }) => ids.has(pid));
  return {
    processCount: processes.length,
    residentBytes: processes.reduce((total, row) => total + row.rssKb * 1024, 0),
    processes,
  };
}

function parseProcStatus(status) {
  return Object.fromEntries([...status.matchAll(/^(VmRSS|VmHWM|VmSize):\s+(\d+)\s+kB$/gm)].map((row) => [row[1], Number(row[2]) * 1024]));
}

async function getFreePort() {
  const net = await import("node:net");
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Unable to reserve a test port"));
      const freePort = address.port;
      server.close((error) => error ? reject(error) : resolvePort(freePort));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function withTimeout(promise, milliseconds, stage) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${stage} timed out after ${milliseconds}ms`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
