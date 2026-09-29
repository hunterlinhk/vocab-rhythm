import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const usage = `Usage:
  npm run repair:review-state-projections -- --from <ISO timestamp> --until <ISO timestamp> [--report <file>]
  npm run repair:review-state-projections -- --from <ISO timestamp> --until <ISO timestamp> --apply --confirm-0013-applied --report <file>

The default is a read-only dry run. Boundaries must include a timezone; the start is inclusive and the end is exclusive.
Use the exact production 0011 and 0013 deployment window. Apply only after 0013 is confirmed deployed and the dry-run report is reviewed.
The apply mode requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server-side environment.
`;

function parseArguments(args) {
  const parsed = { apply: false, confirm0013Applied: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--apply") parsed.apply = true;
    else if (arg === "--confirm-0013-applied") parsed.confirm0013Applied = true;
    else if (arg === "--from") parsed.from = args[++index];
    else if (arg === "--until") parsed.until = args[++index];
    else if (arg === "--report") parsed.report = args[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (parsed.help) return parsed;
  if (!parsed.from || !parsed.until) throw new Error("Both --from and --until are required");
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(parsed.from) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(parsed.until)) {
    throw new Error("--from and --until must be ISO timestamps with a timezone");
  }
  if (!Number.isFinite(Date.parse(parsed.from)) || !Number.isFinite(Date.parse(parsed.until))) {
    throw new Error("--from and --until must be valid timestamps");
  }
  if (Date.parse(parsed.from) >= Date.parse(parsed.until)) {
    throw new Error("--from must be earlier than --until");
  }
  if (parsed.apply && !parsed.confirm0013Applied) {
    throw new Error("Apply mode requires --confirm-0013-applied");
  }
  if (parsed.apply && !parsed.report) {
    throw new Error("Apply mode requires --report so the affected identities are recorded");
  }
  return parsed;
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
    const [{ applyMissingReviewStateRepairs, planMissingReviewStatesInWindow }, { supabaseAdmin }] = await Promise.all([
      vite.ssrLoadModule("/src/lib/review-sessions.server.ts"),
      vite.ssrLoadModule("/src/integrations/supabase/client.server.ts"),
    ]);
    const plan = await planMissingReviewStatesInWindow(supabaseAdmin, options.from, options.until);
    let report = {
      mode: options.apply ? "apply" : "dry-run",
      status: options.apply ? "applying" : "dry-run",
      generatedAt: new Date().toISOString(),
      ...plan,
      repairedStates: 0,
    };
    const reportPath = options.report ? resolve(options.report) : undefined;
    if (reportPath) {
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    }
    console.log(JSON.stringify(report, null, 2));

    if (options.apply) {
      try {
        const repairedStates = await applyMissingReviewStateRepairs(supabaseAdmin, plan.missingStates);
        report = { ...report, status: "complete", completedAt: new Date().toISOString(), repairedStates };
      } catch (error) {
        report = {
          ...report,
          status: "failed",
          completedAt: new Date().toISOString(),
          repairedStates: null,
          partialProgressUnknown: true,
          failure: error instanceof Error ? error.message : String(error),
        };
        if (reportPath) {
          await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "w" });
        }
        throw error;
      }
      if (reportPath) {
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "w" });
      }
      console.log(JSON.stringify(report, null, 2));
    } else if (reportPath) {
      console.log(`Audit report written to ${reportPath}`);
    }
  } finally {
    await vite.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
