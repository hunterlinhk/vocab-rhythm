import { createHash, timingSafeEqual } from "node:crypto";

export function authenticateCronRequest(request: Request): Response | null {
  const currentSecret = process.env["CRON_SECRET"];
  const previousSecret = process.env["CRON_SECRET_PREVIOUS"];
  if (!currentSecret) return new Response("Server configuration error", { status: 500 });

  const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return new Response("Unauthorized", { status: 401 });

  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  const provided = digest(token);
  const currentMatches = timingSafeEqual(provided, digest(currentSecret));
  const previousMatches = timingSafeEqual(provided, digest(previousSecret ?? currentSecret));
  if (!currentMatches && !previousMatches) return new Response("Unauthorized", { status: 401 });
  return null;
}
