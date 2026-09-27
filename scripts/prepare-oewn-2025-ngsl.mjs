import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ARCHIVE_SHA256 = "7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51";
const SOURCE_ID = "oewn-2025";
const SOURCE = {
  id: SOURCE_ID,
  title: "Open English WordNet 2025",
  version: "2025-12-31",
  source_url: "https://en-word.net/downloads/english-wordnet-2025-json.zip",
  license_id: "CC-BY-4.0",
  license_url: "https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md",
  attribution:
    "Open English Wordnet 2025 © The Open English WordNet Team, CC BY 4.0; derived from Princeton WordNet 3.1 © 2011 Princeton University under the WordNet License. Selected and transformed NGSL senses; no endorsement is implied.",
  archive_sha256: ARCHIVE_SHA256,
  transformation:
    "Exact-spelling NGSL headwords and explicitly reviewed sense IDs; first source definition and synset example; US IPA preferred over GB. No inferred content, translations, or automatic default sense.",
};
const POS_NAMES = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };

export function parseNgsl(csv) {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (header !== "Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)" || lines.length !== 2809)
    throw new Error("Unexpected NGSL 1.2 source format or entry count");
  return lines.map((line, index) => {
    const [word, rank] = line.split(",");
    if (!word || Number(rank) !== index + 1) throw new Error(`Invalid NGSL row: ${line}`);
    return word;
  });
}

/** Read the verified archive itself so stale extracted files cannot affect the audit. */
export function loadOewn(archivePath) {
  const entries = new Map();
  const folded = new Map();
  const synsets = new Map();
  const files = execFileSync("tar", ["-tf", archivePath], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter((name) => name.endsWith(".json"));
  if (!files.includes("entries-a.json") || !files.includes("noun.Tops.json"))
    throw new Error("Unexpected OEWN JSON archive layout");
  for (const file of files) {
    if (file === "frames.json") continue;
    const data = JSON.parse(
      execFileSync("tar", ["-xOf", archivePath, file], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
    if (file.startsWith("entries-")) {
      for (const [word, row] of Object.entries(data)) {
        if (entries.has(word)) throw new Error(`Duplicate OEWN headword: ${word}`);
        entries.set(word, row);
        const key = word.toLowerCase();
        folded.set(key, [...(folded.get(key) ?? []), word]);
      }
    } else {
      for (const [id, row] of Object.entries(data)) {
        if (synsets.has(id)) throw new Error(`Duplicate OEWN synset: ${id}`);
        synsets.set(id, row);
      }
    }
  }
  return { entries, folded, synsets };
}

function firstText(values) {
  return values?.find((value) => typeof value === "string" && value.trim()) ?? null;
}

export function analyzeNgsl(words, { entries, folded, synsets }) {
  const candidates = [];
  const candidateByWord = new Map();
  const lemmas = words.map((word, index) => {
    const alternatives = folded.get(word.toLowerCase()) ?? [];
    const exact = entries.get(word);
    const matches = exact ? [word] : alternatives;
    const status = exact ? "exact" : matches.length ? "case_only" : "unmatched";
    const alternateSenses =
      status === "case_only"
        ? matches.flatMap((headword) =>
            Object.entries(entries.get(headword)).flatMap(([sourcePos, data]) =>
              (data.sense ?? []).map((sense) => ({ sourcePos, senseId: sense.id })),
            ),
          )
        : [];
    const alternatePosCounts = Object.fromEntries(
      [...new Set(alternateSenses.map(({ sourcePos }) => POS_NAMES[sourcePos.split("-")[0]]))]
        .sort()
        .map((name) => [
          name,
          alternateSenses.filter(({ sourcePos }) => POS_NAMES[sourcePos.split("-")[0]] === name)
            .length,
        ]),
    );
    const senses = [];
    const sourcePosVariants = [];
    if (exact) {
      for (const [sourcePos, data] of Object.entries(exact)) {
        // OEWN separates some homographs as n-1/n-2 or v-1/v-2.
        const pos = sourcePos.split("-")[0];
        if (!POS_NAMES[pos]) throw new Error(`Unknown OEWN POS: ${word} / ${sourcePos}`);
        if (sourcePos.includes("-")) sourcePosVariants.push(sourcePos);
        const pronunciations = data.pronunciation ?? [];
        const pronunciation =
          pronunciations.find((item) => item.variety === "US") ??
          pronunciations.find((item) => item.variety === "GB") ??
          pronunciations[0];
        for (const sense of data.sense ?? []) {
          const synset = synsets.get(sense.synset);
          if (!synset) throw new Error(`Missing OEWN synset: ${word} / ${sense.id}`);
          if (!sense.id) throw new Error(`Missing OEWN sense ID: ${word}`);
          const row = {
            word,
            normalized_word: word.trim().toLowerCase(),
            source_id: SOURCE_ID,
            source_entry_ref: sense.id,
            sense_key: sense.id,
            source_pos: sourcePos,
            part_of_speech: POS_NAMES[pos],
            phonetic: pronunciation?.value ? `/${pronunciation.value}/` : null,
            definition_en: firstText(synset.definition),
            sentence: firstText(synset.example),
          };
          senses.push(row);
          candidates.push(row);
        }
      }
    }
    candidateByWord.set(word, senses);
    const pos = [...new Set(senses.map((sense) => sense.part_of_speech))].sort();
    const posCounts = Object.fromEntries(
      pos.map((name) => [name, senses.filter((sense) => sense.part_of_speech === name).length]),
    );
    const ambiguity = [
      ...(senses.length > 1 ? ["multiple_senses"] : []),
      ...(pos.length > 1 ? ["multiple_pos"] : []),
      ...(sourcePosVariants.length ? ["split_homograph"] : []),
      ...(status === "case_only" ? ["case_only"] : []),
    ];
    return {
      word,
      rank: index + 1,
      status: status === "exact" && !senses.length ? "no_senses" : status,
      alternate_headwords: status === "case_only" ? matches : [],
      alternate_sense_count: alternateSenses.length,
      alternate_pos_counts: alternatePosCounts,
      alternate_sense_ids: alternateSenses.map(({ senseId }) => senseId),
      sense_count: senses.length,
      pos,
      pos_counts: posCounts,
      source_pos_variants: sourcePosVariants,
      ambiguity,
      sense_ids: senses.map((sense) => sense.source_entry_ref),
    };
  });
  if (new Set(candidates.map((row) => row.source_entry_ref)).size !== candidates.length)
    throw new Error("Duplicate OEWN sense ID among NGSL candidates");
  const count = (predicate, rows) => rows.filter(predicate).length;
  const summary = {
    ngsl_headwords: words.length,
    exact_lemma_matches: count((row) => row.status === "exact", lemmas),
    case_only_headwords: count((row) => row.status === "case_only", lemmas),
    case_only_sense_candidates: lemmas.reduce((total, row) => total + row.alternate_sense_count, 0),
    no_oewn_headword: count((row) => row.status === "unmatched", lemmas),
    exact_headwords_without_senses: count((row) => row.status === "no_senses", lemmas),
    candidate_lexemes: count((row) => row.status === "exact", lemmas),
    candidate_senses: candidates.length,
    single_sense_lemmas: count((row) => row.status === "exact" && row.sense_count === 1, lemmas),
    multiple_sense_lemmas: count((row) => row.ambiguity.includes("multiple_senses"), lemmas),
    multiple_pos_lemmas: count((row) => row.ambiguity.includes("multiple_pos"), lemmas),
    split_homograph_lemmas: count((row) => row.ambiguity.includes("split_homograph"), lemmas),
    candidate_senses_with_ipa: count((row) => !!row.phonetic, candidates),
    candidate_senses_with_definition: count((row) => !!row.definition_en, candidates),
    candidate_senses_with_example: count((row) => !!row.sentence, candidates),
    matched_lemmas_with_ipa: count(
      (lemma) =>
        lemma.status === "exact" && candidateByWord.get(lemma.word).some((row) => row.phonetic),
      lemmas,
    ),
    matched_lemmas_with_definition: count(
      (lemma) =>
        lemma.status === "exact" &&
        candidateByWord.get(lemma.word).some((row) => row.definition_en),
      lemmas,
    ),
    matched_lemmas_with_example: count(
      (lemma) =>
        lemma.status === "exact" && candidateByWord.get(lemma.word).some((row) => row.sentence),
      lemmas,
    ),
  };
  return { summary, lemmas, candidates };
}

export function selectReviewed(candidates, tsv) {
  const byWord = new Map();
  for (const candidate of candidates) {
    const values = byWord.get(candidate.word) ?? [];
    values.push(candidate);
    byWord.set(candidate.word, values);
  }
  const reviewed = [];
  const seen = new Set();
  const primaryCount = new Map();
  for (const line of tsv.split(/\r?\n/).filter((value) => value && !value.startsWith("#"))) {
    const [word, senseId, priorityText, extra] = line.split("\t");
    const priority = priorityText === undefined ? 100 : Number(priorityText);
    if (
      !word ||
      !senseId ||
      extra !== undefined ||
      seen.has(senseId) ||
      !Number.isInteger(priority) ||
      priority < 0 ||
      priority > 100
    )
      throw new Error(`Invalid or duplicate reviewed sense: ${line}`);
    seen.add(senseId);
    const candidate = byWord.get(word)?.find((row) => row.source_entry_ref === senseId);
    if (!candidate || !candidate.definition_en)
      throw new Error(`Reviewed sense is absent or lacks a definition: ${word} / ${senseId}`);
    if (priority === 100) primaryCount.set(word, (primaryCount.get(word) ?? 0) + 1);
    reviewed.push({ ...candidate, priority });
  }
  for (const word of new Set(reviewed.map((row) => row.word))) {
    if (primaryCount.get(word) !== 1)
      throw new Error(`Exactly one reviewed primary sense is required: ${word}`);
  }
  return reviewed;
}

const sqlValue = (value) => (value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`);
const SQL_BATCH = 400;
const batches = (rows) =>
  Array.from({ length: Math.ceil(rows.length / SQL_BATCH) }, (_, index) =>
    rows.slice(index * SQL_BATCH, (index + 1) * SQL_BATCH),
  );

function renderImportSql(rows, licenseNotice, label) {
  if (!rows.length) throw new Error("No OEWN senses to import");
  if (new Set(rows.map((row) => `${row.normalized_word}\0${row.sense_key}`)).size !== rows.length)
    throw new Error("Duplicate OEWN sense in import batch");
  const sourceValues = [
    SOURCE.id,
    SOURCE.title,
    SOURCE.version,
    SOURCE.source_url,
    SOURCE.license_id,
    SOURCE.license_url,
    SOURCE.attribution,
    licenseNotice,
    SOURCE.archive_sha256,
    SOURCE.transformation,
  ].map(sqlValue);
  const lexemes = [...new Map(rows.map((row) => [row.normalized_word, row.word])).entries()];
  const lexemeSql = batches(lexemes)
    .map(
      (batch) => `INSERT INTO public.lexemes (language, normalized_word, lemma)
VALUES
${batch.map(([normalized, word]) => `  ('en', ${sqlValue(normalized)}, ${sqlValue(word)})`).join(",\n")}
ON CONFLICT (language, normalized_word) DO NOTHING;`,
    )
    .join("\n\n");
  const entrySql = batches(rows)
    .map((batch) => {
      const values = batch.map(
        (row) =>
          `  (${[
            row.normalized_word,
            row.source_entry_ref,
            row.sense_key,
            row.priority,
            row.part_of_speech,
            row.phonetic,
            row.definition_en,
            row.sentence,
          ]
            .map((value, index) => (index === 3 ? String(value) : sqlValue(value)))
            .join(", ")})`,
      );
      return `INSERT INTO public.lexicon_entries
  (lexeme_id, source_id, source_entry_ref, sense_key, priority, part_of_speech, phonetic, definition_en, sentence)
SELECT l.id, ${sqlValue(SOURCE_ID)}, v.source_entry_ref, v.sense_key, v.priority,
       v.part_of_speech, v.phonetic, v.definition_en, v.sentence
FROM (VALUES
${values.join(",\n")}
) AS v(normalized_word, source_entry_ref, sense_key, priority, part_of_speech, phonetic, definition_en, sentence)
JOIN public.lexemes AS l ON l.language = 'en' AND l.normalized_word = v.normalized_word
ON CONFLICT (lexeme_id, source_id, sense_key) DO UPDATE SET
  source_entry_ref = EXCLUDED.source_entry_ref,
  priority = GREATEST(public.lexicon_entries.priority, EXCLUDED.priority),
  part_of_speech = EXCLUDED.part_of_speech, phonetic = EXCLUDED.phonetic,
  definition_en = EXCLUDED.definition_en, sentence = EXCLUDED.sentence;`;
    })
    .join("\n\n");
  return `-- Staged OEWN 2025 NGSL ${label} import. Inspect before applying to any database.
-- Requires migrations 0006-0008. No user learning records or book entries are changed.
-- OEWN senses without an explicit reviewed primary have priority 0 and are not used by WordEntry hydration.
BEGIN;
INSERT INTO public.lexicon_sources
  (id, title, version, source_url, license_id, license_url, attribution, license_notice, source_sha256, transformation)
VALUES (${sourceValues.join(", ")})
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, version = EXCLUDED.version, source_url = EXCLUDED.source_url,
  license_id = EXCLUDED.license_id, license_url = EXCLUDED.license_url,
  attribution = EXCLUDED.attribution, license_notice = EXCLUDED.license_notice,
  source_sha256 = EXCLUDED.source_sha256, transformation = EXCLUDED.transformation;

${lexemeSql}

${entrySql}
COMMIT;
`;
}

export function renderReviewedSql(reviewed, licenseNotice) {
  return renderImportSql(reviewed, licenseNotice, "reviewed");
}

export function renderFullSql(candidates, reviewed, licenseNotice) {
  const priorities = new Map(reviewed.map((row) => [row.source_entry_ref, row.priority]));
  const rows = candidates.map((row) => ({
    ...row,
    priority: priorities.get(row.source_entry_ref) ?? 0,
  }));
  return renderImportSql(rows, licenseNotice, "all exact-headword senses");
}

const pilotAttribution =
  "Open English Wordnet 2025 © The Open English WordNet Team, CC BY 4.0; derived from Princeton WordNet 3.1 © 2011 Princeton University under the WordNet License. This is a selected and transformed NGSL pilot subset; no endorsement is implied.";
const pilotTransformation =
  "Selected NGSL headwords and reviewed OEWN sense IDs from oewn-2025-pilot-senses.tsv; retained the first English definition and example, with US IPA preferred over GB; omitted unlicensed translations.";

export function renderProductionImportSql(candidates, reviewed, licenseNotice) {
  const importSql = renderFullSql(candidates, reviewed, licenseNotice);
  const begin = importSql.indexOf("\nBEGIN;\n");
  const commit = importSql.lastIndexOf("\nCOMMIT;");
  if (begin < 0 || commit < begin) throw new Error("Could not isolate the import transaction");
  const insertStatements = importSql.slice(begin + "\nBEGIN;\n".length, commit);
  const expectedLexemes = new Set(candidates.map((row) => row.normalized_word)).size;
  const expectedSenses = candidates.length;
  const pilotSenseKeys = reviewed.filter((row) => row.priority === 100).map((row) => row.sense_key);
  const expectedReviewed = pilotSenseKeys.length;
  const expectedUnreviewed = expectedSenses - expectedReviewed;
  const pilotSenseList = pilotSenseKeys.map(sqlValue).join(", ");
  if (!expectedReviewed) throw new Error("Production import requires reviewed pilot senses");
  return `-- Production OEWN 2025 NGSL data import. Run with psql -v ON_ERROR_STOP=1 -f.
-- Requires the existing 0006-0008 schema. One transaction; errors roll back all changes.
-- Do not use psql --single-transaction. No schema migrations or user learning tables are changed.
BEGIN;
SET LOCAL statement_timeout = '10min';
SET LOCAL lock_timeout = '10s';
DROP TABLE IF EXISTS pg_temp.oewn_import_baseline;
CREATE TEMP TABLE oewn_import_baseline ON COMMIT PRESERVE ROWS AS
SELECT
  (SELECT count(*) FROM public.lexemes) AS lexemes_total,
  (SELECT count(*) FROM public.lexicon_entries) AS senses_total,
  (SELECT count(*) FROM public.lexicon_sources) AS sources_total,
  (SELECT count(*) FROM public.lexicon_entries WHERE source_id = 'oewn-2025') AS oewn_senses,
  (SELECT count(DISTINCT lexeme_id) FROM public.lexicon_entries WHERE source_id = 'oewn-2025') AS oewn_lexemes;

DO $$
DECLARE
  _pilot_count bigint;
  _existing_senses bigint;
  _source_hash text;
  _source_license text;
  _source_version text;
  _pilot_key_count bigint;
BEGIN
  IF to_regclass('public.lexemes') IS NULL OR to_regclass('public.lexicon_entries') IS NULL OR to_regclass('public.lexicon_sources') IS NULL THEN
    RAISE EXCEPTION 'Shared Lexicon schema is missing; apply migrations 0006-0008 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lexicon_sources' AND column_name='source_sha256')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lexicon_sources' AND column_name='license_notice')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lexicon_sources' AND column_name='transformation') THEN
    RAISE EXCEPTION 'Lexicon provenance columns are missing; apply migration 0007 first';
  END IF;
  SELECT count(*) INTO _existing_senses FROM public.lexicon_entries WHERE source_id='oewn-2025';
  IF _existing_senses > ${expectedSenses} THEN
    RAISE EXCEPTION 'Found % OEWN senses, more than this bundle expects (${expectedSenses})', _existing_senses;
  END IF;
  SELECT count(*) INTO _pilot_count FROM public.lexicon_entries WHERE source_id='oewn-2025' AND priority=100;
  IF _pilot_count <> ${expectedReviewed} THEN
    RAISE EXCEPTION 'Expected ${expectedReviewed} reviewed pilot senses at priority 100, found %', _pilot_count;
  END IF;
  SELECT count(*) INTO _pilot_key_count FROM public.lexicon_entries
    WHERE source_id='oewn-2025' AND priority=100 AND sense_key IN (${pilotSenseList});
  IF _pilot_key_count <> ${expectedReviewed} THEN
    RAISE EXCEPTION 'Existing reviewed pilot sense IDs do not match this import';
  END IF;
  SELECT source_sha256, license_id, version INTO _source_hash, _source_license, _source_version
    FROM public.lexicon_sources WHERE id='oewn-2025';
  IF FOUND AND ((_source_hash IS NOT NULL AND _source_hash <> '${ARCHIVE_SHA256}') OR (_source_license IS NOT NULL AND _source_license <> 'CC-BY-4.0') OR (_source_version IS NOT NULL AND _source_version <> '2025-12-31')) THEN
    RAISE EXCEPTION 'Existing OEWN source provenance does not match this archive/license';
  END IF;
END $$;

${insertStatements}

DO $$
DECLARE
  _sense_count bigint;
  _lexeme_count bigint;
  _reviewed_count bigint;
  _pilot_key_count bigint;
  _unreviewed_count bigint;
  _provenance_count bigint;
BEGIN
  SELECT count(*), count(DISTINCT lexeme_id), count(*) FILTER (WHERE priority=100), count(*) FILTER (WHERE priority=0)
    INTO _sense_count, _lexeme_count, _reviewed_count, _unreviewed_count
    FROM public.lexicon_entries WHERE source_id='oewn-2025';
  IF (_sense_count, _lexeme_count, _reviewed_count, _unreviewed_count) IS DISTINCT FROM (${expectedSenses}, ${expectedLexemes}, ${expectedReviewed}, ${expectedUnreviewed}) THEN
    RAISE EXCEPTION 'OEWN postflight count mismatch: senses %, lexemes %, reviewed %, unreviewed %', _sense_count, _lexeme_count, _reviewed_count, _unreviewed_count;
  END IF;
  SELECT count(*) INTO _pilot_key_count FROM public.lexicon_entries
    WHERE source_id='oewn-2025' AND priority=100 AND sense_key IN (${pilotSenseList});
  IF _pilot_key_count <> ${expectedReviewed} THEN RAISE EXCEPTION 'Reviewed pilot sense postflight check failed'; END IF;
  SELECT count(*) INTO _provenance_count FROM public.lexicon_sources
    WHERE id='oewn-2025' AND version='2025-12-31' AND license_id='CC-BY-4.0' AND source_sha256='${ARCHIVE_SHA256}'
      AND source_url='${SOURCE.source_url}' AND license_url='${SOURCE.license_url}' AND length(license_notice)>0;
  IF _provenance_count <> 1 THEN RAISE EXCEPTION 'OEWN source provenance postflight check failed'; END IF;
END $$;

COMMIT;

SELECT b.lexemes_total AS lexemes_before, (SELECT count(*) FROM public.lexemes) AS lexemes_after,
       (SELECT count(*) FROM public.lexicon_entries) AS all_senses_after,
       b.oewn_lexemes AS oewn_lexemes_before,
       (SELECT count(DISTINCT lexeme_id) FROM public.lexicon_entries WHERE source_id='oewn-2025') AS oewn_lexemes_after,
       b.oewn_senses AS oewn_senses_before,
       (SELECT count(*) FROM public.lexicon_entries WHERE source_id='oewn-2025') AS oewn_senses_after,
       b.sources_total AS sources_before, (SELECT count(*) FROM public.lexicon_sources) AS sources_after,
       (SELECT count(*) FROM public.lexicon_sources WHERE id='oewn-2025' AND source_sha256='${ARCHIVE_SHA256}' AND version='2025-12-31') AS verified_oewn_provenance_rows
FROM oewn_import_baseline AS b;
`;
}

export function renderProductionRollbackSql(
  expectedSenses,
  expectedReviewed,
  expectedLexemes,
  pilotSenseKeys,
) {
  const expectedUnreviewed = expectedSenses - expectedReviewed;
  if (pilotSenseKeys.length !== expectedReviewed)
    throw new Error("Rollback requires the complete reviewed pilot sense ID list");
  const pilotSenseList = pilotSenseKeys.map(sqlValue).join(", ");
  return `-- Roll back the full OEWN 2025 NGSL import before exposing its unreviewed senses.
-- Requires the exact imported archive and counts. Keeps all 26 reviewed pilot senses and shared lexemes.
BEGIN;
DO $$
DECLARE _senses bigint; _pilots bigint; _unreviewed bigint; _lexemes bigint;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE priority=100), count(*) FILTER (WHERE priority=0), count(DISTINCT lexeme_id)
    INTO _senses, _pilots, _unreviewed, _lexemes
    FROM public.lexicon_entries WHERE source_id='oewn-2025';
  IF (_senses, _pilots, _unreviewed, _lexemes) IS DISTINCT FROM (${expectedSenses}, ${expectedReviewed}, ${expectedUnreviewed}, ${expectedLexemes}) THEN
    RAISE EXCEPTION 'Rollback stopped: OEWN rows no longer match the prepared import (senses %, pilots %, unreviewed %, lexemes %)', _senses, _pilots, _unreviewed, _lexemes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lexicon_sources WHERE id='oewn-2025' AND version='2025-12-31' AND source_sha256='${ARCHIVE_SHA256}') THEN
    RAISE EXCEPTION 'Rollback stopped: OEWN source provenance changed';
  END IF;
  IF (SELECT count(*) FROM public.lexicon_entries WHERE source_id='oewn-2025' AND priority=100 AND sense_key IN (${pilotSenseList})) <> ${expectedReviewed} THEN
    RAISE EXCEPTION 'Rollback stopped: reviewed pilot sense IDs changed';
  END IF;
END $$;

DELETE FROM public.lexicon_entries WHERE source_id='oewn-2025' AND priority=0;
UPDATE public.lexicon_sources SET
  attribution=${sqlValue(pilotAttribution)},
  transformation=${sqlValue(pilotTransformation)}
WHERE id='oewn-2025' AND version='2025-12-31' AND source_sha256='${ARCHIVE_SHA256}';
COMMIT;
`;
}

export function assertPilotPreserved(candidates, reviewed, pilot) {
  const bySense = new Map(candidates.map((row) => [row.source_entry_ref, row]));
  const reviewedPriority = new Map(reviewed.map((row) => [row.source_entry_ref, row.priority]));
  for (const old of pilot) {
    const current = bySense.get(old.source_entry_ref);
    if (
      !current ||
      reviewedPriority.get(old.source_entry_ref) !== 100 ||
      ["word", "normalized_word", "part_of_speech", "phonetic", "definition_en", "sentence"].some(
        (field) => current[field] !== old[field],
      )
    )
      throw new Error(`Existing pilot sense changed or lost review: ${old.source_entry_ref}`);
  }
}

function main() {
  const [archivePath, ...options] = process.argv.slice(2);
  let outputDir;
  let check = false;
  let dryRun = false;
  let productionBundle = false;
  let reviewedPath = join(root, "src/data/oewn-2025-pilot-senses.tsv");
  let reviewedSpecified = false;
  let invalidOption = false;
  for (let index = 0; index < options.length; index++) {
    if (options[index] === "--check" && !check) check = true;
    else if (options[index] === "--dry-run" && !dryRun) dryRun = true;
    else if (options[index] === "--production-bundle" && !productionBundle) productionBundle = true;
    else if (
      options[index] === "--reviewed" &&
      !reviewedSpecified &&
      options[index + 1] &&
      !options[index + 1].startsWith("--")
    ) {
      reviewedPath = options[++index];
      reviewedSpecified = true;
    } else if (!options[index].startsWith("--") && !outputDir) outputDir = options[index];
    else invalidOption = true;
  }
  if (
    !archivePath ||
    invalidOption ||
    (check && dryRun) ||
    (dryRun && productionBundle) ||
    (!dryRun && !outputDir) ||
    (dryRun && outputDir)
  )
    throw new Error(
      "Usage: node scripts/prepare-oewn-2025-ngsl.mjs <official-json.zip> [<output-directory> | --dry-run] [--reviewed <tsv>] [--production-bundle] [--check]",
    );
  const actualSha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (actualSha256 !== ARCHIVE_SHA256)
    throw new Error(`Unexpected OEWN archive SHA-256: ${actualSha256}`);
  const words = parseNgsl(readFileSync(join(root, "src/data/ngsl-1.2-stats.csv"), "utf8"));
  const audit = analyzeNgsl(words, loadOewn(archivePath));
  const reviewed = selectReviewed(audit.candidates, readFileSync(reviewedPath, "utf8"));
  const pilot = JSON.parse(readFileSync(join(root, "src/data/oewn-2025-pilot.json"), "utf8"));
  assertPilotPreserved(audit.candidates, reviewed, pilot);
  const source = {
    ...SOURCE,
    reviewed_senses: reviewed.length,
    reviewed_lexemes: new Set(reviewed.map((row) => row.normalized_word)).size,
    review_policy:
      "All exact-headword senses may be imported; only explicit reviewed primary senses hydrate WordEntry learning fields. Case-only and unmatched words are excluded.",
  };
  const importPlan = {
    lexemes: audit.summary.candidate_lexemes,
    senses: audit.summary.candidate_senses,
    reviewed_primary_senses: reviewed.filter((row) => row.priority === 100).length,
    unreviewed_senses: audit.summary.candidate_senses - reviewed.length,
    case_only_headwords_excluded: audit.summary.case_only_headwords,
    unmatched_headwords_excluded: audit.summary.no_oewn_headword,
  };
  const licenseNotice = readFileSync(join(root, "src/data/OEWN-WNDB-LICENSE.txt"), "utf8").trim();
  const reviewedSql = renderReviewedSql(reviewed, licenseNotice);
  const fullSql = renderFullSql(audit.candidates, reviewed, licenseNotice);
  const productionImportSql = renderProductionImportSql(audit.candidates, reviewed, licenseNotice);
  const productionRollbackSql = renderProductionRollbackSql(
    audit.summary.candidate_senses,
    reviewed.filter((row) => row.priority === 100).length,
    audit.summary.candidate_lexemes,
    reviewed.filter((row) => row.priority === 100).map((row) => row.sense_key),
  );
  const productionManifest = {
    source_id: SOURCE_ID,
    version: SOURCE.version,
    archive_sha256: ARCHIVE_SHA256,
    expected: {
      exact_ngsl_lexemes: audit.summary.candidate_lexemes,
      senses: audit.summary.candidate_senses,
      reviewed_pilot_senses: reviewed.filter((row) => row.priority === 100).length,
      unreviewed_senses: audit.summary.candidate_senses - reviewed.length,
    },
    files: {
      import: {
        name: "production-import.sql",
        sha256: createHash("sha256").update(productionImportSql).digest("hex"),
        bytes: Buffer.byteLength(productionImportSql),
      },
      rollback: {
        name: "production-rollback.sql",
        sha256: createHash("sha256").update(productionRollbackSql).digest("hex"),
        bytes: Buffer.byteLength(productionRollbackSql),
      },
    },
  };
  importPlan.sql_sha256 = createHash("sha256").update(fullSql).digest("hex");
  importPlan.sql_bytes = Buffer.byteLength(fullSql);
  const summary = { source, ...audit.summary, import_plan: importPlan };
  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const auditOutputs = [
    ["summary.json", `${JSON.stringify(summary, null, 2)}\n`],
    ["lemmas.json", `${JSON.stringify(audit.lemmas, null, 2)}\n`],
    ["candidate-senses.json", `${JSON.stringify(audit.candidates, null, 2)}\n`],
    ["reviewed-import.sql", reviewedSql],
    ["full-import.sql", fullSql],
    ["production-import.sql", productionImportSql],
    ["production-rollback.sql", productionRollbackSql],
    ["production-manifest.json", `${JSON.stringify(productionManifest, null, 2)}\n`],
  ];
  const outputs = productionBundle
    ? auditOutputs.filter(([name]) => name.startsWith("production-"))
    : auditOutputs;
  if (!check) mkdirSync(outputDir, { recursive: true });
  for (const [name, content] of outputs) {
    const path = join(outputDir, name);
    if (check) {
      if (readFileSync(path, "utf8") !== content)
        throw new Error(`Generated file is out of date: ${path}`);
    } else writeFileSync(path, content);
  }
  console.log(
    `${check ? "Verified" : "Prepared"} ${importPlan.lexemes} lexemes and ${importPlan.senses} senses for staged import; ${importPlan.reviewed_primary_senses} reviewed primary senses.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
