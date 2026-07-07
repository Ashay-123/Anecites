import { spawnSync } from "node:child_process";

const safeArgumentPattern = /^[a-zA-Z0-9_:@./\\=-]+$/;
const prismaArgs = process.argv.slice(2);

if (prismaArgs.length === 0) {
  console.error("Usage: node scripts/run-prisma.mjs <prisma-args>");
  process.exit(2);
}

for (const argument of prismaArgs) {
  if (!safeArgumentPattern.test(argument)) {
    console.error(`Unsafe Prisma argument: ${argument}`);
    process.exit(2);
  }
}

const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL
    ?? "postgresql://anecites:anecites_dev_password@localhost:5432/anecites",
};

const command = process.platform === "win32"
  ? (process.env.ComSpec ?? "cmd.exe")
  : "prisma";
const args = process.platform === "win32"
  ? ["/d", "/s", "/c", "prisma", ...prismaArgs]
  : prismaArgs;

const result = spawnSync(command, args, {
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Failed to run Prisma: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
