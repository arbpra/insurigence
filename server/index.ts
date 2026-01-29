import { execSync } from "child_process";

const port = parseInt(process.env.PORT || "5000", 10);
const isProduction = process.env.NODE_ENV === "production";

console.log(`Starting Next.js in ${isProduction ? "production" : "development"} mode on port ${port}...`);

const nextCommand = isProduction ? "start" : "dev";
const cmd = `npx next ${nextCommand} -p ${port} -H 0.0.0.0`;

console.log(`Running: ${cmd}`);

try {
  execSync(cmd, { 
    cwd: process.cwd(), 
    stdio: "inherit",
    env: { ...process.env }
  });
} catch (error) {
  console.error("Failed to start Next.js:", error);
  process.exit(1);
}
