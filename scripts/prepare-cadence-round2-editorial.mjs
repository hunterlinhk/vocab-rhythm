import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(root, "ops/cadence-round2-editorial/source");
const contentPath = resolve(sourceDir, "rewritten_learning_content.json");
const decisionsPath = resolve(sourceDir, "round2_decisions.jsonl");
const pilotPath = resolve(root, "src/data/oewn-2025-pilot.json");
const outputDir = resolve(root, "ops/cadence-round2-editorial");
const importPath = resolve(outputDir, "01-import-pending.sql");
const rollbackPath = resolve(outputDir, "02-rollback-editorial-source.sql");
const manifestPath = resolve(outputDir, "manifest.json");

const expectedInputCounts = {
  missing_core_sense: 38,
  additional_common_sense: 3,
  definition_rewrite: 2,
  usage_note: 2,
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sql = (value) => (value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`);
const key = (word) => word.trim().toLowerCase();

function parseJsonl(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function mapEditorialContent(document, decisions, pilotRows) {
  if (document.status !== "editorial_supplement_complete_local_only")
    throw new Error("Unexpected editorial content status");
  const entries = document.entries;
  if (!Array.isArray(entries) || entries.length !== 45)
    throw new Error("Expected 45 content entries");

  const counts = Object.fromEntries(Object.keys(expectedInputCounts).map((type) => [type, 0]));
  const decisionByWord = new Map();
  for (const decision of decisions) {
    const normalized = key(decision.headword);
    if (decisionByWord.has(normalized))
      throw new Error(`Duplicate Round 2 decision: ${decision.headword}`);
    decisionByWord.set(normalized, decision);
  }

  const pilotWords = new Set(pilotRows.map((row) => key(row.word)));
  const mapped = [];
  const seen = new Set();
  for (const entry of entries) {
    const normalized = key(entry.headword);
    if (!normalized || seen.has(normalized))
      throw new Error(`Duplicate or blank headword: ${entry.headword}`);
    seen.add(normalized);
    if (pilotWords.has(normalized))
      throw new Error(`Round 2 overlaps a preserved pilot: ${entry.headword}`);
    if (!(entry.entry_type in expectedInputCounts))
      throw new Error(`Unknown content type: ${entry.entry_type}`);
    counts[entry.entry_type] += 1;

    const decision = decisionByWord.get(normalized);
    if (!decision) throw new Error(`Missing Round 2 decision: ${entry.headword}`);
    if (decision.pilot_preserved)
      throw new Error(`Round 2 row is marked as a pilot: ${entry.headword}`);
    if (decision.final_primary_sense_id !== entry.current_primary_sense_id)
      throw new Error(`Primary sense ID mismatch: ${entry.headword}`);
    const expectedDecision =
      entry.entry_type === "missing_core_sense" ? "defer_no_suitable_sense" : "propose_primary";
    if (decision.final_decision !== expectedDecision)
      throw new Error(`Round 2 decision mismatch: ${entry.headword}`);
    const candidates = decision.oewn_candidate_ids ?? [];
    for (const senseId of [entry.oewn_sense_id, entry.current_primary_sense_id]) {
      if (senseId && !candidates.includes(senseId))
        throw new Error(`Sense ID is not an audited candidate for ${entry.headword}: ${senseId}`);
    }
    if (!entry.usage_note_zh?.trim())
      throw new Error(`Missing usage note: ${entry.headword}`);
    if (
      entry.entry_type !== "usage_note" &&
      (!entry.gloss_zh?.trim() || !entry.definition_en?.trim())
    )
      throw new Error(`Missing sense wording: ${entry.headword}`);

    const common = {
      headword: entry.headword,
      normalizedWord: normalized,
      editorialKind: entry.entry_type,
      oewnSenseId: entry.oewn_sense_id,
      currentPrimarySenseId: entry.current_primary_sense_id,
    };
    const senseRow =
      entry.entry_type === "usage_note"
        ? null
        : {
            ...common,
            senseKey: `cadence-round2:${normalized}:${entry.entry_type}`,
            contentType: "sense",
            senseRole: entry.entry_type === "additional_common_sense" ? "supplementary" : "primary",
            priority: entry.entry_type === "additional_common_sense" ? 0 : 110,
            translation: entry.gloss_zh,
            partOfSpeech: entry.part_of_speech ?? null,
            definitionEn: entry.definition_en,
            usageNoteZh: null,
            publicationStatus: "pending_review",
            reviewDecision: decision.final_decision,
            relatedSenseKey: entry.current_primary_sense_id ?? null,
          };
    if (senseRow) mapped.push(senseRow);

    const relatedSenseKey = senseRow?.senseKey ?? entry.current_primary_sense_id;
    if (!relatedSenseKey)
      throw new Error(`Usage note has no related sense: ${entry.headword}`);
    mapped.push({
      ...common,
      senseKey: `cadence-round2:${normalized}:usage_note`,
      contentType: "usage_note",
      senseRole: null,
      priority: 0,
      translation: null,
      partOfSpeech: null,
      definitionEn: null,
      usageNoteZh: entry.usage_note_zh,
      publicationStatus: "pending_review",
      reviewDecision: senseRow ? null : decision.final_decision,
      relatedSenseKey,
    });
  }
  if (decisionByWord.size !== entries.length)
    throw new Error("Round 2 decision count does not match content count");
  for (const [type, expected] of Object.entries(expectedInputCounts)) {
    if (counts[type] !== expected)
      throw new Error(`Expected ${expected} ${type} rows, got ${counts[type]}`);
  }
  if (mapped.filter((row) => row.contentType === "sense").length !== 43)
    throw new Error("Expected 43 editorial sense rows");
  if (mapped.filter((row) => row.contentType === "usage_note").length !== 45)
    throw new Error("Expected 45 editorial usage-note rows");
  if (mapped.length !== 88) throw new Error(`Expected 88 editorial rows, got ${mapped.length}`);
  if (mapped.filter((row) => row.reviewDecision === "defer_no_suitable_sense").length !== 38)
    throw new Error("Expected 38 deferred Round 2 decisions");
  if (mapped.filter((row) => row.reviewDecision === "propose_primary").length !== 7)
    throw new Error("Expected 7 proposed Round 2 decisions");
  const linkedToNewSense = mapped.filter(
    (row) => row.contentType === "usage_note" && row.relatedSenseKey.startsWith("cadence-round2:"),
  ).length;
  if (linkedToNewSense !== 43)
    throw new Error(`Expected 43 notes linked to editorial senses, got ${linkedToNewSense}`);
  return mapped;
}

function renderImportSql({ sourceId, contentHash, decisionsHash, rows }) {
  const lexemes = [...new Map(rows.map((row) => [row.normalizedWord, row])).values()];
  const values = rows
    .map(
      (row) =>
        `  (${[
          sql(row.normalizedWord),
          sql(row.headword),
          sql(row.senseKey),
          String(row.priority),
          sql(row.translation),
          sql(row.partOfSpeech),
          sql(row.definitionEn),
          sql(row.contentType),
          sql(row.senseRole),
          sql(row.publicationStatus),
          sql(row.reviewDecision),
          sql(row.relatedSenseKey),
          sql(row.usageNoteZh),
        ].join(", ")})`,
    )
    .join(",\n");

  return `BEGIN;

INSERT INTO public.lexicon_sources
  (id, title, version, source_url, source_kind, license_id, license_url, attribution,
   access_tier, source_sha256, transformation)
VALUES
  (${sql(sourceId)}, 'Cadence Round 2 editorial supplement', ${sql(`round2-${contentHash.slice(0, 12)}`)},
   'https://github.com/hunterlinhk/vocab-rhythm/tree/main/ops/cadence-round2-editorial/source',
   'editorial', NULL, NULL,
   'Cadence project editorial content; independent of OEWN.', 'restricted', ${sql(contentHash)},
   ${sql(`Mapped from rewritten_learning_content.json (SHA-256 ${contentHash}) and round2_decisions.jsonl (SHA-256 ${decisionsHash}); original Round 2 decisions retained in review_decision; all rows imported pending review.`)})
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lexemes (language, normalized_word, lemma)
VALUES
${lexemes.map((row) => `  ('en', ${sql(row.normalizedWord)}, ${sql(row.headword)})`).join(",\n")}
ON CONFLICT (language, normalized_word) DO NOTHING;

INSERT INTO public.lexicon_entries
  (lexeme_id, source_id, source_entry_ref, sense_key, priority, translation,
   part_of_speech, definition_en, content_type, sense_role, publication_status,
   review_decision, related_sense_key, usage_note_zh)
SELECT l.id, ${sql(sourceId)}, NULL, v.sense_key, v.priority, v.translation,
       v.part_of_speech, v.definition_en, v.content_type, v.sense_role,
       v.publication_status, v.review_decision, v.related_sense_key, v.usage_note_zh
FROM (VALUES
${values}
) AS v(normalized_word, lemma, sense_key, priority, translation, part_of_speech,
       definition_en, content_type, sense_role, publication_status, review_decision,
       related_sense_key, usage_note_zh)
JOIN public.lexemes l ON l.language = 'en' AND l.normalized_word = v.normalized_word
ON CONFLICT (lexeme_id, source_id, sense_key) DO NOTHING;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.lexicon_entries WHERE source_id = ${sql(sourceId)};
  IF v_count <> 88 THEN RAISE EXCEPTION 'Expected 88 editorial rows, got %', v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.lexicon_sources WHERE id = ${sql(sourceId)} AND (source_kind <> 'editorial' OR access_tier <> 'restricted'))
    THEN RAISE EXCEPTION 'Editorial source must remain restricted'; END IF;
  IF EXISTS (SELECT 1 FROM public.lexicon_entries WHERE source_id = ${sql(sourceId)} AND publication_status <> 'pending_review')
    THEN RAISE EXCEPTION 'Editorial rows must remain pending review'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id = ${sql(sourceId)} AND content_type = 'sense') <> 43
    THEN RAISE EXCEPTION 'Expected 43 sense rows'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id = ${sql(sourceId)} AND content_type = 'usage_note') <> 45
    THEN RAISE EXCEPTION 'Expected 45 usage-note rows'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id = ${sql(sourceId)} AND content_type = 'sense' AND sense_role = 'primary') <> 40
    THEN RAISE EXCEPTION 'Expected 40 primary senses'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id = ${sql(sourceId)} AND content_type = 'sense' AND sense_role = 'supplementary') <> 3
    THEN RAISE EXCEPTION 'Expected 3 supplementary senses'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id = ${sql(sourceId)} AND review_decision = 'defer_no_suitable_sense') <> 38
    THEN RAISE EXCEPTION 'Expected 38 deferred audit decisions'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id = ${sql(sourceId)} AND review_decision = 'propose_primary') <> 7
    THEN RAISE EXCEPTION 'Expected 7 proposed audit decisions'; END IF;
  IF EXISTS (SELECT 1 FROM public.lexicon_entries WHERE source_id = ${sql(sourceId)} AND content_type = 'usage_note'
    AND (usage_note_zh IS NULL OR related_sense_key IS NULL))
    THEN RAISE EXCEPTION 'Every usage note must be non-empty and linked to a sense'; END IF;
  IF EXISTS (SELECT 1 FROM public.lexicon_entries WHERE source_id = ${sql(sourceId)} AND content_type = 'usage_note'
    AND (sense_role IS NOT NULL OR translation IS NOT NULL OR definition_en IS NOT NULL OR part_of_speech IS NOT NULL))
    THEN RAISE EXCEPTION 'Usage notes must remain separate from sense fields'; END IF;
  IF EXISTS (SELECT lexeme_id FROM public.lexicon_entries WHERE source_id = ${sql(sourceId)} AND content_type = 'usage_note' GROUP BY lexeme_id HAVING count(*) <> 1)
    THEN RAISE EXCEPTION 'Each headword must have exactly one usage note'; END IF;
  IF (SELECT count(*) FROM public.lexicon_entries n WHERE n.source_id = ${sql(sourceId)} AND n.content_type = 'usage_note'
      AND n.related_sense_key LIKE 'cadence-round2:%'
      AND EXISTS (SELECT 1 FROM public.lexicon_entries s WHERE s.source_id = n.source_id AND s.lexeme_id = n.lexeme_id AND s.content_type = 'sense' AND s.sense_key = n.related_sense_key)) <> 43
    THEN RAISE EXCEPTION 'Expected 43 usage notes linked to their editorial sense'; END IF;
END $$;

COMMIT;
`;
}

function renderRollbackSql(sourceId) {
  return `BEGIN;

UPDATE public.lexicon_sources SET access_tier = 'restricted' WHERE id = ${sql(sourceId)};
DELETE FROM public.lexicon_entries WHERE source_id = ${sql(sourceId)};
DELETE FROM public.lexicon_sources WHERE id = ${sql(sourceId)};

COMMIT;
`;
}

export function buildBundle({ contentText, decisionsText, pilotRows }) {
  const document = JSON.parse(contentText);
  const decisions = parseJsonl(decisionsText);
  const rows = mapEditorialContent(document, decisions, pilotRows);
  const contentHash = sha256(contentText);
  const decisionsHash = sha256(decisionsText);
  const combinedHash = sha256(`${contentHash}\n${decisionsHash}`);
  const sourceId = `cadence-round2-editorial-${combinedHash.slice(0, 12)}`;
  const importSql = renderImportSql({ sourceId, contentHash, decisionsHash, rows });
  const rollbackSql = renderRollbackSql(sourceId);
  const manifest = {
    source_id: sourceId,
    source_kind: "editorial",
    access_tier: "restricted",
    publication_status: "pending_review",
    input_sha256: {
      rewritten_learning_content_json: contentHash,
      round2_decisions_jsonl: decisionsHash,
    },
    counts: {
      input_entries: document.entries.length,
      input_entry_types: expectedInputCounts,
      stored_content_rows: rows.length,
      stored_senses: rows.filter((row) => row.contentType === "sense").length,
      stored_primary_senses: rows.filter((row) => row.senseRole === "primary").length,
      stored_supplementary_senses: rows.filter((row) => row.senseRole === "supplementary").length,
      stored_usage_notes: rows.filter((row) => row.contentType === "usage_note").length,
      usage_note_links: {
        linked_to_editorial_sense: rows.filter(
          (row) => row.contentType === "usage_note" && row.relatedSenseKey.startsWith("cadence-round2:"),
        ).length,
        linked_to_existing_oewn_sense: rows.filter(
          (row) => row.contentType === "usage_note" && !row.relatedSenseKey.startsWith("cadence-round2:"),
        ).length,
      },
      audit_decisions: {
        defer_no_suitable_sense: rows.filter(
          (row) => row.reviewDecision === "defer_no_suitable_sense",
        ).length,
        propose_primary: rows.filter((row) => row.reviewDecision === "propose_primary").length,
      },
    },
    output_sha256: {
      import_sql: sha256(importSql),
      rollback_sql: sha256(rollbackSql),
    },
  };
  return { sourceId, rows, importSql, rollbackSql, manifest };
}

async function main() {
  const [contentText, decisionsText, pilotText] = await Promise.all([
    readFile(contentPath, "utf8"),
    readFile(decisionsPath, "utf8"),
    readFile(pilotPath, "utf8"),
  ]);
  const bundle = buildBundle({ contentText, decisionsText, pilotRows: JSON.parse(pilotText) });
  const outputs = [
    [importPath, bundle.importSql],
    [rollbackPath, bundle.rollbackSql],
    [manifestPath, `${JSON.stringify(bundle.manifest, null, 2)}\n`],
  ];
  if (process.argv.includes("--check")) {
    const mismatches = [];
    for (const [path, expected] of outputs) {
      let actual;
      try {
        actual = await readFile(path, "utf8");
      } catch {
        mismatches.push(path);
        continue;
      }
      if (actual !== expected) mismatches.push(path);
    }
    if (mismatches.length)
      throw new Error(
        `Generated output differs: ${mismatches.map((path) => path.replace(`${root}/`, "")).join(", ")}`,
      );
  } else {
    for (const [path, content] of outputs) await writeFile(path, content, "utf8");
  }
  process.stdout.write(
    `${process.argv.includes("--check") ? "Checked" : "Wrote"} ${bundle.rows.length} rows as ${bundle.sourceId}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
