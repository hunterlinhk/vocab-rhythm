import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));

export function createTestViteServer() {
  return createServer({
    configFile: false,
    root,
    resolve: { alias: { "@": resolve(root, "src") } },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    logLevel: "error",
  });
}
