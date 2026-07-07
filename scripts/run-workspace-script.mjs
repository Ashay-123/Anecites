import { spawnSync } from "node:child_process";
import { discoverWorkspacePackages } from "./workspace-utils.mjs";

const scriptName = process.argv[2];
const safeTokenPattern = /^[a-zA-Z0-9_:@./-]+$/;

if (!scriptName) {
  console.error("Usage: node scripts/run-workspace-script.mjs <script>");
  process.exit(2);
}

if (!safeTokenPattern.test(scriptName)) {
  console.error(`Unsafe script name: ${scriptName}`);
  process.exit(2);
}

const packages = discoverWorkspacePackages();

if (packages.length === 0) {
  console.log(`No workspace packages exist yet; skipping '${scriptName}'.`);
  process.exit(0);
}

const runnablePackages = packages.filter((workspacePackage) => scriptName in workspacePackage.scripts);

if (runnablePackages.length === 0) {
  console.log(`No workspace packages define '${scriptName}'; skipping.`);
  process.exit(0);
}

const npmCommand = process.platform === "win32"
  ? (process.env.ComSpec ?? "cmd.exe")
  : "npm";

for (const workspacePackage of runnablePackages) {
  if (!safeTokenPattern.test(workspacePackage.name)) {
    console.error(`Unsafe workspace package name: ${workspacePackage.name}`);
    process.exit(2);
  }

  console.log(`Running '${scriptName}' in ${workspacePackage.name}`);
  const npmArgs = ["run", scriptName, "--workspace", workspacePackage.name];
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm", ...npmArgs]
    : npmArgs;
  const result = spawnSync(
    npmCommand,
    commandArgs,
    { stdio: "inherit" },
  );

  if (result.error) {
    console.error(`Failed to run '${scriptName}' in ${workspacePackage.name}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
