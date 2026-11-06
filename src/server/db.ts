import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "../../drizzle/schema";

let connection: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDatabase() {
  if (database) return database;
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");
  const poolSize = Number(process.env["DB_POOL_SIZE"] ?? 5);
  if (!Number.isInteger(poolSize) || poolSize < 1 || poolSize > 50)
    throw new Error("DB_POOL_SIZE must be an integer between 1 and 50");
  connection = postgres(url, {
    max: poolSize,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  database = drizzle(connection, { schema });
  return database;
}

export async function closeDatabase() {
  const current = connection;
  connection = undefined;
  database = undefined;
  if (current) await current.end({ timeout: 5 });
}
