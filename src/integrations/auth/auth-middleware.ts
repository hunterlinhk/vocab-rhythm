import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth } from "../../server/auth";
import { getDatabase } from "../../server/db";
import { createUserStore } from "../../server/user-store";

export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) throw new Error("Unauthorized");
  return next({
    context: {
      userId: session.user.id,
      user: session.user,
      db: createUserStore(getDatabase(), session.user.id),
    },
  });
});
