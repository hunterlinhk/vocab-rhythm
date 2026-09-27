import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  analyzeNgsl,
  parseNgsl,
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

test("broken OEWN synset references stop generation", () => {
  const data = fixture();
  data.synsets.delete("bank-a");
  assert.throws(() => analyzeNgsl(["bank"], data), /Missing OEWN synset/);
});
