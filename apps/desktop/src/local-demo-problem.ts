import { type CodeExecutionResult } from "@anecites/editor-core";
import { localDemoProblem, localDemoStarterCode, type LocalDemoProblem } from "@anecites/shared";

export { localDemoProblem, localDemoStarterCode };

export function createLocalDemoSubmissionSource(
  sourceCode: string,
  languageId: number,
  problem: LocalDemoProblem = localDemoProblem,
): string {
  if (languageId !== 63) {
    return sourceCode;
  }

  return `${sourceCode}

;(() => {
  const testcases = ${JSON.stringify(problem.testcases)};

  if (typeof twoSum !== "function") {
    throw new Error("Expected a twoSum function for the local demo problem");
  }

  let failed = 0;
  for (let index = 0; index < testcases.length; index += 1) {
    const testcase = testcases[index];
    const actual = twoSum([...testcase.nums], testcase.target);
    const expected = testcase.expected;
    const passed = JSON.stringify(actual) === JSON.stringify(expected);

    if (passed) {
      console.log(\`Case \${index + 1}: passed\`);
    } else {
      failed += 1;
      console.error(\`Case \${index + 1}: expected \${JSON.stringify(expected)}, received \${JSON.stringify(actual)}\`);
    }
  }

  if (failed > 0) {
    console.error(\`ANECITES_SUBMIT:FAIL \${failed}/\${testcases.length}\`);
    process.exitCode = 1;
    return;
  }

  console.log("ANECITES_SUBMIT:PASS");
})();
`;
}

export function normalizeLocalDemoSubmissionResult(result: CodeExecutionResult): CodeExecutionResult {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (output.includes("ANECITES_SUBMIT:PASS")) {
    return {
      ...result,
      status: {
        id: 3,
        description: "Accepted",
      },
      message: "All local demo testcases passed",
    };
  }

  if (output.includes("ANECITES_SUBMIT:FAIL")) {
    return {
      ...result,
      status: {
        id: 4,
        description: "Wrong Answer",
      },
      message: "One or more local demo testcases failed",
    };
  }

  return result;
}
