import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPickForUsServer, parseLlmMode } from "./app.js";

async function main(): Promise<void> {
  const envFile = path.resolve(process.cwd(), ".env");
  if (existsSync(envFile) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envFile);
  }
  const isProd = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
  const port = Number(process.env.PORT ?? 3000);
  const llmMode = parseLlmMode(process.env.PICKFORUS_LLM_MODE);

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const distFromCompiled = path.resolve(currentDir, "../client");
  const distFromCwd = path.resolve(process.cwd(), "dist/client");
  const distClientDir = existsSync(distFromCompiled) ? distFromCompiled : distFromCwd;

  const server = createPickForUsServer({
    llmMode,
    ...(isProd ? { distClientDir } : {}),
  });

  let closeVite: (() => Promise<void>) | undefined;
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: server.httpServer,
          path: "/__vite_hmr",
        },
      },
      appType: "spa",
    });
    server.app.use(vite.middlewares);
    closeVite = async () => {
      await vite.close();
    };
  }

  await new Promise<void>((resolve) => {
    server.httpServer.listen(port, () => {
      resolve();
    });
  });

  console.log(
    `PickForUs listening on http://localhost:${port} (llmMode=${llmMode}, env=${isProd ? "prod" : "dev"})`,
  );

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (closeVite !== undefined) {
      await closeVite();
    }
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((error: unknown) => {
  console.error("Failed to start PickForUs server:", error);
  process.exit(1);
});
