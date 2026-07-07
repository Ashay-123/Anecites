import { discoverWorkspacePackages, workspacePatterns } from "./workspace-utils.mjs";

const packages = discoverWorkspacePackages();

console.log(`Configured workspace globs: ${workspacePatterns().join(", ")}`);

if (packages.length === 0) {
  console.log("No workspace packages exist yet.");
  process.exit(0);
}

for (const workspacePackage of packages) {
  console.log(`${workspacePackage.name} -> ${workspacePackage.relativeDirectory}`);
}
