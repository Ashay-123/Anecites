import fs from "node:fs";
import path from "node:path";
import { repoRoot, rootPackageJson } from "./workspace-utils.mjs";

const requiredFiles = [
  "package.json",
  "turbo.json",
  "tsconfig.base.json",
  ".gitignore",
  ".env.example",
  "scripts/workspace-utils.mjs",
  "scripts/list-workspaces.mjs",
  "scripts/run-workspace-script.mjs",
  "scripts/verify-root.mjs",
  "scripts/verify-docker.mjs",
];

const requiredScripts = [
  "workspaces",
  "verify:root",
  "verify:docker",
  "verify",
  "lint",
  "typecheck",
  "test",
  "build",
];

const failures = [];

for (const requiredFile of requiredFiles) {
  if (!fs.existsSync(path.join(repoRoot, requiredFile))) {
    failures.push(`Missing ${requiredFile}`);
  }
}

const packageJson = rootPackageJson();
if (packageJson.private !== true) {
  failures.push("Root package.json must be private.");
}

if (!String(packageJson.packageManager ?? "").startsWith("npm@")) {
  failures.push("Root package.json must document npm as the package manager.");
}

const workspaces = packageJson.workspaces ?? [];
for (const expectedWorkspace of ["apps/*", "packages/*"]) {
  if (!workspaces.includes(expectedWorkspace)) {
    failures.push(`Missing workspace pattern ${expectedWorkspace}`);
  }
}

for (const requiredScript of requiredScripts) {
  if (!(requiredScript in (packageJson.scripts ?? {}))) {
    failures.push(`Missing root script ${requiredScript}`);
  }
}

const turboJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "turbo.json"), "utf8"));
for (const taskName of ["build", "lint", "typecheck", "test", "dev"]) {
  if (!(taskName in (turboJson.tasks ?? {}))) {
    failures.push(`Missing turbo task ${taskName}`);
  }
}

const tsconfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.base.json"), "utf8"));
if (tsconfig.compilerOptions?.strict !== true) {
  failures.push("tsconfig.base.json must enable strict mode.");
}

if (failures.length > 0) {
  console.error("Root verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Root verification passed.");
