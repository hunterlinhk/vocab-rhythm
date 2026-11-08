from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import sqlite3
import time
import zipfile
from pathlib import Path
from typing import Any, Callable, Iterable

DEFAULT_DB = Path(r"C:\headswap\Cadence_30k_headwords\dictionary_entries\cadence_dictionary.sqlite3")
DEFAULT_OUTPUT = Path(r"C:\headswap\Cadence_30k_headwords\server_upload")

EXPECTED = {
    "ecdict_entries": 770_611,
    "ecdict_tags": 38_855,
    "word_forms": 125_861,
    "source_headwords": 30_000,
    "source_expressions": 4_489,
    "enhanced_entries": 525,
    "enhanced_senses": 2_904,
    "enhanced_expressions": 1_342,
    "enhanced_expression_senses": 1_451,
    "pending_expression_reviews": 208,
}

SOURCE_IDS = {
    "ecdict": "ecdict",
    "ranking": "cadence_headword_ranking",
    "authored": "cadence_enhanced_entries",
}

FILES = [
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
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def open_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path.resolve().as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    return connection


def count_table(connection: sqlite3.Connection, table: str) -> int:
    return int(connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0])


def json_value(value: str | None, default: Any = None) -> Any:
    return default if not value else json.loads(value)


def write_jsonl_gzip(
    output: Path,
    rows: Iterable[sqlite3.Row],
    transform: Callable[[sqlite3.Row], dict[str, Any]],
) -> int:
    temporary = output.with_suffix(output.suffix + ".tmp")
    count = 0
    with temporary.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=6, mtime=0) as compressed:
            with io.TextIOWrapper(compressed, encoding="utf-8", newline="\n") as text:
                for row in rows:
                    text.write(json.dumps(transform(row), ensure_ascii=False, separators=(",", ":")))
                    text.write("\n")
                    count += 1
    temporary.replace(output)
    return count


def first_sense_ids(connection: sqlite3.Connection, table: str, json_column: str, id_column: str) -> set[tuple[str, str]]:
    selected: set[tuple[str, str]] = set()
    for row in connection.execute(f"SELECT {id_column},{json_column} FROM {table}"):
        document = json_value(row[json_column], {})
        senses = []
        for group in document.get("parts_of_speech", []):
            senses.extend(group.get("senses", []))
        senses.extend(document.get("senses", []))
        if senses and senses[0].get("id"):
            selected.add((str(row[id_column]), str(senses[0]["id"])))
    return selected


def verify_counts(connection: sqlite3.Connection) -> dict[str, int]:
    counts = {table: count_table(connection, table) for table in EXPECTED}
    if counts != EXPECTED:
        raise ValueError(f"Local SQLite counts differ from the reviewed handoff: {counts}")
    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
    if integrity != "ok" or foreign_keys:
        raise ValueError(f"SQLite integrity check failed: {integrity}; foreign-key errors={len(foreign_keys)}")
    return counts


def count_usage_notes(connection: sqlite3.Connection) -> dict[str, int]:
    counts = {}
    for table, key in (
        ("enhanced_senses", "authored_headword_usage_notes"),
        ("enhanced_expression_senses", "authored_expression_usage_notes"),
    ):
        counts[key] = sum(
            len(json_value(row["sense_json"], {}).get("usage_notes", []))
            for row in connection.execute(f"SELECT sense_json FROM {table}")
        )
    counts["authored_usage_notes"] = sum(counts.values())
    expected = {
        "authored_headword_usage_notes": 982,
        "authored_expression_usage_notes": 862,
        "authored_usage_notes": 1_844,
    }
    if counts != expected:
        raise ValueError(f"Authored usage-note counts differ from the reviewed source: {counts}")
    return counts


def build_sources(connection: sqlite3.Connection, source_hashes: dict[str, str]) -> list[dict[str, Any]]:
    registry = {
        row["source_id"]: dict(row)
        for row in connection.execute("SELECT * FROM source_registry ORDER BY source_id")
    }
    ecdict = registry[SOURCE_IDS["ecdict"]]
    ranking = registry[SOURCE_IDS["ranking"]]
    authored = registry[SOURCE_IDS["authored"]]
    ecdict_details = json_value(ecdict["details_json"], {})
    return [
        {
            "id": SOURCE_IDS["ecdict"],
            "title": ecdict["name"],
            "version": ecdict["version"],
            "source_url": ecdict["url"],
            "license_id": ecdict["license"],
            "license_url": "https://github.com/skywind3000/ECDICT/blob/39cfb9672c0906b63569e0453c2e6abfb9ab182a/LICENSE",
            "attribution": ecdict["attribution"],
            "access_tier": "restricted",
            "source_sha256": ecdict_details.get("snapshot", {}).get("sha256") or source_hashes["ecdict_csv"],
            "license_notice": None,
            "transformation": "Complete ECDICT source rows and relations are preserved as source records. English definitions, Chinese translations, and parsed part-of-speech hints remain separate raw fields.",
            "source_kind": "external",
        },
        {
            "id": SOURCE_IDS["ranking"],
            "title": ranking["name"],
            "version": ranking["version"],
            "source_url": ranking["url"],
            "license_id": None,
            "license_url": None,
            "attribution": ranking["attribution"],
            "access_tier": "restricted",
            "source_sha256": source_hashes["headword_tsv"],
            "license_notice": None,
            "transformation": "Thirty-thousand ranked headwords and their attached expression inventory, imported without changing their supplied order.",
            "source_kind": "editorial",
        },
        {
            "id": SOURCE_IDS["authored"],
            "title": authored["name"],
            "version": authored["version"],
            "source_url": "https://coci.ink/",
            "license_id": None,
            "license_url": None,
            "attribution": authored["attribution"],
            "access_tier": "restricted",
            "source_sha256": source_hashes["sqlite_database"],
            "license_notice": None,
            "transformation": "Cadence-authored headwords, full sense JSON, examples, labels, collocations, patterns, notes, pitfalls, and related expression documents are preserved. This source is authoritative over ECDICT when a headword overlaps.",
            "source_kind": "editorial",
        },
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the local Cadence/ECDICT SQLite foundation into a hashed server import package.")
    parser.add_argument("--database", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    database = args.database.resolve()
    output = args.output.resolve()
    if not database.is_file():
        parser.error(f"Dictionary database not found: {database}")
    output.mkdir(parents=True, exist_ok=True)

    connection = open_database(database)
    try:
        counts = verify_counts(connection)
        authored_primary = first_sense_ids(connection, "enhanced_entries", "entry_json", "headword_index")
        expression_primary = first_sense_ids(connection, "enhanced_expressions", "expression_json", "id")
        source_hashes: dict[str, str] = {"sqlite_database": sha256_file(database)}
        source_root = database.parent.parent
        for key, relative in {
            "ecdict_csv": Path("data_sources/raw/ecdict.csv"),
            "headword_tsv": Path("Cadence_30k_headwords.tsv"),
            "authored_json": Path("dictionary_entries/batch_0001.json"),
            "authored_manifest": Path("dictionary_entries/manifest.json"),
        }.items():
            path = source_root / relative
            if path.is_file():
                source_hashes[key] = sha256_file(path)
        if "ecdict_csv" not in source_hashes or "headword_tsv" not in source_hashes or "authored_json" not in source_hashes:
            raise ValueError("One or more source files referenced by the SQLite database are missing")
        sources = build_sources(connection, source_hashes)
        authored_usage_notes = count_usage_notes(connection)

        counts_exported: dict[str, int] = {}

        counts_exported["lexemes"] = write_jsonl_gzip(
            output / "lexemes.jsonl.gz",
            connection.execute(
                "SELECT normalized_word, min(lemma) AS lemma FROM ("
                "SELECT word_norm AS normalized_word, word AS lemma FROM ecdict_entries UNION ALL "
                "SELECT lemma_norm, lemma FROM word_forms UNION ALL "
                "SELECT headword_norm, headword FROM source_headwords UNION ALL "
                "SELECT expression_norm, expression FROM source_expressions UNION ALL "
                "SELECT attach_to_norm, attach_to FROM source_expressions UNION ALL "
                "SELECT headword_norm, headword FROM enhanced_entries UNION ALL "
                "SELECT expression_norm, expression FROM enhanced_expressions UNION ALL "
                "SELECT lower(parent_headword), parent_headword FROM enhanced_expressions) "
                "WHERE normalized_word <> '' GROUP BY normalized_word ORDER BY normalized_word"
            ),
            lambda row: {"normalized_word": row["normalized_word"], "lemma": row["lemma"]},
        )
        counts_exported["ecdict_entries"] = write_jsonl_gzip(
            output / "ecdict_entries.jsonl.gz",
            connection.execute(
                "SELECT id,word,word_norm,phonetic,definition_raw,translation_raw,pos_raw,"
                "definition_pos_codes_json,translation_pos_codes_json,collins_raw,oxford_raw,tag_raw,"
                "bnc_raw,frq_raw,bnc_numeric,frq_numeric,exchange_raw,detail_raw,audio_raw,source_rank,wordfreq_zipf "
                "FROM ecdict_entries ORDER BY id"
            ),
            lambda row: {
                "source_entry_ref": str(row["id"]), "word": row["word"], "word_norm": row["word_norm"],
                "phonetic": row["phonetic"], "definition_raw": row["definition_raw"],
                "translation_raw": row["translation_raw"], "part_of_speech_raw": row["pos_raw"],
                "definition_pos_codes": json_value(row["definition_pos_codes_json"], []),
                "translation_pos_codes": json_value(row["translation_pos_codes_json"], []),
                "collins_raw": row["collins_raw"], "oxford_raw": row["oxford_raw"], "tag_raw": row["tag_raw"],
                "bnc_raw": row["bnc_raw"], "frq_raw": row["frq_raw"], "bnc_numeric": row["bnc_numeric"],
                "frq_numeric": row["frq_numeric"], "exchange_raw": row["exchange_raw"],
                "detail_raw": row["detail_raw"], "audio_raw": row["audio_raw"],
                "source_rank": row["source_rank"], "wordfreq_zipf": row["wordfreq_zipf"],
            },
        )
        counts_exported["ecdict_tags"] = write_jsonl_gzip(
            output / "ecdict_tags.jsonl.gz",
            connection.execute("SELECT entry_id,tag,source_field FROM ecdict_tags ORDER BY entry_id,tag,source_field"),
            lambda row: {"source_entry_ref": str(row["entry_id"]), "tag": row["tag"], "source_field": row["source_field"]},
        )
        counts_exported["word_forms"] = write_jsonl_gzip(
            output / "ecdict_forms.jsonl.gz",
            connection.execute(
                "SELECT form_norm,form,lemma_norm,lemma,form_type,raw_marker,source_entry_id "
                "FROM word_forms ORDER BY source_entry_id,form_norm,form_type,raw_marker"
            ),
            lambda row: {
                "source_entry_ref": str(row["source_entry_id"]), "form_norm": row["form_norm"],
                "form": row["form"], "lemma_norm": row["lemma_norm"], "lemma": row["lemma"],
                "form_type": row["form_type"], "raw_marker": row["raw_marker"],
            },
        )
        counts_exported["ranked_headwords"] = write_jsonl_gzip(
            output / "headwords.jsonl.gz",
            connection.execute(
                "SELECT source_rank,headword,headword_norm,wordfreq_zipf,is_hyphenated,parent_norm "
                "FROM source_headwords ORDER BY source_rank"
            ),
            lambda row: {
                "source_rank": row["source_rank"], "headword": row["headword"],
                "headword_norm": row["headword_norm"], "wordfreq_zipf": row["wordfreq_zipf"],
                "is_hyphenated": bool(row["is_hyphenated"]), "parent_norm": row["parent_norm"],
            },
        )
        counts_exported["expressions"] = write_jsonl_gzip(
            output / "expressions.jsonl.gz",
            connection.execute(
                "SELECT expression_id,expression,expression_norm,attach_to,attach_to_norm,source_rank,wordfreq_zipf,handling "
                "FROM source_expressions ORDER BY expression_id"
            ),
            lambda row: {
                "source_entry_ref": str(row["expression_id"]), "expression": row["expression"],
                "expression_norm": row["expression_norm"], "attach_to": row["attach_to"],
                "attach_to_norm": row["attach_to_norm"], "source_rank": row["source_rank"],
                "wordfreq_zipf": row["wordfreq_zipf"], "handling": row["handling"],
            },
        )
        counts_exported["expression_reviews"] = write_jsonl_gzip(
            output / "expression_reviews.jsonl.gz",
            connection.execute(
                "SELECT expression_norm,expression,attach_to,reason,review_json,source_id "
                "FROM pending_expression_reviews ORDER BY expression_norm"
            ),
            lambda row: {
                "expression_norm": row["expression_norm"], "expression": row["expression"],
                "attach_to": row["attach_to"], "reason": row["reason"],
                "review_json": json_value(row["review_json"], {}), "source_id": row["source_id"],
            },
        )
        counts_exported["authored_documents"] = write_jsonl_gzip(
            output / "authored_documents.jsonl.gz",
            iter([
                *connection.execute(
                    "SELECT headword_index,headword,headword_norm,source_rank,wordfreq_zipf,entry_json "
                    "FROM enhanced_entries ORDER BY headword_index"
                ),
                *connection.execute(
                    "SELECT id,expression,expression_norm,parent_headword,lower(parent_headword) AS parent_norm,"
                    "source_rank,wordfreq_zipf,expression_json FROM enhanced_expressions ORDER BY id"
                ),
            ]),
            lambda row: (
                {
                    "document_type": "headword", "document_key": f"headword:{row['headword_norm']}",
                    "lexeme_norm": row["headword_norm"], "parent_norm": None,
                    "source_rank": row["source_rank"], "wordfreq_zipf": row["wordfreq_zipf"],
                    "content_json": json_value(row["entry_json"], {}),
                }
                if "headword_index" in row.keys()
                else {
                    "document_type": "expression", "document_key": f"expression:{row['expression_norm']}",
                    "lexeme_norm": row["expression_norm"], "parent_norm": row["parent_norm"],
                    "source_rank": row["source_rank"], "wordfreq_zipf": row["wordfreq_zipf"],
                    "content_json": json_value(row["expression_json"], {}),
                }
            ),
        )

        counts_exported["authored_senses"] = write_jsonl_gzip(
            output / "authored_senses.jsonl.gz",
            connection.execute(
                "SELECT s.headword_index,e.headword,e.headword_norm,e.source_rank,e.entry_json,s.sense_id,s.sense_index,"
                "s.part_of_speech,s.label_zh,s.definition_en,s.definition_zh,s.sense_json "
                "FROM enhanced_senses s JOIN enhanced_entries e USING(headword_index) "
                "ORDER BY s.headword_index,s.sense_index,s.sense_id"
            ),
            lambda row: {
                "document_type": "headword", "source_entry_ref": str(row["headword_index"]),
                "lexeme_norm": row["headword_norm"], "headword": row["headword"],
                "source_rank": row["source_rank"], "sense_key": row["sense_id"],
                "sense_index": row["sense_index"], "part_of_speech": row["part_of_speech"],
                "label_zh": row["label_zh"], "definition_en": row["definition_en"],
                "definition_zh": row["definition_zh"], "editorial_data": json_value(row["sense_json"], {}),
                "phonetic": (lambda pronunciation: pronunciation.get("US") or pronunciation.get("GB"))(json_value(row["entry_json"], {}).get("pronunciation", {})),
                "sense_role": "primary" if (str(row["headword_index"]), str(row["sense_id"])) in authored_primary else "supplementary",
            },
        )
        counts_exported["authored_expression_senses"] = write_jsonl_gzip(
            output / "authored_expression_senses.jsonl.gz",
            connection.execute(
                "SELECT s.expression_id,x.expression,x.expression_norm,x.parent_headword,lower(x.parent_headword) AS parent_norm,"
                "x.source_rank,s.sense_id,s.sense_index,s.part_of_speech,s.label_zh,s.definition_en,s.definition_zh,s.sense_json "
                "FROM enhanced_expression_senses s JOIN enhanced_expressions x ON x.id=s.expression_id "
                "ORDER BY s.expression_id,s.sense_index,s.sense_id"
            ),
            lambda row: {
                "document_type": "expression", "source_entry_ref": str(row["expression_id"]),
                "lexeme_norm": row["expression_norm"], "headword": row["expression"],
                "parent_norm": row["parent_norm"], "source_rank": row["source_rank"],
                "sense_key": row["sense_id"], "sense_index": row["sense_index"],
                "part_of_speech": row["part_of_speech"], "label_zh": row["label_zh"],
                "definition_en": row["definition_en"], "definition_zh": row["definition_zh"],
                "editorial_data": json_value(row["sense_json"], {}),
                "phonetic": (lambda expression: expression.get("phonetic"))(json_value(row["sense_json"], {})),
                "sense_role": "primary" if (str(row["expression_id"]), str(row["sense_id"])) in expression_primary else "supplementary",
            },
        )
    finally:
        connection.close()

    expected_exported = {
        "ecdict_entries": EXPECTED["ecdict_entries"],
        "ecdict_tags": EXPECTED["ecdict_tags"],
        "word_forms": EXPECTED["word_forms"],
        "ranked_headwords": EXPECTED["source_headwords"],
        "expressions": EXPECTED["source_expressions"],
        "expression_reviews": EXPECTED["pending_expression_reviews"],
        "authored_documents": EXPECTED["enhanced_entries"] + EXPECTED["enhanced_expressions"],
        "authored_senses": EXPECTED["enhanced_senses"],
        "authored_expression_senses": EXPECTED["enhanced_expression_senses"],
    }
    mismatches = {
        key: {"actual": counts_exported.get(key), "expected": expected}
        for key, expected in expected_exported.items()
        if counts_exported.get(key) != expected
    }
    if mismatches:
        raise ValueError(f"Exported counts do not match the SQLite source: {mismatches}")

    source_root = database.parent.parent
    manifest = {
        "format": "cadence-dictionary-foundation-v2",
        "created_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_database_sha256": sha256_file(database),
        "source_hashes": source_hashes,
        "sources": sources,
        "source_ids": SOURCE_IDS,
        "authored_mapping": {
            "headword_senses": "lexicon_entries.sense",
            "headword_usage_notes": "lexicon_entries.usage_note",
            "expression_senses": "lexicon_documents.content_json.senses",
            "expression_usage_notes": "lexicon_documents.content_json.senses[].usage_notes",
            "expressions_are_independent_senses": False,
        },
        "expected": {
            "lexemes": counts_exported["lexemes"],
            "authored_headwords": EXPECTED["enhanced_entries"],
            "authored_expressions": EXPECTED["enhanced_expressions"],
            "ecdict_entries": counts_exported["ecdict_entries"],
            "ecdict_tags": counts_exported["ecdict_tags"],
            "word_forms": counts_exported["word_forms"],
            "ranked_headwords": counts_exported["ranked_headwords"],
            "expressions": counts_exported["expressions"],
            "expression_reviews": counts_exported["expression_reviews"],
            "authored_documents": counts_exported["authored_documents"],
            "authored_senses": counts_exported["authored_senses"],
            "authored_expression_senses": counts_exported["authored_expression_senses"],
            **authored_usage_notes,
        },
        "local_sqlite_counts": counts,
        "files": {},
    }
    for name in FILES:
        path = output / name
        manifest["files"][name] = {"bytes": path.stat().st_size, "sha256": sha256_file(path)}
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    archive = output / "Cadence_dictionary_foundation_2026-11-08.zip"
    temporary_archive = archive.with_suffix(".zip.tmp")
    with zipfile.ZipFile(temporary_archive, "w", compression=zipfile.ZIP_STORED) as bundle:
        bundle.write(manifest_path, "manifest.json")
        for name in FILES:
            bundle.write(output / name, name)
    temporary_archive.replace(archive)
    (output / "SHA256SUMS.txt").write_text(
        "\n".join(f"{sha256_file(output / name)}  {name}" for name in ["manifest.json", *FILES, archive.name]) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(output), "archive": str(archive), "archive_bytes": archive.stat().st_size, "archive_sha256": sha256_file(archive), "expected": manifest["expected"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
