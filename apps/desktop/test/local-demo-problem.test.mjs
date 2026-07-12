import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalDemoSubmissionSource,
  normalizeLocalDemoSubmissionResult,
} from "../dist/local-demo-problem.js";

const acceptedExecution = {
  token: null,
  status: {
    id: 3,
    description: "Accepted",
  },
  stdout: null,
  stderr: null,
  compileOutput: null,
  message: null,
  timeSeconds: null,
  memoryKb: null,
};

test("createLocalDemoSubmissionSource appends JavaScript testcase harness", () => {
  const source = "function twoSum() { return [0, 1]; }";
  const result = createLocalDemoSubmissionSource(source, 63);

  assert.match(result, /function twoSum/);
  assert.match(result, /ANECITES_SUBMIT:PASS/);
  assert.match(result, /ANECITES_SUBMIT:FAIL/);
  assert.match(result, /Expected a twoSum function/);
});

test("createLocalDemoSubmissionSource leaves non-JavaScript submissions unchanged", () => {
  const source = "print('hello')";

  assert.equal(createLocalDemoSubmissionSource(source, 71), source);
});

test("normalizeLocalDemoSubmissionResult maps local testcase sentinels", () => {
  const passed = normalizeLocalDemoSubmissionResult({
    ...acceptedExecution,
    stdout: "Case 1: passed\nANECITES_SUBMIT:PASS",
  });
  const failed = normalizeLocalDemoSubmissionResult({
    ...acceptedExecution,
    status: {
      id: 11,
      description: "Runtime Error",
    },
    stderr: "ANECITES_SUBMIT:FAIL 1/3",
  });

  assert.equal(passed.status.description, "Accepted");
  assert.equal(passed.message, "All local demo testcases passed");
  assert.equal(failed.status.description, "Wrong Answer");
  assert.equal(failed.message, "One or more local demo testcases failed");
});
