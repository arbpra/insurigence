import { execSync } from "child_process";
import { rm, mkdir } from "fs/promises";
import { build as esbuild } from "esbuild";

async function buildAll() {
  await rm("dist", { recursive: true, force: true });
  await mkdir("dist", { recursive: true });

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
