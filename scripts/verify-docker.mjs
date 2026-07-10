import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./workspace-utils.mjs";

const requiredFiles = [
  "docker/docker-compose.yml",
  "docker/.env.example",
  "docker/judge0.conf",
  "docker/livekit.yaml",
  "docker/livekit-egress.yaml",
];

const failures = [];

for (const requiredFile of requiredFiles) {
  if (!fs.existsSync(path.join(repoRoot, requiredFile))) {
    failures.push(`Missing ${requiredFile}`);
  }
}

if (failures.length > 0) {
  console.error("Docker verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

const dockerCommand = process.platform === "win32" ? "docker.exe" : "docker";
const result = spawnSync(
  dockerCommand,
  [
    "compose",
    "--env-file",
    "docker/.env.example",
    "-f",
    "docker/docker-compose.yml",
    "--profile",
    "infra",
    "--profile",
    "piston",
    "--profile",
    "judge0",
    "--profile",
    "livekit",
    "config",
    "--quiet",
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`Docker verification failed: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("Docker Compose verification passed.");
