import source from "./ngsl-1.2-stats.csv?raw";
import { NGSL_LEARNING_DATA } from "./ngsl-1.2-learning";
import type { WordEntry } from "./words";

export const NGSL_BOOK_ID = "ngsl-1.2";
export const NGSL_SOURCE = {
  title: "New General Service List 1.2 with basic statistics",
  authors: "Browne, C., Culligan, B., and Phillips, J.",
  url: "https://www.newgeneralservicelist.com/new-general-service-list",
  downloadUrl: "https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
} as const;

const [header, ...rows] = source.trim().split(/\r?\n/);
if (header !== "Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)" || rows.length !== 2809) {
  throw new Error("Unexpected NGSL 1.2 source format or entry count");
}

/** The published CSV is the source of truth; optional study content lives in a separate overlay. */
export const NGSL_WORDS: WordEntry[] = rows.map((line, index) => {
  const [word, rankText, sfiText, frequencyText] = line.replace(/\r/g, "").split(",");
  const rank = Number(rankText);
  const sfi = Number(sfiText);
  const frequencyPerMillion = Number(frequencyText);
  if (
    !word ||
    rank !== index + 1 ||
    !Number.isFinite(sfi) ||
    !Number.isFinite(frequencyPerMillion)
  ) {
    throw new Error(`Invalid NGSL 1.2 source row: ${line}`);
  }
  const learning = NGSL_LEARNING_DATA[word] ?? {};
  const subject = learning.subject ?? learning.svo?.s;
  const verb = learning.verb ?? learning.svo?.v;
  const object = learning.object ?? learning.svo?.o;
  return {
    word,
    bookId: NGSL_BOOK_ID,
    rank,
    sfi,
    frequencyPerMillion,
    ...learning,
    subject,
    verb,
    object,
    svo: learning.svo ?? (subject && verb ? { s: subject, v: verb, o: object } : undefined),
  };
});
