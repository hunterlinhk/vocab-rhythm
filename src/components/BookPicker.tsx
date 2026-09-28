import { cn } from "@/lib/utils";

type BookPickerOption = { id: string; name: string };

export function BookPicker({
  books,
  selectedBookId,
  onSelect,
}: {
  books: BookPickerOption[];
  selectedBookId: string | null;
  onSelect: (bookId: string) => void;
}) {
  return (
    <div role="group" aria-label="选择词书" className="flex flex-wrap items-center gap-1.5">
      {books.map((book) => (
        <button
          key={book.id}
          type="button"
          onClick={() => onSelect(book.id)}
          aria-pressed={book.id === selectedBookId}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
            book.id === selectedBookId
              ? "border-primary/40 bg-card text-foreground shadow-sm"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {book.name}
        </button>
      ))}
    </div>
  );
}
