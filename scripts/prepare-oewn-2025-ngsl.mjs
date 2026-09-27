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
  const normalizedLicenseNotice = licenseNotice.replace(/\r\n?/g, "\n");
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
    normalizedLicenseNotice,
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

const STAGING_SCHEMA = "oewn_stage_2025";
const STAGING_ROWS_PER_STATEMENT = 1000;
const STAGING_STATEMENTS_PER_FILE = 2;

const chunked = (rows, size) =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, index) =>
    rows.slice(index * size, (index + 1) * size),
  );

function fullImportRows(candidates, reviewed) {
  const priorities = new Map(reviewed.map((row) => [row.source_entry_ref, row.priority]));
  return candidates.map((row) => ({
    ...row,
    priority: priorities.get(row.source_entry_ref) ?? 0,
  }));
}

function renderStageSetupSql(expected, batchCount, rowsPerBatch, licenseNotice) {
  const values = [
    SOURCE.id,
    SOURCE.version,
    SOURCE.archive_sha256,
    SOURCE.source_url,
    SOURCE.license_id,
    SOURCE.license_url,
    SOURCE.attribution,
    licenseNotice.replace(/\r\n?/g, "\n"),
    SOURCE.transformation,
    expected.lexemes,
    expected.senses,
    expected.reviewed,
    expected.unreviewed,
    batchCount,
    rowsPerBatch,
  ].map(sqlValue);
  return `-- OEWN staging setup only. This file creates objects outside public and seeds provenance metadata.
CREATE SCHEMA IF NOT EXISTS ${STAGING_SCHEMA};
REVOKE ALL ON SCHEMA ${STAGING_SCHEMA} FROM PUBLIC;

CREATE TABLE IF NOT EXISTS ${STAGING_SCHEMA}.import_meta (
  id text PRIMARY KEY CHECK (id = 'oewn-2025'),
  version text NOT NULL,
  archive_sha256 text NOT NULL,
  source_url text NOT NULL,
  license_id text NOT NULL,
  license_url text NOT NULL,
  attribution text NOT NULL,
  license_notice text NOT NULL,
  transformation text NOT NULL,
  expected_lexemes integer NOT NULL,
  expected_senses integer NOT NULL,
  expected_reviewed integer NOT NULL,
  expected_unreviewed integer NOT NULL,
  expected_batches integer NOT NULL,
  rows_per_batch integer NOT NULL
);

CREATE TABLE IF NOT EXISTS ${STAGING_SCHEMA}.senses (
  batch_no integer NOT NULL CHECK (batch_no > 0),
  normalized_word text NOT NULL,
  lemma text NOT NULL,
  source_entry_ref text NOT NULL,
  sense_key text PRIMARY KEY,
  priority integer NOT NULL CHECK (priority IN (0, 100)),
  part_of_speech text NOT NULL,
  phonetic text,
  definition_en text NOT NULL,
  sentence text,
  CHECK (source_entry_ref = sense_key)
);
CREATE INDEX IF NOT EXISTS oewn_stage_senses_word_idx
  ON ${STAGING_SCHEMA}.senses (normalized_word);
CREATE INDEX IF NOT EXISTS oewn_stage_senses_batch_idx
  ON ${STAGING_SCHEMA}.senses (batch_no);
REVOKE ALL ON ALL TABLES IN SCHEMA ${STAGING_SCHEMA} FROM PUBLIC;

INSERT INTO ${STAGING_SCHEMA}.import_meta
  (id, version, archive_sha256, source_url, license_id, license_url, attribution,
   license_notice, transformation, expected_lexemes, expected_senses, expected_reviewed,
   expected_unreviewed, expected_batches, rows_per_batch)
VALUES (${values.join(", ")})
ON CONFLICT (id) DO NOTHING;
`;
}

function renderStageBatchSql(rows, batchNo) {
  const values = rows.map((row) =>
    [
      batchNo,
      row.normalized_word,
      row.word,
      row.source_entry_ref,
      row.sense_key,
      row.priority,
      row.part_of_speech,
      row.phonetic,
      row.definition_en,
      row.sentence,
    ]
      .map((value, index) => (index === 0 || index === 5 ? String(value) : sqlValue(value)))
      .join(", "),
  );
  return `-- Staging batch ${String(batchNo).padStart(2, "0")}; changes only ${STAGING_SCHEMA}.senses.
INSERT INTO ${STAGING_SCHEMA}.senses
  (batch_no, normalized_word, lemma, source_entry_ref, sense_key, priority,
   part_of_speech, phonetic, definition_en, sentence)
VALUES
${values.map((value) => `  (${value})`).join(",\n")}
ON CONFLICT (sense_key) DO UPDATE SET
  batch_no = EXCLUDED.batch_no,
  normalized_word = EXCLUDED.normalized_word,
  lemma = EXCLUDED.lemma,
  source_entry_ref = EXCLUDED.source_entry_ref,
  priority = EXCLUDED.priority,
  part_of_speech = EXCLUDED.part_of_speech,
  phonetic = EXCLUDED.phonetic,
  definition_en = EXCLUDED.definition_en,
  sentence = EXCLUDED.sentence;
`;
}

function stageAssertionStatements(batchCount, rowsPerBatch, expected, licenseNotice, reviewed) {
  const pilotSenseKeys = reviewed
    .filter((row) => row.priority === 100)
    .map((row) => sqlValue(row.sense_key))
    .join(", ");
  return `SELECT * INTO _meta FROM ${STAGING_SCHEMA}.import_meta WHERE id = '${SOURCE.id}';
IF NOT FOUND THEN RAISE EXCEPTION 'OEWN staging metadata is missing; run 00-stage-setup.sql'; END IF;
IF (_meta.version, _meta.archive_sha256, _meta.source_url, _meta.license_id, _meta.license_url,
    _meta.attribution, _meta.license_notice, _meta.transformation, _meta.expected_lexemes,
    _meta.expected_senses, _meta.expected_reviewed, _meta.expected_unreviewed,
    _meta.expected_batches, _meta.rows_per_batch)
   IS DISTINCT FROM (${[
     SOURCE.version,
     SOURCE.archive_sha256,
     SOURCE.source_url,
     SOURCE.license_id,
     SOURCE.license_url,
     SOURCE.attribution,
     licenseNotice.replace(/\r\n?/g, "\n"),
     SOURCE.transformation,
     expected.lexemes,
     expected.senses,
     expected.reviewed,
     expected.unreviewed,
     batchCount,
     rowsPerBatch,
   ]
     .map(sqlValue)
     .join(", ")}) THEN
  RAISE EXCEPTION 'OEWN staging provenance or expected counts do not match this bundle';
END IF;
IF _meta.license_notice IS NULL OR btrim(_meta.license_notice) = '' THEN
  RAISE EXCEPTION 'OEWN staging license notice is empty';
END IF;
SELECT count(*), count(DISTINCT normalized_word), count(*) FILTER (WHERE priority = 100),
       count(*) FILTER (WHERE priority = 0), count(DISTINCT batch_no)
  INTO _sense_count, _lexeme_count, _reviewed_count, _unreviewed_count, _batch_count
  FROM ${STAGING_SCHEMA}.senses;
IF (_sense_count, _lexeme_count, _reviewed_count, _unreviewed_count, _batch_count)
   IS DISTINCT FROM (${expected.senses}, ${expected.lexemes}, ${expected.reviewed}, ${expected.unreviewed}, ${batchCount}) THEN
  RAISE EXCEPTION 'OEWN staging counts mismatch: senses %, lexemes %, reviewed %, unreviewed %, batches %',
    _sense_count, _lexeme_count, _reviewed_count, _unreviewed_count, _batch_count;
END IF;
SELECT count(*) INTO _pilot_key_count FROM ${STAGING_SCHEMA}.senses
WHERE priority = 100 AND sense_key IN (${pilotSenseKeys || "NULL"});
IF _pilot_key_count <> ${expected.reviewed} THEN
  RAISE EXCEPTION 'OEWN staging reviewed pilot sense IDs do not match the approved set';
END IF;
FOR _batch_no IN 1..${batchCount} LOOP
  _expected_batch_rows := LEAST(${rowsPerBatch}, ${expected.senses} - ((_batch_no - 1) * ${rowsPerBatch}));
  SELECT count(*) INTO _actual_batch_rows FROM ${STAGING_SCHEMA}.senses WHERE batch_no = _batch_no;
  IF _actual_batch_rows <> _expected_batch_rows THEN
    RAISE EXCEPTION 'OEWN staging batch % has % rows; expected %', _batch_no, _actual_batch_rows, _expected_batch_rows;
  END IF;
END LOOP;`;
}

function renderStageValidationSql(batchCount, rowsPerBatch, expected, licenseNotice, reviewed) {
  const assertions = stageAssertionStatements(
    batchCount,
    rowsPerBatch,
    expected,
    licenseNotice,
    reviewed,
  );
  return `-- Read-only staging validation. Raises an exception unless all counts and provenance match.
DO $oewn_validate$
DECLARE
  _meta record;
  _sense_count bigint;
  _lexeme_count bigint;
  _reviewed_count bigint;
  _unreviewed_count bigint;
  _batch_count bigint;
  _pilot_key_count bigint;
  _batch_no integer;
  _expected_batch_rows bigint;
  _actual_batch_rows bigint;
BEGIN
${assertions}
END
$oewn_validate$;

SELECT 'STAGING VALIDATED' AS result, count(*) AS senses,
       count(DISTINCT normalized_word) AS lexemes,
       count(*) FILTER (WHERE priority = 100) AS reviewed_pilot_senses,
       count(*) FILTER (WHERE priority = 0) AS unreviewed_senses,
       count(DISTINCT batch_no) AS complete_batches,
       max(m.id) AS source_id, max(m.version) AS source_version,
       max(m.source_url) AS source_url, max(m.license_id) AS license_id,
       max(m.license_url) AS license_url, max(m.attribution) AS attribution,
       max(m.archive_sha256) AS source_archive_sha256,
       bool_and(m.version = '${SOURCE.version}' AND m.source_url = '${SOURCE.source_url}'
         AND m.license_id = '${SOURCE.license_id}' AND m.license_url = '${SOURCE.license_url}'
         AND m.attribution = ${sqlValue(SOURCE.attribution)}
         AND m.archive_sha256 = '${SOURCE.archive_sha256}'
         AND m.license_notice = ${sqlValue(licenseNotice.replace(/\r\n?/g, "\n"))}
         AND m.transformation = ${sqlValue(SOURCE.transformation)}) AS provenance_match
FROM ${STAGING_SCHEMA}.senses CROSS JOIN ${STAGING_SCHEMA}.import_meta m
WHERE m.id = '${SOURCE.id}';
`;
}

function renderLovableFinalApplySql(batchCount, rowsPerBatch, expected, reviewed, licenseNotice) {
  const assertions = stageAssertionStatements(
    batchCount,
    rowsPerBatch,
    expected,
    licenseNotice,
    reviewed,
  );
  return `-- Single-statement final apply. Execute only after 11-stage-validation.sql succeeds.
-- Any raised exception aborts this DO statement and rolls back its public-table changes.
DO $oewn_apply$
DECLARE
  _meta record;
  _sense_count bigint;
  _lexeme_count bigint;
  _reviewed_count bigint;
  _unreviewed_count bigint;
  _batch_count bigint;
  _pilot_key_count bigint;
  _batch_no integer;
  _expected_batch_rows bigint;
  _actual_batch_rows bigint;
  _existing_senses bigint;
  _existing_pilots bigint;
  _pilot_match_count bigint;
  _extra_senses bigint;
  _existing_mismatches bigint;
  _source_hash text;
  _source_version text;
  _source_license text;
  _post_source_count bigint;
BEGIN
  IF to_regclass('public.lexemes') IS NULL OR to_regclass('public.lexicon_sources') IS NULL
     OR to_regclass('public.lexicon_entries') IS NULL THEN
    RAISE EXCEPTION 'Shared Lexicon tables are missing; ensure migrations 0006-0008 are applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lexicon_sources' AND column_name='source_sha256')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lexicon_sources' AND column_name='license_notice')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lexicon_sources' AND column_name='transformation') THEN
    RAISE EXCEPTION 'Lexicon provenance schema is incomplete; ensure migration 0007 is applied';
  END IF;

${assertions}

  SELECT count(*), count(*) FILTER (WHERE priority = 100)
    INTO _existing_senses, _existing_pilots
    FROM public.lexicon_entries WHERE source_id = '${SOURCE.id}';
  IF _existing_senses NOT IN (${expected.reviewed}, ${expected.senses}) OR _existing_pilots <> ${expected.reviewed} THEN
    RAISE EXCEPTION 'Existing OEWN state must be the 26-sense pilot or a completed import; got % senses and % pilots', _existing_senses, _existing_pilots;
  END IF;
  SELECT count(*) INTO _pilot_match_count
  FROM ${STAGING_SCHEMA}.senses s
  JOIN public.lexemes l ON l.language = 'en' AND l.normalized_word = s.normalized_word
  LEFT JOIN public.lexicon_entries e ON e.lexeme_id = l.id AND e.source_id = '${SOURCE.id}' AND e.sense_key = s.sense_key
  WHERE s.priority = 100 AND e.id IS NOT NULL AND e.priority = 100
    AND e.source_entry_ref IS NOT DISTINCT FROM s.source_entry_ref
    AND e.part_of_speech IS NOT DISTINCT FROM s.part_of_speech
    AND e.phonetic IS NOT DISTINCT FROM s.phonetic
    AND e.definition_en IS NOT DISTINCT FROM s.definition_en
    AND e.sentence IS NOT DISTINCT FROM s.sentence;
  IF _pilot_match_count <> ${expected.reviewed} THEN
    RAISE EXCEPTION 'Existing reviewed pilot content/identity does not exactly match staging';
  END IF;
  SELECT count(*) INTO _extra_senses FROM public.lexicon_entries e
  WHERE e.source_id = '${SOURCE.id}' AND NOT EXISTS (
    SELECT 1 FROM ${STAGING_SCHEMA}.senses s
    JOIN public.lexemes l ON l.language = 'en' AND l.normalized_word = s.normalized_word
    WHERE l.id = e.lexeme_id AND s.sense_key = e.sense_key
  );
  IF _extra_senses <> 0 THEN RAISE EXCEPTION 'Existing OEWN rows include senses outside the staged source'; END IF;
  SELECT count(*) INTO _existing_mismatches FROM public.lexicon_entries e
  JOIN public.lexemes l ON l.id = e.lexeme_id
  JOIN ${STAGING_SCHEMA}.senses s ON s.normalized_word = l.normalized_word AND s.sense_key = e.sense_key
  WHERE e.source_id = '${SOURCE.id}' AND (
    e.source_entry_ref IS DISTINCT FROM s.source_entry_ref OR e.priority IS DISTINCT FROM s.priority OR
    e.part_of_speech IS DISTINCT FROM s.part_of_speech OR e.phonetic IS DISTINCT FROM s.phonetic OR
    e.definition_en IS DISTINCT FROM s.definition_en OR e.sentence IS DISTINCT FROM s.sentence
  );
  IF _existing_mismatches <> 0 THEN RAISE EXCEPTION 'Existing OEWN rows conflict with staged source content'; END IF;
  SELECT source_sha256, version, license_id INTO _source_hash, _source_version, _source_license
    FROM public.lexicon_sources WHERE id = '${SOURCE.id}';
  IF FOUND AND ((_source_hash IS NOT NULL AND _source_hash <> '${SOURCE.archive_sha256}') OR
                (_source_version IS NOT NULL AND _source_version <> '${SOURCE.version}') OR
                (_source_license IS NOT NULL AND _source_license <> '${SOURCE.license_id}')) THEN
    RAISE EXCEPTION 'Existing OEWN source identity/provenance conflicts with staging';
  END IF;

  INSERT INTO public.lexicon_sources
    (id, title, version, source_url, license_id, license_url, attribution, license_notice, source_sha256, transformation)
  VALUES
    (_meta.id, 'Open English WordNet 2025', _meta.version, _meta.source_url, _meta.license_id,
     _meta.license_url, _meta.attribution, _meta.license_notice, _meta.archive_sha256, _meta.transformation)
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, version = EXCLUDED.version, source_url = EXCLUDED.source_url,
    license_id = EXCLUDED.license_id, license_url = EXCLUDED.license_url,
    attribution = EXCLUDED.attribution, license_notice = EXCLUDED.license_notice,
    source_sha256 = EXCLUDED.source_sha256, transformation = EXCLUDED.transformation;

  INSERT INTO public.lexemes (language, normalized_word, lemma)
  SELECT 'en', normalized_word, min(lemma)
  FROM ${STAGING_SCHEMA}.senses GROUP BY normalized_word
  ON CONFLICT (language, normalized_word) DO NOTHING;

  INSERT INTO public.lexicon_entries
    (lexeme_id, source_id, source_entry_ref, sense_key, priority, part_of_speech, phonetic, definition_en, sentence)
  SELECT l.id, _meta.id, s.source_entry_ref, s.sense_key, s.priority,
         s.part_of_speech, s.phonetic, s.definition_en, s.sentence
  FROM ${STAGING_SCHEMA}.senses s
  JOIN public.lexemes l ON l.language = 'en' AND l.normalized_word = s.normalized_word
  ON CONFLICT (lexeme_id, source_id, sense_key) DO UPDATE SET
    source_entry_ref = EXCLUDED.source_entry_ref,
    priority = GREATEST(public.lexicon_entries.priority, EXCLUDED.priority),
    part_of_speech = EXCLUDED.part_of_speech, phonetic = EXCLUDED.phonetic,
    definition_en = EXCLUDED.definition_en, sentence = EXCLUDED.sentence;

  SELECT count(*), count(DISTINCT lexeme_id), count(*) FILTER (WHERE priority = 100),
         count(*) FILTER (WHERE priority = 0)
    INTO _sense_count, _lexeme_count, _reviewed_count, _unreviewed_count
    FROM public.lexicon_entries WHERE source_id = '${SOURCE.id}';
  IF (_sense_count, _lexeme_count, _reviewed_count, _unreviewed_count)
     IS DISTINCT FROM (${expected.senses}, ${expected.lexemes}, ${expected.reviewed}, ${expected.unreviewed}) THEN
    RAISE EXCEPTION 'OEWN final count mismatch: senses %, lexemes %, priority-100 %, priority-0 %',
      _sense_count, _lexeme_count, _reviewed_count, _unreviewed_count;
  END IF;
  SELECT count(*) INTO _post_source_count FROM public.lexicon_sources
  WHERE id = _meta.id AND version = _meta.version AND source_url = _meta.source_url
    AND license_id = _meta.license_id AND license_url = _meta.license_url
    AND attribution = _meta.attribution AND license_notice = _meta.license_notice
    AND source_sha256 = _meta.archive_sha256 AND transformation = _meta.transformation;
  IF _post_source_count <> 1 THEN RAISE EXCEPTION 'OEWN source provenance post-apply check failed'; END IF;
END
$oewn_apply$;
`;
}

function renderLovableVerificationSql(expected, licenseNotice) {
  return `-- Read-only post-apply verification. All *_match fields must be true.
WITH counts AS (
  SELECT count(*) AS senses, count(DISTINCT lexeme_id) AS lexemes,
         count(*) FILTER (WHERE priority = 100) AS priority_100,
         count(*) FILTER (WHERE priority = 0) AS priority_0
  FROM public.lexicon_entries WHERE source_id = '${SOURCE.id}'
), source AS (
  SELECT count(*) AS source_rows, max(id) AS source_id, max(version) AS source_version,
         max(source_url) AS source_url, max(license_id) AS license_id,
         max(license_url) AS license_url, max(attribution) AS attribution,
         max(source_sha256) AS archive_sha256,
         bool_and(version = '${SOURCE.version}' AND source_url = '${SOURCE.source_url}'
           AND license_id = '${SOURCE.license_id}' AND license_url = '${SOURCE.license_url}'
           AND attribution = ${sqlValue(SOURCE.attribution)}
           AND source_sha256 = '${SOURCE.archive_sha256}'
           AND license_notice = ${sqlValue(licenseNotice.replace(/\r\n?/g, "\n").trim())}
           AND transformation = ${sqlValue(SOURCE.transformation)}) AS provenance_match
  FROM public.lexicon_sources WHERE id = '${SOURCE.id}'
)
SELECT c.senses, c.lexemes, c.priority_100, c.priority_0, s.source_rows,
       s.source_id, s.source_version, s.source_url, s.license_id, s.license_url,
       s.attribution, s.archive_sha256, s.provenance_match,
       (c.senses = ${expected.senses} AND c.lexemes = ${expected.lexemes}
        AND c.priority_100 = ${expected.reviewed} AND c.priority_0 = ${expected.unreviewed}) AS counts_match,
       (s.source_rows = 1 AND coalesce(s.provenance_match, false)) AS provenance_match_all,
       (c.senses = ${expected.senses} AND c.lexemes = ${expected.lexemes}
        AND c.priority_100 = ${expected.reviewed} AND c.priority_0 = ${expected.unreviewed}
        AND s.source_rows = 1 AND coalesce(s.provenance_match, false)) AS overall_match
FROM counts c CROSS JOIN source s;
`;
}

function renderLovableCleanupSql(expected, licenseNotice) {
  return `-- Guarded cleanup. Drops staging only while the verified public import and provenance still match.
DO $oewn_cleanup$
DECLARE
  _matches boolean;
BEGIN
  WITH counts AS (
    SELECT count(*) AS senses, count(DISTINCT lexeme_id) AS lexemes,
           count(*) FILTER (WHERE priority = 100) AS priority_100,
           count(*) FILTER (WHERE priority = 0) AS priority_0
    FROM public.lexicon_entries WHERE source_id = '${SOURCE.id}'
  ), source AS (
    SELECT count(*) AS source_rows,
           bool_and(version = '${SOURCE.version}' AND source_url = '${SOURCE.source_url}'
             AND license_id = '${SOURCE.license_id}' AND license_url = '${SOURCE.license_url}'
             AND attribution = ${sqlValue(SOURCE.attribution)}
             AND source_sha256 = '${SOURCE.archive_sha256}'
             AND license_notice = ${sqlValue(licenseNotice.replace(/\r\n?/g, "\n").trim())}
             AND transformation = ${sqlValue(SOURCE.transformation)}) AS provenance_match
    FROM public.lexicon_sources WHERE id = '${SOURCE.id}'
  )
  SELECT (c.senses = ${expected.senses} AND c.lexemes = ${expected.lexemes}
          AND c.priority_100 = ${expected.reviewed} AND c.priority_0 = ${expected.unreviewed}
          AND s.source_rows = 1 AND coalesce(s.provenance_match, false))
    INTO _matches
    FROM counts c CROSS JOIN source s;
  IF _matches IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'OEWN cleanup refused: post-import counts or provenance do not match';
  END IF;
  EXECUTE 'DROP SCHEMA IF EXISTS ${STAGING_SCHEMA} CASCADE';
END
$oewn_cleanup$;
`;
}

export function renderLovableCloudBundle(candidates, reviewed, licenseNotice) {
  const rows = fullImportRows(candidates, reviewed);
  const statementBatches = chunked(rows, STAGING_ROWS_PER_STATEMENT);
  const fileBatches = chunked(
    statementBatches.map((batch, index) => ({ batch, batchNo: index + 1 })),
    STAGING_STATEMENTS_PER_FILE,
  );
  const expected = {
    lexemes: new Set(rows.map((row) => row.normalized_word)).size,
    senses: rows.length,
    reviewed: reviewed.filter((row) => row.priority === 100).length,
  };
  expected.unreviewed = expected.senses - expected.reviewed;

  const batchFiles = fileBatches.map((fileBatches, fileIndex) => {
    const fileNumber = String(fileIndex + 1).padStart(2, "0");
    const name = `${fileNumber}-stage-batches.sql`;
    const sql = fileBatches
      .map(({ batch, batchNo }) => renderStageBatchSql(batch, batchNo))
      .join("\n");
    return {
      name,
      content: sql,
      batches: fileBatches.map(({ batch, batchNo }) => ({ batch_no: batchNo, rows: batch.length })),
    };
  });
  const sqlFiles = [
    {
      name: "00-stage-setup.sql",
      content: renderStageSetupSql(
        expected,
        statementBatches.length,
        STAGING_ROWS_PER_STATEMENT,
        licenseNotice,
      ),
    },
    ...batchFiles,
    {
      name: "11-stage-validation.sql",
      content: renderStageValidationSql(
        statementBatches.length,
        STAGING_ROWS_PER_STATEMENT,
        expected,
        licenseNotice,
        reviewed,
      ),
    },
    {
      name: "12-final-apply.sql",
      content: renderLovableFinalApplySql(
        statementBatches.length,
        STAGING_ROWS_PER_STATEMENT,
        expected,
        reviewed,
        licenseNotice,
      ),
    },
    { name: "13-verification.sql", content: renderLovableVerificationSql(expected, licenseNotice) },
    { name: "14-cleanup.sql", content: renderLovableCleanupSql(expected, licenseNotice) },
  ];
  const manifest = {
    format_version: 1,
    source_id: SOURCE.id,
    source_version: SOURCE.version,
    archive_sha256: SOURCE.archive_sha256,
    expected,
    staging: {
      schema: STAGING_SCHEMA,
      rows_per_statement: STAGING_ROWS_PER_STATEMENT,
      insert_statements: statementBatches.length,
      batch_files: batchFiles.length,
      statements_per_file: STAGING_STATEMENTS_PER_FILE,
    },
    files: sqlFiles.map(({ name, content, batches }) => ({
      name,
      bytes: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex"),
      ...(batches ? { batches } : {}),
    })),
  };
  return [
    ...sqlFiles.map(({ name, content }) => [name, content]),
    ["manifest.json", `${JSON.stringify(manifest, null, 2)}\n`],
  ];
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
  let lovableCloudBundle = false;
  let reviewedPath = join(root, "src/data/oewn-2025-pilot-senses.tsv");
  let reviewedSpecified = false;
  let invalidOption = false;
  for (let index = 0; index < options.length; index++) {
    if (options[index] === "--check" && !check) check = true;
    else if (options[index] === "--dry-run" && !dryRun) dryRun = true;
    else if (options[index] === "--lovable-cloud-bundle" && !lovableCloudBundle)
      lovableCloudBundle = true;
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
    (dryRun && lovableCloudBundle) ||
    (!dryRun && !outputDir) ||
    (dryRun && outputDir)
  )
    throw new Error(
      "Usage: node scripts/prepare-oewn-2025-ngsl.mjs <official-json.zip> [<output-directory> | --dry-run] [--reviewed <tsv>] [--lovable-cloud-bundle] [--check]",
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
  const licenseNotice = readFileSync(join(root, "src/data/OEWN-WNDB-LICENSE.txt"), "utf8")
    .replace(/\r\n?/g, "\n")
    .trim();
  const reviewedSql = renderReviewedSql(reviewed, licenseNotice);
  const lovableSqlBundle = renderLovableCloudBundle(audit.candidates, reviewed, licenseNotice);
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
  ];
  const outputs = lovableCloudBundle ? lovableSqlBundle : auditOutputs;
  if (!check) mkdirSync(outputDir, { recursive: true });
  for (const [name, content] of outputs) {
    const path = join(outputDir, name);
    if (check) {
      if (readFileSync(path, "utf8") !== content)
        throw new Error(`Generated file is out of date: ${path}`);
    } else writeFileSync(path, content);
  }
  console.log(
    lovableCloudBundle
      ? `${check ? "Verified" : "Prepared"} Lovable Cloud bundle: ${lovableSqlBundle.length - 1} SQL files, ${importPlan.lexemes} lexemes, ${importPlan.senses} senses.`
      : `${check ? "Verified" : "Prepared"} ${importPlan.lexemes} lexemes and ${importPlan.senses} senses for audit; ${importPlan.reviewed_primary_senses} reviewed primary senses.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
