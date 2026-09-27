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
    "Open English Wordnet 2025 © The Open English WordNet Team, CC BY 4.0; derived from Princeton WordNet 3.1 © 2011 Princeton University under the WordNet License. Selected and transformed reviewed NGSL senses; no endorsement is implied.",
  archive_sha256: ARCHIVE_SHA256,
  transformation:
    "Reviewed NGSL headwords and OEWN sense IDs; first source definition and synset example; US IPA preferred over GB. No inferred content or translations.",
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

export function renderReviewedSql(reviewed, licenseNotice) {
  if (!reviewed.length) throw new Error("No reviewed senses to import");
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
  const lexemes = [...new Map(reviewed.map((row) => [row.normalized_word, row.word])).entries()];
  const entryValues = reviewed.map(
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
  return `-- Staged OEWN 2025 NGSL import. Apply only after reviewing selections and database state.
-- Requires migrations 0006-0008. No user learning records or book entries are changed.
BEGIN;
INSERT INTO public.lexicon_sources
  (id, title, version, source_url, license_id, license_url, attribution, license_notice, source_sha256, transformation)
VALUES (${sourceValues.join(", ")})
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, version = EXCLUDED.version, source_url = EXCLUDED.source_url,
  license_id = EXCLUDED.license_id, license_url = EXCLUDED.license_url,
  attribution = EXCLUDED.attribution, license_notice = EXCLUDED.license_notice,
  source_sha256 = EXCLUDED.source_sha256, transformation = EXCLUDED.transformation;

INSERT INTO public.lexemes (language, normalized_word, lemma)
VALUES
${lexemes.map(([normalized, word]) => `  ('en', ${sqlValue(normalized)}, ${sqlValue(word)})`).join(",\n")}
ON CONFLICT (language, normalized_word) DO NOTHING;

INSERT INTO public.lexicon_entries
  (lexeme_id, source_id, source_entry_ref, sense_key, priority, part_of_speech, phonetic, definition_en, sentence)
SELECT l.id, ${sqlValue(SOURCE_ID)}, v.source_entry_ref, v.sense_key, v.priority,
       v.part_of_speech, v.phonetic, v.definition_en, v.sentence
FROM (VALUES
${entryValues.join(",\n")}
) AS v(normalized_word, source_entry_ref, sense_key, priority, part_of_speech, phonetic, definition_en, sentence)
JOIN public.lexemes AS l ON l.language = 'en' AND l.normalized_word = v.normalized_word
ON CONFLICT (lexeme_id, source_id, sense_key) DO UPDATE SET
  source_entry_ref = EXCLUDED.source_entry_ref, priority = EXCLUDED.priority,
  part_of_speech = EXCLUDED.part_of_speech, phonetic = EXCLUDED.phonetic,
  definition_en = EXCLUDED.definition_en, sentence = EXCLUDED.sentence;
COMMIT;
`;
}

function main() {
  const [archivePath, outputDir, ...options] = process.argv.slice(2);
  let check = false;
  let reviewedPath = join(root, "src/data/oewn-2025-pilot-senses.tsv");
  let reviewedSpecified = false;
  let invalidOption = false;
  for (let index = 0; index < options.length; index++) {
    if (options[index] === "--check" && !check) check = true;
    else if (
      options[index] === "--reviewed" &&
      !reviewedSpecified &&
      options[index + 1] &&
      !options[index + 1].startsWith("--")
    ) {
      reviewedPath = options[++index];
      reviewedSpecified = true;
    } else invalidOption = true;
  }
  if (!archivePath || !outputDir || invalidOption)
    throw new Error(
      "Usage: node scripts/prepare-oewn-2025-ngsl.mjs <official-json.zip> <output-directory> [--reviewed <tsv>] [--check]",
    );
  const actualSha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (actualSha256 !== ARCHIVE_SHA256)
    throw new Error(`Unexpected OEWN archive SHA-256: ${actualSha256}`);
  const words = parseNgsl(readFileSync(join(root, "src/data/ngsl-1.2-stats.csv"), "utf8"));
  const audit = analyzeNgsl(words, loadOewn(archivePath));
  const reviewed = selectReviewed(audit.candidates, readFileSync(reviewedPath, "utf8"));
  const source = {
    ...SOURCE,
    reviewed_senses: reviewed.length,
    reviewed_lexemes: new Set(reviewed.map((row) => row.normalized_word)).size,
    review_policy:
      "Only explicit word + OEWN sense ID pairs are import-ready; spelling matches remain candidates.",
  };
  const outputs = [
    ["summary.json", `${JSON.stringify({ source, ...audit.summary }, null, 2)}\n`],
    ["lemmas.json", `${JSON.stringify(audit.lemmas, null, 2)}\n`],
    ["candidate-senses.json", `${JSON.stringify(audit.candidates, null, 2)}\n`],
    [
      "reviewed-import.sql",
      renderReviewedSql(
        reviewed,
        readFileSync(join(root, "src/data/OEWN-WNDB-LICENSE.txt"), "utf8").trim(),
      ),
    ],
  ];
  if (!check) mkdirSync(outputDir, { recursive: true });
  for (const [name, content] of outputs) {
    const path = join(outputDir, name);
    if (check) {
      if (readFileSync(path, "utf8") !== content)
        throw new Error(`Generated file is out of date: ${path}`);
    } else writeFileSync(path, content);
  }
  console.log(
    `${check ? "Verified" : "Prepared"} ${audit.summary.candidate_lexemes} candidate lemmas, ${audit.summary.candidate_senses} candidate senses, ${reviewed.length} reviewed senses.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
