import { execSync } from "child_process";
import { rm, mkdir } from "fs/promises";
import { build as esbuild } from "esbuild";

async function buildAll() {
  await rm("dist", { recursive: true, force: true });
  await mkdir("dist", { recursive: true });

  // Always regenerate the Prisma client against the current schema before
  // building. This guarantees the generated types match prisma/schema.prisma
  // even when the deploy reuses a cached node_modules (otherwise a stale client
  // breaks the TypeScript build, e.g. "Property 'acordDraft' does not exist").
  console.log("Generating Prisma client...");
  execSync("npx prisma generate", { stdio: "inherit" });

  console.log("Building Next.js app...");
  execSync("npx next build", { stdio: "inherit" });

  console.log("Building server entry point...");
  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: false,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    logLevel: "info",
  });

  console.log("Build completed successfully!");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
