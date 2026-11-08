import type { WordEntry } from "@/data/words";
import type { LexiconSense } from "@/data/words";

export function LexiconEditorialDetails({
  entry,
}: {
  entry: Pick<WordEntry, "additionalSenses" | "usageNotes" | "primarySenseDetails" | "dictionarySource" | "extendedExpressions">;
}) {
  const senses = entry.additionalSenses ?? [];
  const notes = entry.usageNotes ?? [];
  const primary = entry.primarySenseDetails;
  const dictionarySource = entry.dictionarySource;
  const expressions = entry.extendedExpressions ?? [];
  if (!senses.length && !notes.length && !primary && !dictionarySource && !expressions.length) return null;

  const examples = (title: string, rows: { en: string; zh?: string | undefined }[] | undefined) =>
    rows?.length ? (
      <div className="mt-2">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        {rows.map((example, index) => (
          <p key={`${title}:${index}`} className="mt-1 text-sm text-foreground">
            {example.en}
            {example.zh && <span className="ml-2 text-muted-foreground">{example.zh}</span>}
          </p>
        ))}
      </div>
    ) : null;

  const senseDetails = (sense: LexiconSense, fallbackPos?: string) => (
    <div key={`${sense.sourceId}:${sense.senseKey}`} className="mt-3 border-t border-border/50 pt-2 first:mt-0 first:border-0 first:pt-0">
      {(sense.partOfSpeech || fallbackPos || sense.labelZh) && (
        <p className="text-sm font-medium text-foreground">
          {[sense.partOfSpeech || fallbackPos, sense.labelZh].filter(Boolean).join(" · ")}
        </p>
      )}
      {sense.definitionEn && <p className="mt-1 text-sm text-muted-foreground">{sense.definitionEn}</p>}
      {(sense.definitionZh || sense.translation) && <p className="mt-1 text-sm text-foreground">{sense.definitionZh || sense.translation}</p>}
      {examples("理解例句", sense.understandingExamples)}
      {examples("运用例句", sense.usageExamples)}
      {list("常见搭配", sense.collocations)}
      {list("句型", sense.patterns)}
      {list("用法说明", sense.usageNotes)}
    </div>
  );

  const list = (title: string, rows: string[] | undefined) =>
    rows?.length ? (
      <p className="mt-2 text-sm text-foreground">
        <span className="font-medium text-muted-foreground">{title}：</span>{rows.join("；")}
      </p>
    ) : null;

  return (
    <div className="mt-3 flex w-full max-w-lg flex-col gap-2 text-left">
      {primary && (
        <details className="rounded-xl border border-border/60 bg-card/45 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">精编词义详情</summary>
          <div className="mt-2">
            {(primary.labelZh || primary.partOfSpeech) && (
              <p className="text-sm font-medium text-foreground">
                {[primary.partOfSpeech, primary.labelZh].filter(Boolean).join(" · ")}
              </p>
            )}
            {primary.definitionEn && <p className="mt-1 text-sm text-muted-foreground">{primary.definitionEn}</p>}
            {primary.definitionZh && <p className="mt-1 text-sm text-foreground">{primary.definitionZh}</p>}
            {examples("理解例句", primary.understandingExamples)}
            {examples("运用例句", primary.usageExamples)}
            {list("常见搭配", primary.collocations)}
            {list("句型", primary.patterns)}
            {list("用法说明", primary.usageNotes)}
            {primary.pitfalls?.map((pitfall, index) => (
              <p key={`pitfall:${index}`} className="mt-2 text-sm text-foreground">
                <span className="font-medium text-muted-foreground">易错点：</span>
                {String(pitfall["explanation"] ?? pitfall["incorrect"] ?? pitfall["correction"] ?? "")}
              </p>
            ))}
          </div>
        </details>
      )}
      {senses.map((sense) => (
        <section
          key={`${sense.sourceId}:${sense.senseKey}`}
          className="rounded-xl border border-border/60 bg-card/45 px-3 py-2"
        >
          <p className="text-xs font-medium text-muted-foreground">补充义项</p>
          {(sense.partOfSpeech || sense.labelZh || sense.definitionZh || sense.translation) && (
            <p className="mt-1 text-sm text-foreground">
              {sense.partOfSpeech && (
                <span className="mr-1 text-muted-foreground">{sense.partOfSpeech}</span>
              )}
              {sense.labelZh && <span className="mr-1">{sense.labelZh}</span>}
              {!sense.definitionZh && sense.translation}
            </p>
          )}
          {sense.definitionEn && (
            <p className="mt-1 text-xs text-muted-foreground">{sense.definitionEn}</p>
          )}
          {sense.definitionZh && <p className="mt-1 text-sm text-foreground">{sense.definitionZh}</p>}
          {examples("理解例句", sense.understandingExamples)}
          {examples("运用例句", sense.usageExamples)}
          {list("常见搭配", sense.collocations)}
          {list("句型", sense.patterns)}
          {list("用法说明", sense.usageNotes)}
        </section>
      ))}
      {expressions.length > 0 && (
        <details className="rounded-xl border border-border/60 bg-card/45 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">固定搭配与拓展表达（{expressions.length}）</summary>
          <div className="mt-2">
            {expressions.map((expression) => (
              <section key={expression.expression} className="mt-3 first:mt-0">
                <h4 className="text-sm font-semibold text-foreground">{expression.expression}</h4>
                {expression.senses.map((sense) => senseDetails(sense, expression.partOfSpeech))}
              </section>
            ))}
          </div>
        </details>
      )}
      {notes.map((note) => (
        <section
          key={`${note.sourceId}:${note.relatedSenseKey ?? note.text}`}
          className="rounded-xl border border-border/60 bg-card/45 px-3 py-2"
        >
          <p className="text-xs font-medium text-muted-foreground">用法说明</p>
          {(note.relatedPartOfSpeech || note.relatedTranslation) && (
            <p className="mt-1 text-xs text-muted-foreground">
              对应义项：{[note.relatedPartOfSpeech, note.relatedTranslation].filter(Boolean).join(" ")}
            </p>
          )}
          <p className="mt-1 text-sm text-foreground">{note.text}</p>
        </section>
      ))}
      {dictionarySource && (
        <details className="rounded-xl border border-border/60 bg-card/45 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">基础词库候选释义</summary>
          <div className="mt-2">
            {dictionarySource.partOfSpeechCandidates.length > 0 && (
              <p className="text-xs text-muted-foreground">
                词性线索：{dictionarySource.partOfSpeechCandidates.join(" / ")}
              </p>
            )}
            {dictionarySource.translationCandidatesZh.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-muted-foreground">中文候选</p>
                {dictionarySource.translationCandidatesZh.map((value, index) => (
                  <p key={`zh:${index}`} className="mt-1 text-sm text-foreground">{value}</p>
                ))}
              </div>
            )}
            {dictionarySource.definitionCandidatesEn.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-muted-foreground">英文候选</p>
                {dictionarySource.definitionCandidatesEn.map((value, index) => (
                  <p key={`en:${index}`} className="mt-1 text-sm text-muted-foreground">{value}</p>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">英释与中译按原始列表分别显示，不表示逐条对应。</p>
          </div>
        </details>
      )}
    </div>
  );
}
