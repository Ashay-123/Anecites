import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

export function rootPackageJson() {
  return readJson("package.json");
}

export function workspacePatterns() {
  const packageJson = rootPackageJson();
  if (Array.isArray(packageJson.workspaces)) {
    return packageJson.workspaces;
  }
  if (Array.isArray(packageJson.workspaces?.packages)) {
    return packageJson.workspaces.packages;
  }
  return [];
}

export function discoverWorkspacePackages() {
  const workspaces = [];

  for (const pattern of workspacePatterns()) {
    const parts = pattern.split("/");
    const starIndex = parts.indexOf("*");

    if (starIndex === -1 || starIndex !== parts.length - 1) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    }

    const baseDirectory = path.join(repoRoot, ...parts.slice(0, starIndex));
    if (!fs.existsSync(baseDirectory)) {
      continue;
    }

    for (const entry of fs.readdirSync(baseDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const workspaceDirectory = path.join(baseDirectory, entry.name);
      const packageJsonPath = path.join(workspaceDirectory, "package.json");
      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      workspaces.push({
        name: packageJson.name ?? entry.name,
        directory: workspaceDirectory,
        relativeDirectory: path.relative(repoRoot, workspaceDirectory).replaceAll("\\", "/"),
        scripts: packageJson.scripts ?? {},
      });
    }
  }

  return workspaces.sort((left, right) => left.name.localeCompare(right.name));
}
