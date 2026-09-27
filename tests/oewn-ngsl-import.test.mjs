import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  ARCHIVE_SHA256,
  analyzeNgsl,
  assertPilotPreserved,
  parseNgsl,
  renderLovableCloudBundle,
  renderReviewedSql,
  selectReviewed,
} from "../scripts/prepare-oewn-2025-ngsl.mjs";

const source = await readFile(new URL("../src/data/ngsl-1.2-stats.csv", import.meta.url), "utf8");

test("NGSL source keeps all 2809 ranked headwords, including their original case", () => {
  const words = parseNgsl(source);
  assert.equal(words.length, 2809);
  assert.equal(words[0], "the");
  assert.ok(words.includes("TRUE"));
});

function fixture() {
  return {
    entries: new Map([
      [
        "bank",
        {
          n: {
            sense: [
              { id: "bank%1:14:00::", synset: "bank-a" },
              { id: "bank%1:17:00::", synset: "bank-b" },
            ],
          },
          v: { sense: [{ id: "bank%2:40:00::", synset: "bank-c" }] },
        },
      ],
      ["do", { "n-1": { sense: [{ id: "do%1:11:00::", synset: "do-a" }] } }],
      [
        "learn",
        {
          v: {
            pronunciation: [
              { value: "lɜːn", variety: "GB" },
              { value: "lɝn", variety: "US" },
            ],
            sense: [{ id: "learn%2:31:00::", synset: "learn-a" }],
          },
        },
      ],
      ["IT", { n: { sense: [{ id: "IT%1:14:00::", synset: "it-a" }] } }],
    ]),
    folded: new Map([
      ["bank", ["bank"]],
      ["do", ["do"]],
      ["learn", ["learn"]],
      ["it", ["IT"]],
    ]),
    synsets: new Map([
      ["bank-a", { definition: ["a financial institution"], example: ["The bank is open."] }],
      ["bank-b", { definition: ["sloping land beside water"] }],
      ["bank-c", { definition: ["put money in a bank"] }],
      ["do-a", { definition: ["a musical note"] }],
      ["learn-a", { definition: ["gain knowledge"], example: ["Children learn quickly."] }],
      ["it-a", { definition: ["information technology"] }],
    ]),
  };
}

test("candidate audit separates exact lemmas, case-only homographs, missing words, and polysemy", () => {
  const { summary, lemmas, candidates } = analyzeNgsl(
    ["bank", "do", "learn", "it", "the"],
    fixture(),
  );
  assert.equal(summary.exact_lemma_matches, 3);
  assert.equal(summary.case_only_headwords, 1);
  assert.equal(summary.no_oewn_headword, 1);
  assert.equal(summary.candidate_senses, 5);
  assert.equal(summary.multiple_sense_lemmas, 1);
  assert.equal(summary.multiple_pos_lemmas, 1);
  assert.deepEqual(lemmas[0].pos_counts, { noun: 2, verb: 1 });
  assert.deepEqual(lemmas[0].ambiguity, ["multiple_senses", "multiple_pos"]);
  assert.deepEqual(lemmas[3].alternate_headwords, ["IT"]);
  assert.equal(lemmas[3].sense_count, 0);
  assert.equal(lemmas[3].alternate_sense_count, 1);
  assert.deepEqual(lemmas[3].alternate_pos_counts, { noun: 1 });
  assert.equal(summary.case_only_sense_candidates, 1);
  assert.equal(candidates.find((row) => row.word === "do").part_of_speech, "noun");
  assert.equal(candidates.find((row) => row.word === "learn").phonetic, "/lɝn/");
  assert.equal(
    candidates.find((row) => row.word === "bank" && row.source_pos === "n").sentence,
    "The bank is open.",
  );
});

test("only explicit reviewed word and sense pairs become import-ready", () => {
  const { candidates } = analyzeNgsl(["bank", "learn", "it"], fixture());
  assert.throws(() => selectReviewed(candidates, "it\tIT%1:14:00::"), /absent/);
  assert.throws(() => selectReviewed(candidates, "bank\tbank%1:99:00::"), /absent/);
  assert.throws(
    () => selectReviewed(candidates, "bank\tbank%1:14:00::\nbank\tbank%1:17:00::"),
    /one reviewed primary/,
  );
  const reviewed = selectReviewed(candidates, "bank\tbank%1:14:00::\nlearn\tlearn%2:31:00::");
  assert.deepEqual(
    reviewed.map((row) => row.source_entry_ref),
    ["bank%1:14:00::", "learn%2:31:00::"],
  );
  assert.ok(reviewed.every((row) => row.priority === 100));
  const multiSense = selectReviewed(
    candidates,
    "bank\tbank%1:14:00::\t100\nbank\tbank%1:17:00::\t0",
  );
  assert.deepEqual(
    multiSense.map((row) => row.priority),
    [100, 0],
  );
  assert.throws(
    () => selectReviewed(candidates, "bank\tbank%1:14:00::\nbank\tbank%1:17:00::"),
    /one reviewed primary/,
  );
});

test("staged SQL preserves provenance and uses idempotent upserts without user-data writes", () => {
  const { candidates } = analyzeNgsl(["bank"], fixture());
  const reviewed = selectReviewed(candidates, "bank\tbank%1:14:00::");
  const sql = renderReviewedSql(reviewed, "WordNet license notice");
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(sql, /source_sha256/);
  assert.match(sql, /CC-BY-4\.0/);
  assert.match(sql, /WordNet license notice/);
  assert.match(sql, /bank%1:14:00::/);
  assert.match(sql, /ON CONFLICT \(lexeme_id, source_id, sense_key\) DO UPDATE/);
  assert.doesNotMatch(
    sql,
    /(?:INSERT|UPDATE|DELETE) (?:INTO |FROM )?public\.(word_entries|attempts|word_mastery)/,
  );
});

test("Lovable bundle stages data outside public and keeps each data statement idempotent", () => {
  const { candidates } = analyzeNgsl(["bank", "learn", "it"], fixture());
  const reviewed = selectReviewed(candidates, "bank\tbank%1:14:00::\nlearn\tlearn%2:31:00::");
  const bundle = renderLovableCloudBundle(candidates, reviewed, "WordNet license notice");
  const setup = bundle.find(([name]) => name === "00-stage-setup.sql")[1];
  const batch = bundle.find(([name]) => name === "01-stage-batches.sql")[1];
  assert.match(setup, /CREATE SCHEMA IF NOT EXISTS oewn_stage_2025/);
  assert.match(setup, /REVOKE ALL ON SCHEMA oewn_stage_2025 FROM PUBLIC/);
  assert.doesNotMatch(setup, /CREATE TABLE public\./);
  assert.match(batch, /INSERT INTO oewn_stage_2025\.senses/);
  assert.match(batch, /ON CONFLICT \(sense_key\) DO UPDATE/);
  assert.doesNotMatch(batch, /(?:INSERT|UPDATE|DELETE) (?:INTO |FROM )?public\./);
});

test("staging validation checks counts and provenance while final apply is one atomic DO statement", () => {
  const { candidates } = analyzeNgsl(["learn"], fixture());
  const reviewed = selectReviewed(candidates, "learn\tlearn%2:31:00::");
  const bundle = renderLovableCloudBundle(candidates, reviewed, "WordNet license notice");
  const validation = bundle.find(([name]) => name === "11-stage-validation.sql")[1];
  const apply = bundle.find(([name]) => name === "12-final-apply.sql")[1];
  const verify = bundle.find(([name]) => name === "13-verification.sql")[1];
  const cleanup = bundle.find(([name]) => name === "14-cleanup.sql")[1];
  assert.match(validation, /IS DISTINCT FROM \(1, 1, 1, 0, 1\)/);
  assert.match(validation, new RegExp(ARCHIVE_SHA256));
  assert.match(validation, /reviewed pilot sense IDs do not match the approved set/);
  assert.match(apply, /^-- Single-statement final apply[\s\S]*DO \$oewn_apply\$/);
  assert.doesNotMatch(apply, /\n(?:BEGIN|COMMIT);/);
  assert.match(apply, /INSERT INTO public\.lexicon_sources/);
  assert.match(apply, /INSERT INTO public\.lexemes/);
  assert.match(apply, /INSERT INTO public\.lexicon_entries/);
  assert.match(apply, /GREATEST\(public\.lexicon_entries\.priority, EXCLUDED\.priority\)/);
  assert.match(apply, /Existing reviewed pilot content\/identity/);
  assert.match(verify, /overall_match/);
  assert.match(verify, new RegExp(ARCHIVE_SHA256));
  assert.match(cleanup, /OEWN cleanup refused/);
  assert.match(cleanup, /DROP SCHEMA IF EXISTS oewn_stage_2025 CASCADE/);
});

test("staging batches are independently retryable and bundle manifest carries SQL hashes", () => {
  const { candidates } = analyzeNgsl(["bank", "learn", "it"], fixture());
  const reviewed = selectReviewed(candidates, "bank\tbank%1:14:00::\nlearn\tlearn%2:31:00::");
  const bundle = renderLovableCloudBundle(candidates, reviewed, "Line one\r\nLine two\rLine three");
  const batches = bundle.filter(([name]) => name.endsWith("stage-batches.sql"));
  const manifest = JSON.parse(bundle.find(([name]) => name === "manifest.json")[1]);
  assert.equal(batches.length, 1);
  assert.equal(manifest.staging.insert_statements, 1);
  assert.equal(manifest.expected.senses, candidates.length);
  assert.ok(manifest.files.every((file) => file.sha256.length === 64 && file.bytes > 0));
  assert.doesNotMatch(bundle.map(([, sql]) => sql).join("\n"), /\r/);
  assert.match(batches[0][1], /ON CONFLICT \(sense_key\) DO UPDATE/);
  assert.doesNotMatch(batches[0][1], /public\./);
});

test("pilot senses must retain their original content and reviewed primary priority", () => {
  const { candidates } = analyzeNgsl(["learn"], fixture());
  const reviewed = selectReviewed(candidates, "learn\tlearn%2:31:00::");
  const pilot = [{ ...candidates[0] }];
  assert.doesNotThrow(() => assertPilotPreserved(candidates, reviewed, pilot));
  assert.throws(() => assertPilotPreserved(candidates, [], pilot), /lost review/);
  assert.throws(
    () => assertPilotPreserved(candidates, reviewed, [{ ...pilot[0], definition_en: "changed" }]),
    /changed/,
  );
});

test("broken OEWN synset references stop generation", () => {
  const data = fixture();
  data.synsets.delete("bank-a");
  assert.throws(() => analyzeNgsl(["bank"], data), /Missing OEWN synset/);
});
