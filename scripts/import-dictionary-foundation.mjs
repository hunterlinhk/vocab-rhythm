import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { createGunzip } from "node:zlib";
import postgres from "postgres";

const sourceIds = {
  ecdict: "ecdict",
  ranking: "cadence_headword_ranking",
  authored: "cadence_enhanced_entries",
};
const BATCH = 300;
const REQUIRED_COUNTS = {
  ecdict_entries: 770_611,
  ecdict_tags: 38_855,
  word_forms: 125_861,
  ranked_headwords: 30_000,
  expressions: 4_489,
  expression_reviews: 208,
  authored_documents: 1_867,
  authored_headwords: 525,
  authored_expressions: 1_342,
  authored_senses: 2_904,
  authored_expression_senses: 1_451,
  authored_usage_notes: 1_844,
  authored_headword_usage_notes: 982,
  authored_expression_usage_notes: 862,
};
const PACKAGE_FILES = [
  "lexemes.jsonl.gz",
  "ecdict_entries.jsonl.gz",
  "ecdict_tags.jsonl.gz",
  "ecdict_forms.jsonl.gz",
  "headwords.jsonl.gz",
  "expressions.jsonl.gz",
  "expression_reviews.jsonl.gz",
  "authored_documents.jsonl.gz",
  "authored_senses.jsonl.gz",
  "authored_expression_senses.jsonl.gz",
];

function argValue(name) {
  const prefix = `--${name}=`;
  const exact = process.argv.find((arg) => arg.startsWith(prefix));
  if (exact) return exact.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function argEnabled(name) {
  return process.argv.includes(`--${name}`) || argValue(name) === "true";
}

function assertPackage(manifest) {
  if (manifest.format !== "cadence-dictionary-foundation-v2")
    throw new Error(`Unsupported dictionary package format: ${manifest.format}`);
  const mapping = manifest.authored_mapping;
  if (mapping?.headword_senses !== "lexicon_entries.sense" ||
    mapping?.headword_usage_notes !== "lexicon_entries.usage_note" ||
    mapping?.expression_senses !== "lexicon_documents.content_json.senses" ||
    mapping?.expression_usage_notes !== "lexicon_documents.content_json.senses[].usage_notes" ||
    mapping?.expression_document_key !== "expression:<source_entry_ref>" ||
    mapping?.expression_display_group !== "parent_lexeme_id+expression" ||
    mapping?.expressions_are_independent_senses !== false)
    throw new Error("The package does not declare the expected headword/expression content mapping");
  for (const [key, expected] of Object.entries(REQUIRED_COUNTS)) {
    if (manifest.expected?.[key] !== expected)
      throw new Error(`Unexpected ${key} count in package manifest`);
  }
  for (const key of Object.keys(sourceIds)) {
    if (manifest.source_ids?.[key] !== sourceIds[key])
      throw new Error(`Unexpected ${key} source id`);
  }
}

async function hashFile(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

async function verifyPackage(inputDir, manifest) {
  const names = Object.keys(manifest.files ?? {}).sort();
  if (JSON.stringify(names) !== JSON.stringify([...PACKAGE_FILES].sort()))
    throw new Error("The package manifest does not contain the exact expected file set");
  for (const name of PACKAGE_FILES) {
    const file = manifest.files[name];
    const path = resolve(inputDir, name);
    if ((await stat(path)).size !== file.bytes) throw new Error(`File size mismatch: ${name}`);
    if ((await hashFile(path)) !== file.sha256) throw new Error(`SHA-256 mismatch: ${name}`);
  }
}

function makeInsert(table, columns, rows, conflict = "ON CONFLICT DO NOTHING", jsonColumns = []) {
  if (!rows.length) return null;
  const params = [];
  const valueRows = rows.map((row, rowIndex) => {
    const values = columns.map((column, columnIndex) => {
      const value = row[column];
      params.push(jsonColumns.includes(column) && value != null ? JSON.stringify(value) : value ?? null);
      const position = rowIndex * columns.length + columnIndex + 1;
      return jsonColumns.includes(column) ? `$${position}::jsonb` : `$${position}`;
    });
    return `(${values.join(",")})`;
  });
  return {
    query: `INSERT INTO public.${table} (${columns.join(",")}) VALUES ${valueRows.join(",")} ${conflict}`,
    params,
  };
}

async function insertMany(client, table, columns, rows, conflict, jsonColumns) {
  const statement = makeInsert(table, columns, rows, conflict, jsonColumns);
  if (statement) await client.unsafe(statement.query, statement.params);
}

async function readJsonLines(path, onBatch) {
  const input = createReadStream(path).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  let batch = [];
  let total = 0;
  for await (const line of lines) {
    if (!line) continue;
    batch.push(JSON.parse(line));
    if (batch.length >= BATCH) {
      await onBatch(batch);
      total += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await onBatch(batch);
    total += batch.length;
  }
  return total;
}

async function lexemeIds(client, words) {
  const normalized = [...new Set(words.filter(Boolean))];
  if (!normalized.length) return new Map();
  const placeholders = normalized.map((_, index) => `$${index + 1}`).join(",");
  const rows = await client.unsafe(
    `SELECT id,normalized_word FROM public.lexemes WHERE language='en' AND normalized_word IN (${placeholders})`,
    normalized,
  );
  const result = new Map(rows.map((row) => [row.normalized_word, row.id]));
  const missing = normalized.filter((word) => !result.has(word));
  if (missing.length) throw new Error(`Missing lexeme rows: ${missing.slice(0, 5).join(", ")}`);
  return result;
}

async function importSources(client, sources) {
  for (const source of sources) {
    const [existing] = await client`
      SELECT id,source_sha256 FROM public.lexicon_sources WHERE id = ${source.id}
    `;
    if (existing?.source_sha256 && source.source_sha256 && existing.source_sha256 !== source.source_sha256)
      throw new Error(`Source ${source.id} already exists with a different checksum`);
  }
  for (const source of sources) {
    await client`UPDATE public.lexicon_sources SET access_tier = 'restricted' WHERE id = ${source.id}`;
  }
  const rows = sources.map((source) => ({
    id: source.id,
    title: source.title,
    version: source.version,
    source_url: source.source_url,
    license_id: source.license_id,
    license_url: source.license_url,
    attribution: source.attribution,
    access_tier: "restricted",
    source_sha256: source.source_sha256,
    license_notice: source.license_notice,
    transformation: source.transformation,
    source_kind: source.source_kind,
  }));
  await insertMany(
    client,
    "lexicon_sources",
    ["id", "title", "version", "source_url", "license_id", "license_url", "attribution", "access_tier", "source_sha256", "license_notice", "transformation", "source_kind"],
    rows,
    "ON CONFLICT (id) DO NOTHING",
  );
  for (const source of sources) {
    if (!source.source_sha256) throw new Error(`Source checksum missing: ${source.id}`);
    await client`
      UPDATE public.lexicon_sources
      SET source_sha256 = COALESCE(source_sha256, ${source.source_sha256})
      WHERE id = ${source.id}
    `;
  }
}

async function protectedState(client) {
  const counts = {};
  for (const [key, table] of Object.entries({
    books: "word_books",
    entries: "word_entries",
    attempts: "attempts",
    mastery: "word_mastery",
    progress: "book_progress",
  })) {
    const [row] = await client.unsafe(`SELECT count(*)::int AS count FROM public.${table}`);
    counts[key] = row.count;
  }
  const [pilot] = await client`
    SELECT count(*)::int AS senses,
      count(*) FILTER (WHERE priority = 100)::int AS pilots
    FROM public.lexicon_entries WHERE source_id = 'oewn-2025'
  `;
  const [round2] = await client`
    SELECT count(*)::int AS rows,
      count(*) FILTER (WHERE publication_status = 'pending_review')::int AS pending,
      count(*) FILTER (WHERE content_type = 'sense')::int AS senses,
      count(*) FILTER (WHERE content_type = 'usage_note')::int AS notes
    FROM public.lexicon_entries WHERE source_id = 'cadence-round2-editorial-bccb9a1ab863'
  `;
  const [round2Source] = await client`
    SELECT access_tier,source_kind FROM public.lexicon_sources
    WHERE id = 'cadence-round2-editorial-bccb9a1ab863'
  `;
  if (pilot.senses !== 19_028 || pilot.pilots !== 26)
    throw new Error(`OEWN state is not the expected 19,028 senses / 26 pilots: ${JSON.stringify(pilot)}`);
  if (
    round2.rows !== 88 || round2.pending !== 88 || round2.senses !== 43 || round2.notes !== 45 ||
    round2Source?.access_tier !== "restricted" || round2Source?.source_kind !== "editorial"
  ) throw new Error(`Round 2 state is not the expected pending/restricted 88 rows: ${JSON.stringify({ round2, round2Source })}`);
  return { counts, pilot, round2, round2Source };
}

function sameState(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function importLexemes(client, inputDir) {
  const count = await readJsonLines(resolve(inputDir, "lexemes.jsonl.gz"), async (batch) => {
    await insertMany(
      client,
      "lexemes",
      ["language", "normalized_word", "lemma"],
      batch.map((row) => ({ language: "en", normalized_word: row.normalized_word, lemma: row.lemma })),
      "ON CONFLICT (language, normalized_word) DO NOTHING",
    );
  });
  return count;
}

async function importEcdictEntries(client, inputDir) {
  const columns = [
    "source_id", "source_entry_ref", "lexeme_id", "phonetic", "definition_raw", "translation_raw",
    "part_of_speech_raw", "definition_pos_codes", "translation_pos_codes", "collins_raw", "oxford_raw",
    "tag_raw", "bnc_raw", "frq_raw", "bnc_numeric", "frq_numeric", "exchange_raw", "detail_raw",
    "audio_raw", "source_rank", "wordfreq_zipf",
  ];
  const mutable = columns.filter((column) => !["source_id", "source_entry_ref"].includes(column));
  const conflict = `ON CONFLICT (source_id,source_entry_ref) DO UPDATE SET ${mutable.map((column) => `${column}=EXCLUDED.${column}`).join(",")}`;
  return readJsonLines(resolve(inputDir, "ecdict_entries.jsonl.gz"), async (batch) => {
    const ids = await lexemeIds(client, batch.map((row) => row.word_norm));
    await insertMany(
      client,
      "dictionary_source_entries",
      columns,
      batch.map((row) => ({ source_id: sourceIds.ecdict, ...row, lexeme_id: ids.get(row.word_norm) })),
      conflict,
      ["definition_pos_codes", "translation_pos_codes"],
    );
  });
}

async function importEcdictTags(client, inputDir) {
  return readJsonLines(resolve(inputDir, "ecdict_tags.jsonl.gz"), async (batch) => {
    await insertMany(
      client,
      "dictionary_source_tags",
      ["source_id", "source_entry_ref", "tag", "source_field"],
      batch.map((row) => ({ source_id: sourceIds.ecdict, ...row })),
      "ON CONFLICT DO NOTHING",
    );
  });
}

async function importEcdictForms(client, inputDir) {
  return readJsonLines(resolve(inputDir, "ecdict_forms.jsonl.gz"), async (batch) => {
    const ids = await lexemeIds(client, batch.map((row) => row.lemma_norm));
    await insertMany(
      client,
      "dictionary_source_forms",
      ["source_id", "source_entry_ref", "form_norm", "form", "lemma_norm", "lemma", "form_type", "raw_marker", "lexeme_id"],
      batch.map((row) => ({ source_id: sourceIds.ecdict, ...row, lexeme_id: ids.get(row.lemma_norm) })),
      "ON CONFLICT DO NOTHING",
    );
  });
}

async function importHeadwords(client, inputDir) {
  return readJsonLines(resolve(inputDir, "headwords.jsonl.gz"), async (batch) => {
    const ids = await lexemeIds(client, batch.map((row) => row.headword_norm));
    await insertMany(
      client,
      "dictionary_headwords",
      ["source_id", "headword_norm", "headword", "lexeme_id", "source_rank", "wordfreq_zipf", "is_hyphenated", "parent_norm"],
      batch.map((row) => ({ source_id: sourceIds.ranking, ...row, lexeme_id: ids.get(row.headword_norm) })),
      `ON CONFLICT (source_id,headword_norm) DO UPDATE SET headword=EXCLUDED.headword,lexeme_id=EXCLUDED.lexeme_id,source_rank=EXCLUDED.source_rank,wordfreq_zipf=EXCLUDED.wordfreq_zipf,is_hyphenated=EXCLUDED.is_hyphenated,parent_norm=EXCLUDED.parent_norm`,
    );
  });
}

async function importExpressions(client, inputDir) {
  return readJsonLines(resolve(inputDir, "expressions.jsonl.gz"), async (batch) => {
    const norms = batch.flatMap((row) => [row.expression_norm, row.attach_to_norm]);
    const ids = await lexemeIds(client, norms);
    await insertMany(
      client,
      "dictionary_expression_links",
      ["source_id", "source_entry_ref", "expression_norm", "expression", "expression_lexeme_id", "attach_to", "attach_to_norm", "parent_lexeme_id", "source_rank", "wordfreq_zipf", "handling"],
      batch.map((row) => ({
        source_id: sourceIds.ranking,
        ...row,
        expression_lexeme_id: ids.get(row.expression_norm),
        parent_lexeme_id: ids.get(row.attach_to_norm) ?? null,
      })),
      `ON CONFLICT (source_id,source_entry_ref) DO UPDATE SET expression_norm=EXCLUDED.expression_norm,expression=EXCLUDED.expression,expression_lexeme_id=EXCLUDED.expression_lexeme_id,attach_to=EXCLUDED.attach_to,attach_to_norm=EXCLUDED.attach_to_norm,parent_lexeme_id=EXCLUDED.parent_lexeme_id,source_rank=EXCLUDED.source_rank,wordfreq_zipf=EXCLUDED.wordfreq_zipf,handling=EXCLUDED.handling`,
    );
  });
}

async function importExpressionReviews(client, inputDir) {
  return readJsonLines(resolve(inputDir, "expression_reviews.jsonl.gz"), async (batch) => {
    await insertMany(
      client,
      "dictionary_expression_reviews",
      ["source_id", "expression_norm", "expression", "attach_to", "reason", "review_json", "review_status"],
      batch.map((row) => ({
        source_id: sourceIds.ranking,
        ...row,
        review_status: "pending_review",
      })),
      `ON CONFLICT (source_id,expression_norm) DO UPDATE SET expression=EXCLUDED.expression,attach_to=EXCLUDED.attach_to,reason=EXCLUDED.reason,review_json=EXCLUDED.review_json`,
      ["review_json"],
    );
  });
}

async function importAuthoredDocuments(client, inputDir) {
  return readJsonLines(resolve(inputDir, "authored_documents.jsonl.gz"), async (batch) => {
    const ids = await lexemeIds(client, batch.flatMap((row) => [row.lexeme_norm, row.parent_norm]));
    await insertMany(
      client,
      "lexicon_documents",
      ["source_id", "document_key", "document_type", "lexeme_id", "parent_lexeme_id", "priority", "publication_status", "source_rank", "wordfreq_zipf", "content_json"],
      batch.map((row) => ({
        source_id: sourceIds.authored,
        ...row,
        lexeme_id: ids.get(row.lexeme_norm),
        parent_lexeme_id: row.parent_norm ? ids.get(row.parent_norm) ?? null : null,
        priority: 200,
        publication_status: "published",
      })),
      `ON CONFLICT (source_id,document_key) DO UPDATE SET document_type=EXCLUDED.document_type,lexeme_id=EXCLUDED.lexeme_id,parent_lexeme_id=EXCLUDED.parent_lexeme_id,priority=EXCLUDED.priority,publication_status=EXCLUDED.publication_status,source_rank=EXCLUDED.source_rank,wordfreq_zipf=EXCLUDED.wordfreq_zipf,content_json=EXCLUDED.content_json`,
      ["content_json"],
    );
  });
}

function zhTranslation(row) {
  const label = String(row.label_zh ?? "").trim();
  const definition = String(row.definition_zh ?? "").trim();
  if (label && definition) return `${label}：${definition}`;
  return label || definition || null;
}

function editorialDataWithoutUsageNotes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { usage_notes, ...details } = value;
  return details;
}

async function insertAuthoredSenseBatch(client, batch, lexemeMap) {
  const senseRows = batch.map((row) => ({
    lexeme_id: lexemeMap.get(row.lexeme_norm),
    source_id: sourceIds.authored,
    source_entry_ref: row.source_entry_ref,
    sense_key: row.sense_key,
    priority: 200,
    translation: zhTranslation(row),
    part_of_speech: row.part_of_speech,
    phonetic: row.phonetic || null,
    definition_en: row.definition_en || null,
    sentence: row.editorial_data?.understanding_examples?.[0]?.en ?? null,
    sentence_translation: row.editorial_data?.understanding_examples?.[0]?.zh ?? null,
    content_type: "sense",
    sense_role: row.sense_role,
    publication_status: "published",
    editorial_data: editorialDataWithoutUsageNotes(row.editorial_data),
  }));
  await insertMany(
    client,
    "lexicon_entries",
    ["lexeme_id", "source_id", "source_entry_ref", "sense_key", "priority", "translation", "part_of_speech", "phonetic", "definition_en", "sentence", "sentence_translation", "content_type", "sense_role", "publication_status", "editorial_data"],
    senseRows,
    `ON CONFLICT (lexeme_id,source_id,sense_key) DO UPDATE SET source_entry_ref=EXCLUDED.source_entry_ref,priority=EXCLUDED.priority,translation=EXCLUDED.translation,part_of_speech=EXCLUDED.part_of_speech,phonetic=EXCLUDED.phonetic,definition_en=EXCLUDED.definition_en,sentence=EXCLUDED.sentence,sentence_translation=EXCLUDED.sentence_translation,content_type='sense',sense_role=EXCLUDED.sense_role,publication_status='published',editorial_data=EXCLUDED.editorial_data`,
    ["editorial_data"],
  );
  const noteRows = [];
  for (const row of batch) {
    const notes = row.editorial_data?.usage_notes ?? [];
    for (let index = 0; index < notes.length; index++) {
      const text = typeof notes[index] === "string" ? notes[index].trim() : "";
      if (!text) continue;
      noteRows.push({
        lexeme_id: lexemeMap.get(row.lexeme_norm),
        source_id: sourceIds.authored,
        source_entry_ref: row.source_entry_ref,
        sense_key: `usage:${row.sense_key}:${index + 1}`,
        priority: 200,
        content_type: "usage_note",
        publication_status: "published",
        related_sense_key: row.sense_key,
        usage_note_zh: text,
      });
    }
  }
  await insertMany(
    client,
    "lexicon_entries",
    ["lexeme_id", "source_id", "source_entry_ref", "sense_key", "priority", "content_type", "publication_status", "related_sense_key", "usage_note_zh"],
    noteRows,
    `ON CONFLICT (lexeme_id,source_id,sense_key) DO UPDATE SET source_entry_ref=EXCLUDED.source_entry_ref,priority=EXCLUDED.priority,content_type='usage_note',publication_status='published',related_sense_key=EXCLUDED.related_sense_key,usage_note_zh=EXCLUDED.usage_note_zh`,
  );
  return { senses: senseRows.length, notes: noteRows.length };
}

async function importAuthoredSenses(client, inputDir, filename) {
  let senses = 0;
  let notes = 0;
  const count = await readJsonLines(resolve(inputDir, filename), async (batch) => {
    const ids = await lexemeIds(client, batch.map((row) => row.lexeme_norm));
    const result = await insertAuthoredSenseBatch(client, batch, ids);
    senses += result.senses;
    notes += result.notes;
  });
  return { count, senses, notes };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  return value;
}

async function verifyAuthoredExpressionSenses(client, inputDir) {
  let senses = 0;
  let notes = 0;
  const count = await readJsonLines(resolve(inputDir, "authored_expression_senses.jsonl.gz"), async (batch) => {
    const documentKeys = [...new Set(batch.map((row) => `expression:${row.source_entry_ref}`))];
    const placeholders = documentKeys.map((_, index) => `$${index + 2}`).join(",");
    const documents = await client.unsafe(
      `SELECT document_key,lexeme_id,parent_lexeme_id,content_json FROM public.lexicon_documents WHERE source_id = $1 AND document_key IN (${placeholders})`,
      [sourceIds.authored, ...documentKeys],
    );
    const ids = await lexemeIds(client, batch.flatMap((row) => [row.lexeme_norm, row.parent_norm]));
    const byKey = new Map(documents.map((row) => [row.document_key, row]));
    for (const row of batch) {
      const key = `expression:${row.source_entry_ref}`;
      const stored = byKey.get(key);
      const document = stored?.content_json;
      if (!stored || stored.lexeme_id !== ids.get(row.lexeme_norm) ||
        stored.parent_lexeme_id !== ids.get(row.parent_norm) || document.expression !== row.headword)
        throw new Error(`Expression document ${key} has the wrong expression or parent link`);
      const matchingSenses = document.senses?.filter((sense) => sense.id === row.sense_key) ?? [];
      if (matchingSenses.length !== 1)
        throw new Error(`Expression sense ${row.sense_key} does not map uniquely to ${key}`);
      const sense = matchingSenses[0];
      if (JSON.stringify(stableJson(sense)) !== JSON.stringify(stableJson(row.editorial_data)))
        throw new Error(`Expression sense content differs between package files: ${row.sense_key}`);
      const documentPos = document.part_of_speech;
      const sensePos = typeof sense.part_of_speech === "string" ? sense.part_of_speech : documentPos;
      if (sensePos !== row.part_of_speech || sense.label_zh !== row.label_zh ||
        sense.definition_en !== row.definition_en || sense.definition_zh !== row.definition_zh)
        throw new Error(`Expression sense metadata differs from its document: ${row.sense_key}`);
      senses++;
      notes += Array.isArray(sense.usage_notes) ? sense.usage_notes.length : 0;
    }
  });
  return { count, senses, notes };
}

async function verifyAuthoredContentPackage(inputDir, manifest) {
  const documents = new Map();
  const documentCounts = { headword: 0, expression: 0 };
  await readJsonLines(resolve(inputDir, "authored_documents.jsonl.gz"), async (batch) => {
    for (const row of batch) {
      const key = row.document_key;
      if (!Object.hasOwn(documentCounts, row.document_type) || documents.has(key))
        throw new Error(`Duplicate or unsupported authored document: ${key}`);
      documents.set(key, row);
      documentCounts[row.document_type]++;
    }
  });
  if (documentCounts.headword !== manifest.expected.authored_headwords ||
    documentCounts.expression !== manifest.expected.authored_expressions)
    throw new Error(`Authored package document counts are incorrect: ${JSON.stringify(documentCounts)}`);

  const verifySenseFile = async (filename, documentType, expectedSenses, expectedNotes) => {
    let senses = 0;
    let notes = 0;
    const count = await readJsonLines(resolve(inputDir, filename), async (batch) => {
      for (const row of batch) {
        const documentKey = documentType === "headword"
          ? `headword:${row.lexeme_norm}`
          : `expression:${row.source_entry_ref}`;
        const authoredDocument = documents.get(documentKey);
        if (!authoredDocument || authoredDocument.lexeme_norm !== row.lexeme_norm ||
          (documentType === "expression" && authoredDocument.parent_norm !== row.parent_norm))
          throw new Error(`Missing or mismatched authored ${documentType} document for ${row.lexeme_norm}`);
        const document = authoredDocument.content_json;
        const candidates = documentType === "headword"
          ? [
              ...(Array.isArray(document.parts_of_speech)
                ? document.parts_of_speech.flatMap((group) =>
                    Array.isArray(group.senses) ? group.senses.map((sense) => ({ sense, partOfSpeech: group.pos })) : [],
                  )
                : []),
              ...(Array.isArray(document.senses)
                ? document.senses.map((sense) => ({ sense, partOfSpeech: document.part_of_speech }))
                : []),
            ]
          : Array.isArray(document.senses)
            ? document.senses.map((sense) => ({ sense, partOfSpeech: document.part_of_speech }))
            : [];
        const matching = candidates.filter((candidate) => candidate.sense.id === row.sense_key);
        if (matching.length !== 1)
          throw new Error(`Authored sense ${row.sense_key} does not map uniquely to ${documentType}:${row.lexeme_norm}`);
        const { sense } = matching[0];
        if (JSON.stringify(stableJson(sense)) !== JSON.stringify(stableJson(row.editorial_data)))
          throw new Error(`Authored sense content differs between package files: ${row.sense_key}`);
        const partOfSpeech = matching[0].partOfSpeech;
        if (partOfSpeech && partOfSpeech !== row.part_of_speech)
          throw new Error(`Authored part of speech differs between package files: ${row.sense_key}`);
        const usageNotes = Array.isArray(sense.usage_notes) ? sense.usage_notes : [];
        if (usageNotes.some((note) => typeof note !== "string" || !note.trim()))
          throw new Error(`Authored usage note is empty or invalid: ${row.sense_key}`);
        notes += usageNotes.length;
        senses++;
      }
    });
    if (count !== expectedSenses || senses !== expectedSenses || notes !== expectedNotes)
      throw new Error(`${documentType} authored package counts are incorrect: ${JSON.stringify({ count, senses, notes })}`);
    return { senses, notes };
  };

  const headwords = await verifySenseFile(
    "authored_senses.jsonl.gz",
    "headword",
    manifest.expected.authored_senses,
    manifest.expected.authored_headword_usage_notes,
  );
  const expressions = await verifySenseFile(
    "authored_expression_senses.jsonl.gz",
    "expression",
    manifest.expected.authored_expression_senses,
    manifest.expected.authored_expression_usage_notes,
  );
  return {
    documents: documentCounts,
    headwordSenses: headwords.senses,
    headwordUsageNotes: headwords.notes,
    expressionSenses: expressions.senses,
    expressionUsageNotes: expressions.notes,
  };
}

async function verifyRows(client, manifest) {
  const expectedRows = [
    ["dictionary_source_entries", sourceIds.ecdict, manifest.expected.ecdict_entries],
    ["dictionary_source_tags", sourceIds.ecdict, manifest.expected.ecdict_tags],
    ["dictionary_source_forms", sourceIds.ecdict, manifest.expected.word_forms],
    ["dictionary_headwords", sourceIds.ranking, manifest.expected.ranked_headwords],
    ["dictionary_expression_links", sourceIds.ranking, manifest.expected.expressions],
    ["dictionary_expression_reviews", sourceIds.ranking, manifest.expected.expression_reviews],
    ["lexicon_documents", sourceIds.authored, manifest.expected.authored_documents],
  ];
  const counts = {};
  for (const [table, sourceId, expected] of expectedRows) {
    const [row] = await client.unsafe(
      `SELECT count(*)::int AS count FROM public.${table} WHERE source_id = $1`,
      [sourceId],
    );
    counts[table] = row.count;
    if (row.count !== expected) throw new Error(`${table} count ${row.count}; expected ${expected}`);
  }
  const [authored] = await client`
    SELECT count(*) FILTER (WHERE content_type = 'sense')::int AS senses,
      count(*) FILTER (WHERE content_type = 'usage_note')::int AS notes
    FROM public.lexicon_entries WHERE source_id = ${sourceIds.authored}
  `;
  counts.authored_senses = authored.senses;
  counts.authored_usage_notes = authored.notes;
  const expectedSenseCount = manifest.expected.authored_senses;
  if (authored.senses !== expectedSenseCount)
    throw new Error(`Authored sense count ${authored.senses}; expected ${expectedSenseCount}`);
  if (authored.notes !== manifest.expected.authored_headword_usage_notes)
    throw new Error(`Authored headword usage-note count ${authored.notes}; expected ${manifest.expected.authored_headword_usage_notes}`);
  const [documents] = await client`
    SELECT count(*) FILTER (WHERE document_type = 'headword')::int AS headwords,
      count(*) FILTER (WHERE document_type = 'expression')::int AS expressions
    FROM public.lexicon_documents WHERE source_id = ${sourceIds.authored}
  `;
  if (documents.headwords !== manifest.expected.authored_headwords || documents.expressions !== manifest.expected.authored_expressions)
    throw new Error(`Authored document split is incorrect: ${JSON.stringify(documents)}`);
  const [expressionContent] = await client`
    SELECT count(*)::int AS documents,
      COALESCE(sum(jsonb_array_length(content_json->'senses')), 0)::int AS senses,
      COALESCE(sum((
        SELECT count(*)::int
        FROM jsonb_array_elements(content_json->'senses') AS sense,
          jsonb_array_elements(COALESCE(sense->'usage_notes', '[]'::jsonb)) AS note
      )), 0)::int AS notes
    FROM public.lexicon_documents
    WHERE source_id = ${sourceIds.authored} AND document_type = 'expression'
  `;
  if (expressionContent.documents !== manifest.expected.authored_expressions ||
    expressionContent.senses !== manifest.expected.authored_expression_senses ||
    expressionContent.notes !== manifest.expected.authored_expression_usage_notes)
    throw new Error(`Authored expression content counts are incorrect: ${JSON.stringify(expressionContent)}`);
  counts.authored_expression_senses_in_documents = expressionContent.senses;
  counts.authored_expression_usage_notes_in_documents = expressionContent.notes;
  counts.authored_usage_notes_total = authored.notes + expressionContent.notes;
  const [overlap] = await client`
    SELECT count(DISTINCT authored.lexeme_id)::int AS count
    FROM public.lexicon_documents authored
    JOIN public.dictionary_source_entries ecdict ON ecdict.lexeme_id = authored.lexeme_id
      AND ecdict.source_id = ${sourceIds.ecdict}
    WHERE authored.source_id = ${sourceIds.authored} AND authored.document_type = 'headword'
  `;
  if (overlap.count !== manifest.expected.authored_headwords)
    throw new Error(`Authored headwords do not all override ECDICT entries: ${overlap.count}`);
  const [lexemeCount] = await client`
    SELECT count(*)::int AS count FROM public.lexemes WHERE language = 'en'
      AND normalized_word IN (
        SELECT normalized_word FROM public.dictionary_source_entries WHERE source_id = ${sourceIds.ecdict}
        UNION SELECT headword_norm FROM public.dictionary_headwords WHERE source_id = ${sourceIds.ranking}
        UNION SELECT expression_norm FROM public.dictionary_expression_links WHERE source_id = ${sourceIds.ranking}
      )
  `;
  if (lexemeCount.count < manifest.expected.ecdict_entries)
    throw new Error(`Imported base lexeme count ${lexemeCount.count} is unexpectedly low`);
  counts.indexedSourceLexemes = lexemeCount.count;
  return counts;
}

async function main() {
  const inputDir = resolve(argValue("input-dir") ?? "");
  if (!argValue("input-dir")) throw new Error("--input-dir is required");
  const manifest = JSON.parse(await readFile(resolve(inputDir, "manifest.json"), "utf8"));
  assertPackage(manifest);
  await verifyPackage(inputDir, manifest);
  const authoredMapping = await verifyAuthoredContentPackage(inputDir, manifest);
  if (argEnabled("verify-only")) {
    console.log(JSON.stringify({ status: "verified", sourceDatabaseSha256: manifest.source_database_sha256, expected: manifest.expected, authoredMapping }, null, 2));
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    const before = await protectedState(client);
    await importSources(client, manifest.sources);
    const lexemes = await importLexemes(client, inputDir);
    if (lexemes !== manifest.expected.lexemes) throw new Error(`Lexeme input count ${lexemes}; expected ${manifest.expected.lexemes}`);
    const imported = {};
    imported.ecdict_entries = await importEcdictEntries(client, inputDir);
    imported.ecdict_tags = await importEcdictTags(client, inputDir);
    imported.word_forms = await importEcdictForms(client, inputDir);
    imported.ranked_headwords = await importHeadwords(client, inputDir);
    imported.expressions = await importExpressions(client, inputDir);
    imported.expression_reviews = await importExpressionReviews(client, inputDir);
    imported.authored_documents = await importAuthoredDocuments(client, inputDir);
    const senses = await importAuthoredSenses(client, inputDir, "authored_senses.jsonl.gz");
    const expressionSenses = await verifyAuthoredExpressionSenses(client, inputDir);
    imported.authored_senses = senses.count;
    imported.authored_expression_senses = expressionSenses.count;
    imported.authored_headword_usage_notes = senses.notes;
    imported.authored_expression_usage_notes = expressionSenses.notes;
    imported.authored_usage_notes = senses.notes + expressionSenses.notes;
    if (imported.authored_senses !== manifest.expected.authored_senses)
      throw new Error(`Authored headword sense import count mismatch: ${imported.authored_senses}`);
    if (imported.authored_expression_senses !== manifest.expected.authored_expression_senses)
      throw new Error(`Authored expression document sense count mismatch: ${imported.authored_expression_senses}`);
    if (imported.authored_usage_notes !== manifest.expected.authored_usage_notes)
      throw new Error(`Authored usage-note import count mismatch: ${imported.authored_usage_notes}`);
    for (const [key, expected] of Object.entries(manifest.expected)) {
      if (key === "lexemes" || key === "authored_usage_notes") continue;
      if (imported[key] !== expected) throw new Error(`${key} import count ${imported[key]}; expected ${expected}`);
    }
    const stored = await verifyRows(client, manifest);
    const after = await protectedState(client);
    if (!sameState(before, after))
      throw new Error(`Protected learning or editorial state changed: ${JSON.stringify({ before, after })}`);
    await client.begin(async (transaction) => {
      const publishedSources = await transaction`
        UPDATE public.lexicon_sources SET access_tier = 'public'
        WHERE id IN (${sourceIds.ecdict}, ${sourceIds.ranking}, ${sourceIds.authored})
        RETURNING id
      `;
      if (publishedSources.length !== Object.keys(sourceIds).length)
        throw new Error(`Expected to publish ${Object.keys(sourceIds).length} dictionary sources; updated ${publishedSources.length}`);
    });
    console.log(JSON.stringify({
      status: "complete",
      sourceDatabaseSha256: manifest.source_database_sha256,
      imported,
      stored,
      sources: sourceIds,
      protectedStateUnchanged: true,
      pendingRound2: after.round2,
      pilots: after.pilot,
      sourceVisibility: "public after all package hashes/counts passed",
    }, null, 2));
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
