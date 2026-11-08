import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const load = (path) => readFile(resolve(root, path), "utf8");

async function insertMany(table, columns, rows, conflict = "") {
  if (!rows.length) return;
  const parameters = rows.flat();
  const values = rows.map((_, rowIndex) => {
    const placeholders = columns.map((__, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`);
    return `(${placeholders.join(", ")})`;
  });
  await client.unsafe(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${values.join(", ")} ${conflict}`,
    parameters,
  );
}

async function importNgsl() {
  const csv = await load("src/data/ngsl-1.2-stats.csv");
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (header !== "Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)" || lines.length !== 2809)
    throw new Error(`NGSL source format or count changed: ${lines.length} rows`);
  const entries = lines.map((line, index) => {
    const [word, rank, sfi, frequency] = line.split(",");
    if (!word || Number(rank) !== index + 1 || !Number.isFinite(Number(sfi)) || !Number.isFinite(Number(frequency)))
      throw new Error(`Invalid NGSL source row ${index + 2}`);
    return ["ngsl-1.2", index, word, Number(rank), Number(sfi), Number(frequency)];
  });
  const sourceHash = sha256(csv);
  await insertMany(
    "public.lexicon_sources",
    ["id", "title", "version", "source_url", "license_id", "license_url", "attribution", "access_tier", "source_sha256", "transformation", "source_kind"],
    [[
      "ngsl-1.2",
      "New General Service List 1.2 with basic statistics",
      "1.2",
      "https://www.newgeneralservicelist.com/new-general-service-list",
      "CC-BY-SA-4.0",
      "https://creativecommons.org/licenses/by-sa/4.0/",
      "New General Service List 1.2 by Browne, Culligan, and Phillips.",
      "public",
      sourceHash,
      "Published NGSL ranks, SFI scores, and adjusted frequency per million, imported without reordering.",
      "external",
    ]],
    `ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, version = EXCLUDED.version, source_url = EXCLUDED.source_url, license_id = EXCLUDED.license_id, license_url = EXCLUDED.license_url, attribution = EXCLUDED.attribution, access_tier = EXCLUDED.access_tier, source_sha256 = EXCLUDED.source_sha256, transformation = EXCLUDED.transformation, source_kind = EXCLUDED.source_kind`,
  );
  await insertMany(
    "public.word_books",
    ["id", "name", "description", "source", "owner_user_id"],
    [["ngsl-1.2", "NGSL 1.2", "New General Service List frequency order", "official", null]],
    "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, source = EXCLUDED.source, owner_user_id = NULL",
  );
  for (let start = 0; start < entries.length; start += 400) {
    await insertMany(
      "public.word_entries",
      ["book_id", "position", "word", "source_rank", "source_sfi", "source_frequency_per_million"],
      entries.slice(start, start + 400),
      "ON CONFLICT (book_id, word) DO UPDATE SET position = EXCLUDED.position, source_rank = EXCLUDED.source_rank, source_sfi = EXCLUDED.source_sfi, source_frequency_per_million = EXCLUDED.source_frequency_per_million",
    );
  }
  await client`UPDATE public.word_books SET word_count = (SELECT count(*)::int FROM public.word_entries WHERE book_id = 'ngsl-1.2'), updated_at = now() WHERE id = 'ngsl-1.2'`;
}

async function importPilot(manifest) {
  const rows = JSON.parse(await load("src/data/oewn-2025-pilot.json"));
  if (rows.length !== manifest.expected.reviewed) throw new Error("OEWN pilot count does not match its manifest");
  const licenseNotice = await load("src/data/OEWN-WNDB-LICENSE.txt");
  await insertMany(
    "public.lexicon_sources",
    ["id", "title", "version", "source_url", "license_id", "license_url", "attribution", "access_tier", "source_sha256", "license_notice", "transformation", "source_kind"],
    [[
      "oewn-2025",
      "Open English WordNet 2025",
      "2025-12-31",
      "https://en-word.net/downloads/english-wordnet-2025-json.zip",
      "CC-BY-4.0",
      "https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md",
      "Open English Wordnet 2025 © The Open English WordNet Team, CC BY 4.0; derived from Princeton WordNet 3.1 © 2011 Princeton University under the WordNet License. Selected and transformed NGSL senses; no endorsement is implied.",
      "public",
      manifest.archive_sha256,
      licenseNotice,
      "Exact-spelling NGSL headwords and explicitly reviewed sense IDs; first source definition and synset example; US IPA preferred over GB. No inferred content, translations, or automatic default sense.",
      "external",
    ]],
    "ON CONFLICT (id) DO NOTHING",
  );
  await insertMany(
    "public.lexemes",
    ["language", "normalized_word", "lemma"],
    rows.map((row) => ["en", row.normalized_word, row.word]),
    "ON CONFLICT (language, normalized_word) DO NOTHING",
  );
  const lexemeRows = await client`SELECT id, normalized_word FROM public.lexemes WHERE language = 'en'`;
  const lexemeIds = new Map(lexemeRows.map((row) => [row.normalized_word, row.id]));
  await insertMany(
    "public.lexicon_entries",
    ["lexeme_id", "source_id", "source_entry_ref", "sense_key", "priority", "part_of_speech", "phonetic", "definition_en", "sentence", "content_type", "sense_role", "publication_status"],
    rows.map((row) => [
      lexemeIds.get(row.normalized_word),
      "oewn-2025",
      row.source_entry_ref,
      row.sense_key,
      row.priority,
      row.part_of_speech,
      row.phonetic,
      row.definition_en,
      row.sentence,
      "sense",
      "primary",
      "published",
    ]),
    "ON CONFLICT (lexeme_id, source_id, sense_key) DO UPDATE SET priority = EXCLUDED.priority, part_of_speech = EXCLUDED.part_of_speech, phonetic = EXCLUDED.phonetic, definition_en = EXCLUDED.definition_en, sentence = EXCLUDED.sentence, sense_role = 'primary', publication_status = 'published'",
  );
}

async function executeSqlFile(path, expectedHash) {
  const contents = await load(path);
  if (expectedHash && sha256(contents) !== expectedHash) throw new Error(`SHA-256 mismatch: ${path}`);
  await client.unsafe(contents);
}

async function importOewn() {
  const path = "ops/oewn-2025-ngsl/manifest.json";
  const manifest = JSON.parse(await load(path));
  if (manifest.expected.senses !== 19028 || manifest.expected.lexemes !== 2742 || manifest.expected.reviewed !== 26)
    throw new Error("Unexpected OEWN package counts");
  await importPilot(manifest);
  for (const file of manifest.files) {
    await executeSqlFile(`ops/oewn-2025-ngsl/${file.name}`, file.sha256);
  }
}

async function importRound2() {
  const directory = "ops/cadence-round2-editorial";
  const manifest = JSON.parse(await load(`${directory}/manifest.json`));
  for (const [file, expectedHash] of Object.entries(manifest.input_sha256))
    if (sha256(await load(`${directory}/source/${file.replaceAll("_json", ".json").replaceAll("_jsonl", ".jsonl")}`)) !== expectedHash)
      throw new Error(`Round 2 source checksum mismatch: ${file}`);
  await executeSqlFile(`${directory}/01-import-pending.sql`, manifest.output_sha256.import_sql);
}

async function assertData() {
  const [ngsl] = await client`SELECT count(*)::int AS count FROM public.word_entries WHERE book_id = 'ngsl-1.2'`;
  const [oewn] = await client`SELECT count(*)::int AS count, count(*) FILTER (WHERE priority = 100)::int AS pilots FROM public.lexicon_entries WHERE source_id = 'oewn-2025'`;
  const [round2] = await client`SELECT count(*)::int AS count, count(*) FILTER (WHERE content_type = 'sense')::int AS senses, count(*) FILTER (WHERE content_type = 'usage_note')::int AS notes FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863'`;
  const [restricted] = await client`SELECT count(*)::int AS count FROM public.lexicon_entries e JOIN public.lexicon_sources s ON s.id = e.source_id WHERE e.source_id = 'cadence-round2-editorial-bccb9a1ab863' AND e.publication_status = 'pending_review' AND s.access_tier = 'restricted' AND s.source_kind = 'editorial'`;
  if (ngsl.count !== 2809) throw new Error(`NGSL import count ${ngsl.count}; expected 2809`);
  if (oewn.count !== 19028 || oewn.pilots !== 26) throw new Error(`OEWN import counts mismatch: ${JSON.stringify(oewn)}`);
  if (round2.count !== 88 || round2.senses !== 43 || round2.notes !== 45 || restricted.count !== 88)
    throw new Error(`Round 2 import counts or publication status mismatch: ${JSON.stringify({ round2, restricted })}`);
  console.log(JSON.stringify({ ngsl: ngsl.count, oewn: oewn.count, pilots: oewn.pilots, round2: round2.count, round2Senses: round2.senses, usageNotes: round2.notes, pendingRestricted: restricted.count }));
}

try {
  await migrate(drizzle(client), { migrationsFolder: resolve(root, "drizzle/migrations") });
  if (!process.argv.includes("--migrate-only")) {
    await importNgsl();
    await importOewn();
    await importRound2();
    await assertData();
  }
} finally {
  await client.end({ timeout: 5 });
}
