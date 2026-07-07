import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const schemaPath = path.resolve("prisma/schema.prisma");

function readSchema() {
  return fs.readFileSync(schemaPath, "utf8");
}

test("Prisma schema exists", () => {
  assert.equal(fs.existsSync(schemaPath), true);
});

test("schema includes Module 1 persistence models", () => {
  const schema = readSchema();
  const requiredModels = [
    "User",
    "Session",
    "Participant",
    "EditorDocument",
    "CodeSubmission",
    "RiskSummary",
    "EvidenceObject",
  ];

  for (const modelName of requiredModels) {
    assert.match(schema, new RegExp(`model\\s+${modelName}\\s+\\{`));
  }
});

test("schema stores replay and evidence as object references", () => {
  const schema = readSchema();

  assert.match(schema, /model\s+EvidenceObject\s+\{[\s\S]*storageKey\s+String/);
  assert.match(schema, /model\s+EditorDocument\s+\{[\s\S]*replayObjectId\s+String\?/);
  assert.match(schema, /model\s+EditorDocument\s+\{[\s\S]*replayObject\s+EvidenceObject\?/);
});

test("schema does not model raw keystrokes as Postgres rows", () => {
  const schema = readSchema();

  assert.doesNotMatch(schema, /model\s+(Raw)?Keystroke\b/);
  assert.doesNotMatch(schema, /model\s+EditorEvent\b/);
  assert.doesNotMatch(schema, /model\s+PasteEvent\b/);
});

test("schema has rolling risk summary fields instead of single-signal verdicts", () => {
  const schema = readSchema();

  assert.match(schema, /model\s+RiskSummary\s+\{[\s\S]*correlatedSignalCount\s+Int/);
  assert.match(schema, /model\s+RiskSummary\s+\{[\s\S]*humanReviewRequired\s+Boolean/);
  assert.doesNotMatch(schema, /autoFail/);
});
