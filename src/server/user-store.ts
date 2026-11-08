import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";
import { schema } from "../../drizzle/schema";

type TableName = keyof typeof schema;
type Db = any;
type Filter = { field: string; operator: string; value: unknown };
type QueryResult = { data: any; error: { code?: string; message: string } | null; count?: number | null };

const physicalTables: Record<string, TableName> = {
  account: "account",
  assistant_messages: "assistantMessages",
  attempts: "attempts",
  book_progress: "bookProgress",
  dictionary_expression_links: "dictionaryExpressionLinks",
  dictionary_headwords: "dictionaryHeadwords",
  dictionary_source_entries: "dictionarySourceEntries",
  dictionary_source_forms: "dictionarySourceForms",
  dictionary_source_tags: "dictionarySourceTags",
  lexemes: "lexemes",
  lexicon_entries: "lexiconEntries",
  lexicon_documents: "lexiconDocuments",
  lexicon_sources: "lexiconSources",
  profiles: "profiles",
  review_schedule_decisions: "reviewScheduleDecisions",
  review_session_results: "reviewSessionResults",
  review_states: "reviewStates",
  session: "session",
  user: "user",
  user_book_review_settings: "userBookReviewSettings",
  user_settings: "userSettings",
  verification: "verification",
  word_books: "wordBooks",
  word_entries: "wordEntries",
  word_mastery: "wordMastery",
};

const userOwnedTables = new Set([
  "assistantMessages",
  "attempts",
  "bookProgress",
  "reviewScheduleDecisions",
  "reviewSessionResults",
  "reviewStates",
  "userBookReviewSettings",
  "userSettings",
  "wordMastery",
]);

function physicalField(table: any, name: string): any {
  const column = Object.values(getTableColumns(table)).find((candidate: any) => candidate.name === name);
  if (!column) throw new Error(`Unknown database field ${name}`);
  return column;
}

function valueFor(column: any, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (column.dataType === "boolean" && typeof value === "string") return value === "true";
  if (column.dataType === "number" && typeof value === "string") return Number(value);
  if (column.columnType?.includes("Timestamp") && typeof value === "string") return new Date(value);
  return value;
}

function mapInput(table: any, row: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(getTableColumns(table)) as [string, any][];
  const mapped: Record<string, unknown> = {};
  for (const [physical, value] of Object.entries(row)) {
    const entry = entries.find(([, column]) => column.name === physical);
    if (!entry) throw new Error(`Unknown database field ${physical}`);
    mapped[entry[0]] = valueFor(entry[1], value);
  }
  return mapped;
}

function outputRows(rows: Record<string, unknown>[]) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([name, value]) => [name, value instanceof Date ? value.toISOString() : value]),
    ),
  );
}

function parseOr(value: string) {
  const clauses = value.split(",").map((part) => {
    const match = /^([^.]+)\.(eq|neq|gt|gte|lt|lte)\.(.*)$/.exec(part);
    if (!match) throw new Error(`Unsupported OR filter: ${part}`);
    return { field: match[1]!, operator: match[2]!, value: match[3]! };
  });
  return clauses;
}

class UserQuery {
  private operation: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private selection = "*";
  private hasSelection = false;
  private values: Record<string, unknown>[] = [];
  private patch: Record<string, unknown> = {};
  private filters: Filter[] = [];
  private orFilters: Filter[][] = [];
  private orderings: { field: string; ascending: boolean }[] = [];
  private maxRows: number | undefined;
  private offsetRows = 0;
  private cardinality: "single" | "maybeSingle" | undefined;
  private conflictColumns: string[] = [];
  private ignoreDuplicates = false;
  private countRequested = false;
  private headOnly = false;

  constructor(
    private readonly db: Db,
    private readonly tableName: TableName,
    private readonly userId: string,
  ) {}

  select(columns = "*", options: { count?: string; head?: boolean } = {}) {
    this.selection = columns;
    this.hasSelection = true;
    this.countRequested = options.count === "exact";
    this.headOnly = options.head === true;
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    this.operation = "insert";
    this.values = (Array.isArray(values) ? values : [values]).map((value) => ({ ...value }));
    return this;
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options: { onConflict?: string; ignoreDuplicates?: boolean } = {},
  ) {
    this.operation = "upsert";
    this.values = (Array.isArray(values) ? values : [values]).map((value) => ({ ...value }));
    this.conflictColumns = (options.onConflict ?? "").split(",").filter(Boolean);
    this.ignoreDuplicates = options.ignoreDuplicates === true;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.operation = "update";
    this.patch = { ...values };
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(field: string, value: unknown) { return this.addFilter(field, "eq", value); }
  neq(field: string, value: unknown) { return this.addFilter(field, "neq", value); }
  gt(field: string, value: unknown) { return this.addFilter(field, "gt", value); }
  gte(field: string, value: unknown) { return this.addFilter(field, "gte", value); }
  lt(field: string, value: unknown) { return this.addFilter(field, "lt", value); }
  lte(field: string, value: unknown) { return this.addFilter(field, "lte", value); }
  like(field: string, value: string) { return this.addFilter(field, "like", value); }

  in(field: string, values: unknown[]) {
    this.filters.push({ field, operator: "in", value: values });
    return this;
  }

  is(field: string, value: unknown) {
    this.filters.push({ field, operator: "is", value });
    return this;
  }

  not(field: string, operator: string, value: unknown) {
    this.filters.push({ field, operator: `not_${operator}`, value });
    return this;
  }

  or(value: string) {
    this.orFilters.push(parseOr(value));
    return this;
  }

  order(field: string, options: { ascending?: boolean } = {}) {
    this.orderings.push({ field, ascending: options.ascending ?? true });
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  range(from: number, to: number) {
    this.offsetRows = from;
    this.maxRows = Math.max(0, to - from + 1);
    return this;
  }

  single() {
    this.cardinality = "single";
    return this.run();
  }

  maybeSingle() {
    this.cardinality = "maybeSingle";
    return this.run();
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.run().then(onfulfilled, onrejected);
  }

  private addFilter(field: string, operator: string, value: unknown) {
    this.filters.push({ field, operator, value });
    return this;
  }

  private condition(filter: Filter) {
    const table = schema[this.tableName] as any;
    const column = physicalField(table, filter.field);
    const value = valueFor(column, filter.value);
    switch (filter.operator) {
      case "eq": return value === null ? isNull(column) : eq(column, value);
      case "neq": return value === null ? isNotNull(column) : ne(column, value);
      case "gt": return gt(column, value);
      case "gte": return gte(column, value);
      case "lt": return lt(column, value);
      case "lte": return lte(column, value);
      case "in": return (filter.value as unknown[]).length ? inArray(column, filter.value as any[]) : sql`false`;
      case "is": return value === null ? isNull(column) : eq(column, value);
      case "not_is": return value === null ? isNotNull(column) : not(eq(column, value));
      case "like": return like(column, String(value));
      default: throw new Error(`Unsupported database filter: ${filter.operator}`);
    }
  }

  private scopeCondition() {
    const table = schema[this.tableName] as any;
    const name = this.tableName;
    if (userOwnedTables.has(name)) return eq(physicalField(table, "user_id"), this.userId);
    if (name === "profiles") return eq(physicalField(table, "id"), this.userId);
    if (name === "wordBooks") {
      const owner = eq(physicalField(table, "owner_user_id"), this.userId);
      return this.operation === "select"
        ? or(eq(physicalField(table, "source"), "official"), owner)
        : and(eq(physicalField(table, "source"), "custom"), owner);
    }
    if (name === "wordEntries") {
      const books = schema.wordBooks as any;
      const ownerCondition = this.operation === "select"
        ? or(eq(books.source, "official"), eq(books.ownerUserId, this.userId))
        : and(eq(books.source, "custom"), eq(books.ownerUserId, this.userId));
      return exists(this.db.select({ id: books.id }).from(books).where(and(eq(books.id, table.bookId), ownerCondition)));
    }
    if (name === "lexiconSources" && this.operation === "select")
      return eq(physicalField(table, "access_tier"), "public");
    if (
      [
        "dictionaryExpressionLinks",
        "dictionaryHeadwords",
        "dictionarySourceEntries",
        "dictionarySourceForms",
        "dictionarySourceTags",
      ].includes(name) && this.operation === "select"
    ) {
      const sources = schema.lexiconSources as any;
      return exists(
        this.db
          .select({ id: sources.id })
          .from(sources)
          .where(and(eq(sources.id, table.sourceId), eq(sources.accessTier, "public"))),
      );
    }
    if (name === "lexiconEntries" && this.operation === "select") {
      const sources = schema.lexiconSources as any;
      return and(
        eq(physicalField(table, "publication_status"), "published"),
        exists(this.db.select({ id: sources.id }).from(sources).where(and(eq(sources.id, table.sourceId), eq(sources.accessTier, "public")))),
      );
    }
    if (name === "lexiconDocuments" && this.operation === "select") {
      const sources = schema.lexiconSources as any;
      return and(
        eq(physicalField(table, "publication_status"), "published"),
        exists(
          this.db
            .select({ id: sources.id })
            .from(sources)
            .where(and(eq(sources.id, table.sourceId), eq(sources.accessTier, "public"))),
        ),
      );
    }
    if (name === "lexemes" && this.operation === "select") return undefined;
    throw new Error(`Table ${name} is not accessible to an authenticated user`);
  }

  private where() {
    const table = schema[this.tableName] as any;
    const conditions: any[] = [];
    const scope = this.scopeCondition();
    if (scope) conditions.push(scope);
    conditions.push(...this.filters.map((filter) => this.condition(filter)));
    for (const group of this.orFilters)
      conditions.push(or(...group.map((filter) => this.condition(filter))));
    return conditions.length ? and(...conditions) : undefined;
  }

  private selectionShape() {
    const table = schema[this.tableName] as any;
    const columns = getTableColumns(table) as Record<string, any>;
    if (this.selection.trim() === "*")
      return Object.fromEntries(Object.values(columns).map((column) => [column.name, column]));
    return Object.fromEntries(
      this.selection.split(",").map((field) => {
        const name = field.trim();
        return [name, physicalField(table, name)];
      }),
    );
  }

  private async validateWrites() {
    if (this.operation === "insert" || this.operation === "upsert") {
      if (!this.values.length) throw new Error("Cannot write an empty row set");
      if (userOwnedTables.has(this.tableName)) {
        for (const row of this.values) {
          if (row["user_id"] !== undefined && row["user_id"] !== this.userId)
            throw new Error("A user cannot write another user's data");
          row["user_id"] = this.userId;
        }
      }
      if (this.tableName === "profiles") {
        for (const row of this.values) {
          if (row["id"] !== undefined && row["id"] !== this.userId)
            throw new Error("A user cannot write another user's profile");
          row["id"] = this.userId;
        }
      }
      if (this.tableName === "wordBooks") {
        for (const row of this.values) {
          if (row["source"] !== "custom" || (row["owner_user_id"] && row["owner_user_id"] !== this.userId))
            throw new Error("A user can only create a custom book for their own account");
          row["source"] = "custom";
          row["owner_user_id"] = this.userId;
        }
      }
      if (this.tableName === "wordEntries") {
        const bookIds = [...new Set(this.values.map((row) => String(row["book_id"] ?? "")))];
        const books = schema.wordBooks as any;
        const owned = await this.db
          .select({ id: books.id })
          .from(books)
          .where(and(inArray(books.id, bookIds), eq(books.source, "custom"), eq(books.ownerUserId, this.userId)));
        if (owned.length !== bookIds.length) throw new Error("A user can only add entries to their own custom books");
      }
      if (!["wordBooks", "wordEntries", "userSettings", "bookProgress", "wordMastery", "userBookReviewSettings", "attempts", "assistantMessages", "reviewSessionResults", "reviewScheduleDecisions", "reviewStates", "profiles"].includes(this.tableName))
        throw new Error(`Writes are not allowed for ${this.tableName}`);
    }
    if (this.operation === "update" || this.operation === "delete") {
      if (!this.filters.length && !this.orFilters.length)
        throw new Error("Updates and deletes require an explicit row filter");
      if (!["wordBooks", "wordEntries", "userSettings", "bookProgress", "wordMastery", "userBookReviewSettings", "attempts", "assistantMessages", "reviewSessionResults", "reviewScheduleDecisions", "reviewStates", "profiles"].includes(this.tableName))
        throw new Error(`Writes are not allowed for ${this.tableName}`);
    }
    if (this.operation === "update") {
      const protectedFields = userOwnedTables.has(this.tableName)
        ? ["user_id"]
        : this.tableName === "profiles"
          ? ["id"]
          : this.tableName === "wordBooks"
            ? ["owner_user_id", "source"]
            : this.tableName === "wordEntries"
              ? ["book_id"]
              : [];
      if (protectedFields.some((field) => Object.hasOwn(this.patch, field)))
        throw new Error("Ownership and source fields cannot be changed");
    }
  }

  private returningData(rows: Record<string, unknown>[]) {
    if (!this.cardinality) return rows;
    if (rows.length > 1) throw Object.assign(new Error("Expected one row"), { code: "ROW_CARDINALITY" });
    if (!rows.length && this.cardinality === "single")
      throw Object.assign(new Error("Expected one row"), { code: "ROW_CARDINALITY" });
    return rows[0] ?? null;
  }

  private conflictTarget(table: any) {
    return this.conflictColumns.map((name) => physicalField(table, name));
  }

  private async run(): Promise<QueryResult> {
    try {
      const table = schema[this.tableName] as any;
      await this.validateWrites();
      const where = this.where();
      if (this.operation === "select") {
        let exactCount: number | undefined;
        if (this.countRequested) {
          const [result] = await this.db.select({ value: count() }).from(table).where(where);
          exactCount = Number(result?.value ?? 0);
        }
        if (this.headOnly) return { data: null, error: null, count: exactCount ?? 0 };
        let query = this.db.select(this.selectionShape()).from(table).where(where);
        if (this.orderings.length)
          query = query.orderBy(...this.orderings.map(({ field, ascending }) => {
            const column = physicalField(table, field);
            return ascending ? asc(column) : desc(column);
          }));
        if (this.cardinality) query = query.limit(2);
        else if (this.maxRows !== undefined) query = query.limit(this.maxRows);
        if (this.offsetRows) query = query.offset(this.offsetRows);
        const rows = outputRows(await query);
        if (this.cardinality) {
          if (rows.length > 1) throw Object.assign(new Error("Expected one row"), { code: "ROW_CARDINALITY" });
          if (!rows.length && this.cardinality === "single")
            throw Object.assign(new Error("Expected one row"), { code: "ROW_CARDINALITY" });
          return { data: rows[0] ?? null, error: null, ...(exactCount === undefined ? {} : { count: exactCount }) };
        }
        return { data: rows, error: null, ...(exactCount === undefined ? {} : { count: exactCount }) };
      }

      const mappedValues = this.values.map((row) => mapInput(table, row));
      const returning = this.selectionShape();
      const shouldReturn = this.hasSelection;
      if (this.operation === "insert") {
        let query = this.db.insert(table).values(mappedValues);
        const rows = shouldReturn ? outputRows(await query.returning(returning)) : (await query, null);
        return { data: rows === null ? null : this.returningData(rows), error: null };
      }
      if (this.operation === "upsert") {
        let query = this.db.insert(table).values(mappedValues);
        if (this.conflictColumns.length) {
          const target = this.conflictTarget(table);
          if (this.ignoreDuplicates) query = query.onConflictDoNothing({ target });
          else {
            const excluded = mapInput(table, this.values[0]!);
            const keys = Object.keys(excluded).filter(
              (key) => !this.conflictColumns.includes((getTableColumns(table) as any)[key].name),
            );
            query = query.onConflictDoUpdate({
              target,
              set: Object.fromEntries(
                keys.map((key) => {
                  const column = (getTableColumns(table) as any)[key];
                  return [key, sql`excluded.${sql.identifier(column.name)}`];
                }),
              ),
              setWhere: this.scopeCondition(),
            });
          }
        }
        const rows = shouldReturn ? outputRows(await query.returning(returning)) : (await query, null);
        return { data: rows === null ? null : this.returningData(rows), error: null };
      }
      if (this.operation === "update") {
        let query = this.db.update(table).set(mapInput(table, this.patch)).where(where);
        const rows = shouldReturn ? outputRows(await query.returning(returning)) : (await query, null);
        return { data: rows === null ? null : this.returningData(rows), error: null };
      }
      let query = this.db.delete(table).where(where);
      const rows = shouldReturn ? outputRows(await query.returning(returning)) : (await query, null);
      return { data: rows === null ? null : this.returningData(rows), error: null };
    } catch (error) {
      const value = error as { code?: string; message?: string };
      return {
        data: null,
        error: { ...(value.code ? { code: value.code } : {}), message: value.message ?? String(error) },
      };
    }
  }
}

export function createUserStore(db: Db, userId: string) {
  return {
    table(name: string) {
      const table = physicalTables[name];
      if (!table) throw new Error(`Unknown database table ${name}`);
      return new UserQuery(db, table, userId);
    },
    async todayPracticeCount(timeZone: string) {
      const table = schema.attempts;
      const localDay = sql`(now() at time zone ${timeZone})::date`;
      const start = sql`(${localDay}::timestamp at time zone ${timeZone})`;
      const end = sql`((${localDay} + 1)::timestamp at time zone ${timeZone})`;
      const [result] = await db.select({ value: count() }).from(table).where(and(
        eq(table.userId, userId),
        eq(table.skipped, false),
        gte(table.createdAt, start),
        lt(table.createdAt, end),
      ));
      return Number(result?.value ?? 0);
    },
  };
}

export type UserStore = ReturnType<typeof createUserStore>;
