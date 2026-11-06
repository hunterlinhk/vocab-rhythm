# Repository rules

- Do not rewrite published Git history or force-push branches.
- The application runs on Node.js with TanStack Start, Better Auth, Drizzle ORM, and PostgreSQL.
- Keep database migrations explicit; production startup must not apply migrations or import vocabulary data.
- Preserve the existing learning UI, scheduler behavior, and vocabulary source records unless the task requires a scoped change.
