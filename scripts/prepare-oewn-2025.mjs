import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archivePath = process.argv[2];
const dataDir = process.argv[3];
const check = process.argv.includes("--check");
if (!archivePath || !dataDir) {
  throw new Error(
    "Usage: node scripts/prepare-oewn-2025.mjs <official-json.zip> <extracted-directory> [--check]",
  );
}

const archiveSha256 = "7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51";
const actualSha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
if (actualSha256 !== archiveSha256)
  throw new Error(`Unexpected OEWN archive SHA-256: ${actualSha256}`);

const sourceId = "oewn-2025";
const sourceUrl = "https://en-word.net/downloads/english-wordnet-2025-json.zip";
const licenseUrl = "https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md";
const attribution =
  "Open English Wordnet 2025 © The Open English WordNet Team, CC BY 4.0; derived from Princeton WordNet 3.1 © 2011 Princeton University under the WordNet License. This is a selected and transformed NGSL pilot subset; no endorsement is implied.";
const licenseNotice = readFileSync(join(root, "src/data/OEWN-WNDB-LICENSE.txt"), "utf8").trim();
const transformation =
  "Selected NGSL headwords and reviewed OEWN sense IDs from oewn-2025-pilot-senses.tsv; retained the first English definition and example, with US IPA preferred over GB; omitted unlicensed translations.";

const ngsl = new Set(
  readFileSync(join(root, "src/data/ngsl-1.2-stats.csv"), "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(",")[0]),
);
const selections = readFileSync(join(root, "src/data/oewn-2025-pilot-senses.tsv"), "utf8")
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("\t"));
if (selections.some(([word, senseId]) => !word || !senseId || !ngsl.has(word))) {
  throw new Error("Every selected sense must identify a word from NGSL 1.2");
}
if (new Set(selections.map(([word]) => word.toLowerCase())).size !== selections.length) {
  throw new Error("Duplicate pilot headword");
}

const readJson = (file) => JSON.parse(readFileSync(join(dataDir, file), "utf8"));
const synsets = new Map();
for (const file of readdirSync(dataDir).filter(
  (name) => name.endsWith(".json") && !name.startsWith("entries-") && name !== "frames.json",
)) {
  for (const [id, row] of Object.entries(readJson(file))) synsets.set(id, row);
}

const posNames = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };
const rows = selections.map(([word, senseId]) => {
  const entries = readJson(`entries-${word[0].toLowerCase()}.json`)[word];
  if (!entries) throw new Error(`Missing exact OEWN headword: ${word}`);
  const match = Object.entries(entries)
    .filter(([, data]) => data?.sense)
    .flatMap(([pos, data]) => data.sense.map((sense) => ({ pos, data, sense })))
    .find(({ sense }) => sense.id === senseId);
  if (!match || !posNames[match.pos]) throw new Error(`Missing OEWN sense: ${word} / ${senseId}`);
  const synset = synsets.get(match.sense.synset);
  const definition = synset?.definition?.find((value) => value?.trim());
  if (!definition) throw new Error(`Missing English definition: ${word} / ${senseId}`);
  const pronunciations = match.data.pronunciation ?? [];
  const pronunciation =
    pronunciations.find((item) => item.variety === "US") ??
    pronunciations.find((item) => item.variety === "GB") ??
    pronunciations[0];
  return {
    word,
    normalized_word: word.trim().toLowerCase(),
    source_entry_ref: senseId,
    sense_key: senseId,
    priority: 100,
    part_of_speech: posNames[match.pos],
    phonetic: pronunciation?.value ? `/${pronunciation.value}/` : null,
    definition_en: definition,
    sentence: synset.example?.find((value) => value?.trim()) ?? null,
  };
});

const sqlValue = (value) => (value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`);
const sourceValues = [
  sourceId,
  "Open English WordNet 2025",
  "2025-12-31",
  sourceUrl,
  "CC-BY-4.0",
  licenseUrl,
  attribution,
  licenseNotice,
  archiveSha256,
  transformation,
].map(sqlValue);
const lexemeValues = rows.map(
  (row) => `  ('en', ${sqlValue(row.normalized_word)}, ${sqlValue(row.word)})`,
);
const entryValues = rows.map(
  (row) =>
    `  (${[
      sqlValue(row.normalized_word),
      sqlValue(row.source_entry_ref),
      sqlValue(row.sense_key),
      String(row.priority),
      sqlValue(row.part_of_speech),
      sqlValue(row.phonetic),
      sqlValue(row.definition_en),
      sqlValue(row.sentence),
    ].join(", ")})`,
);
const sql = `-- Generated from the official Open English WordNet 2025 JSON archive by scripts/prepare-oewn-2025.mjs.
-- Open English Wordnet 2025 © The Open English WordNet Team (CC BY 4.0).
-- Derived from Princeton WordNet 3.1 © 2011 Princeton University (WordNet License).
-- Selection and field mapping are documented in src/data/OEWN-SOURCE.md.
ALTER TABLE public.lexicon_sources
  ADD COLUMN IF NOT EXISTS source_sha256 text CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS license_notice text,
  ADD COLUMN IF NOT EXISTS transformation text;

INSERT INTO public.lexicon_sources
  (id, title, version, source_url, license_id, license_url, attribution, license_notice, source_sha256, transformation)
VALUES (${sourceValues.join(", ")})
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, version = EXCLUDED.version, source_url = EXCLUDED.source_url,
  license_id = EXCLUDED.license_id, license_url = EXCLUDED.license_url,
  attribution = EXCLUDED.attribution, license_notice = EXCLUDED.license_notice,
  source_sha256 = EXCLUDED.source_sha256,
  transformation = EXCLUDED.transformation;

INSERT INTO public.lexemes (language, normalized_word, lemma)
VALUES
${lexemeValues.join(",\n")}
ON CONFLICT (language, normalized_word) DO NOTHING;

INSERT INTO public.lexicon_entries
  (lexeme_id, source_id, source_entry_ref, sense_key, priority, part_of_speech, phonetic, definition_en, sentence)
SELECT l.id, ${sqlValue(sourceId)}, v.source_entry_ref, v.sense_key, v.priority,
       v.part_of_speech, v.phonetic, v.definition_en, v.sentence
FROM (VALUES
${entryValues.join(",\n")}
) AS v(normalized_word, source_entry_ref, sense_key, priority, part_of_speech, phonetic, definition_en, sentence)
JOIN public.lexemes AS l ON l.language = 'en' AND l.normalized_word = v.normalized_word
ON CONFLICT (lexeme_id, source_id, sense_key) DO UPDATE SET
  source_entry_ref = EXCLUDED.source_entry_ref, priority = EXCLUDED.priority,
  part_of_speech = EXCLUDED.part_of_speech, phonetic = EXCLUDED.phonetic,
  definition_en = EXCLUDED.definition_en, sentence = EXCLUDED.sentence;
`;

const outputs = [
  [join(root, "drizzle/migrations/0007_seed_oewn_2025_pilot.sql"), sql],
  [join(root, "src/data/oewn-2025-pilot.json"), `${JSON.stringify(rows, null, 2)}\n`],
];
for (const [file, content] of outputs) {
  if (check) {
    if (readFileSync(file, "utf8") !== content)
      throw new Error(`Generated file is out of date: ${file}`);
  } else {
    writeFileSync(file, content);
  }
}
console.log(
  `${check ? "Verified" : "Prepared"} ${rows.length} sourced OEWN senses for NGSL pilot words.`,
);
