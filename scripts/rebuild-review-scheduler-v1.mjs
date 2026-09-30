import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const PAGE_SIZE = 500;
const LEGACY_VERSION = "review-foundation-v3";
const usage = `Usage:
  npm run rebuild:review-scheduler-v1 -- [--report <file>]
  npm run rebuild:review-scheduler-v1 -- --apply --report <file>

The default is a read-only dry run. Apply replays existing Review v1 session results for
active scopes with a null or ${LEGACY_VERSION} scheduler version. It does not infer
sessions from attempts that lack Review v1 metadata. The report path must not exist.
Both modes require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment.
Reports include user ids and word keys; store them outside the repository.
`;

function parseArguments(args) {
  const options = { apply: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--report") {
      options.report = args[++index];
      if (!options.report || options.report.startsWith("--")) {
        throw new Error("--report requires a file path");
      }
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (options.apply && !options.report) throw new Error("Apply mode requires --report");
  return options;
}

async function fetchLegacyStates(supabase) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("review_states")
      .select("user_id, word_key, review_mode, scope_key, scheduler_version")
      .or(`scheduler_version.is.null,scheduler_version.eq.${LEGACY_VERSION}`)
      .order("user_id")
      .order("word_key")
      .order("review_mode")
      .order("scope_key")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function fetchSharingSettings(supabase, userIds) {
  const settings = new Map();
  for (let offset = 0; offset < userIds.length; offset += 100) {
    const { data, error } = await supabase
      .from("user_settings")
      .select("user_id, share_review_progress")
      .in("user_id", userIds.slice(offset, offset + 100));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) settings.set(row.user_id, row.share_review_progress);
  }
  return settings;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[name]) throw new Error(`Missing server-side environment variable: ${name}`);
  }

  const vite = await createServer({
    configFile: false,
    root: process.cwd(),
    resolve: { alias: { "@": resolve(process.cwd(), "src") } },
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  try {
    const [{ rebuildReviewState }, { reviewSchedulerV1 }, { supabaseAdmin }] = await Promise.all([
      vite.ssrLoadModule("/src/lib/review-sessions.server.ts"),
      vite.ssrLoadModule("/src/lib/review-scheduler.shared.ts"),
      vite.ssrLoadModule("/src/integrations/supabase/client.server.ts"),
    ]);
    const legacyStates = await fetchLegacyStates(supabaseAdmin);
    const settings = await fetchSharingSettings(
      supabaseAdmin,
      [...new Set(legacyStates.map((row) => row.user_id))],
    );
    const candidates = legacyStates.filter((row) => {
      const sharing = settings.get(row.user_id) ?? true;
      return sharing ? row.scope_key === "shared" : row.scope_key.startsWith("book:");
    });
    const report = {
      mode: options.apply ? "apply" : "dry-run",
      status: options.apply ? "applying" : "dry-run",
      schedulerVersion: reviewSchedulerV1.version,
      generatedAt: new Date().toISOString(),
      legacyStates: legacyStates.length,
      inactiveScopeStates: legacyStates.length - candidates.length,
      candidates: candidates.map((row) => ({
        userId: row.user_id,
        wordKey: row.word_key,
        reviewMode: row.review_mode,
        scopeKey: row.scope_key,
      })),
      rebuiltStates: 0,
    };
    const reportPath = options.report ? resolve(options.report) : null;
    if (reportPath) {
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    }
    console.log(JSON.stringify({
      mode: report.mode,
      status: report.status,
      schedulerVersion: report.schedulerVersion,
      legacyStates: report.legacyStates,
      inactiveScopeStates: report.inactiveScopeStates,
      candidates: report.candidates.length,
      reportPath,
    }));
    if (!options.apply) return;

    let rebuiltStates = 0;
    try {
      for (const identity of candidates) {
        await rebuildReviewState(supabaseAdmin, identity, { refreshSessionResults: false });
        rebuiltStates += 1;
      }
      report.status = "complete";
      report.rebuiltStates = rebuiltStates;
    } catch (error) {
      report.status = "failed";
      report.rebuiltStates = rebuiltStates;
      report.partialProgressPossible = true;
      report.failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      report.completedAt = new Date().toISOString();
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "w" });
      console.log(JSON.stringify({ status: report.status, rebuiltStates: report.rebuiltStates, reportPath }));
    }
  } finally {
    await vite.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
