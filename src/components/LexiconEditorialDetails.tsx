import type { WordEntry } from "@/data/words";

export function LexiconEditorialDetails({
  entry,
}: {
  entry: Pick<WordEntry, "additionalSenses" | "usageNotes">;
}) {
  const senses = entry.additionalSenses ?? [];
  const notes = entry.usageNotes ?? [];
  if (!senses.length && !notes.length) return null;

  return (
    <div className="mt-3 flex w-full max-w-lg flex-col gap-2 text-left">
      {senses.map((sense) => (
        <section
          key={`${sense.sourceId}:${sense.senseKey}`}
          className="rounded-xl border border-border/60 bg-card/45 px-3 py-2"
        >
          <p className="text-xs font-medium text-muted-foreground">补充义项</p>
          {(sense.partOfSpeech || sense.translation) && (
            <p className="mt-1 text-sm text-foreground">
              {sense.partOfSpeech && (
                <span className="mr-1 text-muted-foreground">{sense.partOfSpeech}</span>
              )}
              {sense.translation}
            </p>
          )}
          {sense.definitionEn && (
            <p className="mt-1 text-xs text-muted-foreground">{sense.definitionEn}</p>
          )}
        </section>
      ))}
      {notes.map((note) => (
        <section
          key={`${note.sourceId}:${note.relatedSenseKey ?? note.text}`}
          className="rounded-xl border border-border/60 bg-card/45 px-3 py-2"
        >
          <p className="text-xs font-medium text-muted-foreground">用法说明</p>
          <p className="mt-1 text-sm text-foreground">{note.text}</p>
        </section>
      ))}
    </div>
  );
}
