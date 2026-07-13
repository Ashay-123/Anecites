import assert from "node:assert/strict";
import test from "node:test";

import {
  createCodeExecutionClient,
  CodeExecutionClientError,
} from "../dist/index.js";

test("code execution client posts submissions to the server proxy", async () => {
  const fakeFetch = createFakeFetch({
    status: 201,
    body: {
      execution: acceptedExecution(),
    },
  });
  const client = createCodeExecutionClient({
    baseUrl: "http://api.test",
    token: "jwt-token",
    fetch: fakeFetch.fetchImpl,
  });

  const execution = await client.execute({
    languageId: 63,
    sourceCode: "console.log('ok')",
    stdin: "input",
  });

  assert.deepEqual(execution, acceptedExecution());
  assert.equal(fakeFetch.calls.length, 1);
  assert.equal(fakeFetch.calls[0].url, "http://api.test/code-executions");
  assert.equal(fakeFetch.calls[0].method, "POST");
  assert.equal(fakeFetch.calls[0].headers.get("Authorization"), "Bearer jwt-token");
  assert.equal(fakeFetch.calls[0].headers.get("Content-Type"), "application/json");
  assert.equal(fakeFetch.calls[0].headers.get("Accept"), "application/json");
  assert.deepEqual(fakeFetch.calls[0].body, {
    languageId: 63,
    sourceCode: "console.log('ok')",
    stdin: "input",
  });
});

test("code execution client defaults stdin to an empty string", async () => {
  const fakeFetch = createFakeFetch({
    status: 201,
    body: {
      execution: acceptedExecution(),
    },
  });
  const client = createCodeExecutionClient({
    baseUrl: "http://api.test/",
    token: "jwt-token",
    fetch: fakeFetch.fetchImpl,
  });

  await client.execute({
    languageId: 71,
    sourceCode: "print('ok')",
  });

  assert.equal(fakeFetch.calls[0].url, "http://api.test/code-executions");
  assert.deepEqual(fakeFetch.calls[0].body, {
    languageId: 71,
    sourceCode: "print('ok')",
    stdin: "",
  });
});

test("code execution client includes optional persistence context", async () => {
  const fakeFetch = createFakeFetch({
    status: 201,
    body: {
      execution: acceptedExecution(),
    },
  });
  const client = createCodeExecutionClient({
    baseUrl: "http://api.test",
    token: "jwt-token",
    fetch: fakeFetch.fetchImpl,
  });

  await client.execute({
    languageId: 63,
    sourceCode: "console.log('ok')",
    sessionId: "session-a",
    documentId: "document-a",
    participantId: "participant-a",
  });

  assert.deepEqual(fakeFetch.calls[0].body, {
    languageId: 63,
    sourceCode: "console.log('ok')",
    stdin: "",
    sessionId: "session-a",
    documentId: "document-a",
    participantId: "participant-a",
  });
});

test("code execution client includes optional execution mode", async () => {
  const fakeFetch = createFakeFetch({
    status: 201,
    body: {
      execution: acceptedExecution(),
    },
  });
  const client = createCodeExecutionClient({
    baseUrl: "http://api.test",
    token: "jwt-token",
    fetch: fakeFetch.fetchImpl,
  });

  await client.execute({
    languageId: 63,
    sourceCode: "function twoSum() { return [0, 1]; }",
    executionMode: "submit",
  });

  assert.deepEqual(fakeFetch.calls[0].body, {
    languageId: 63,
    sourceCode: "function twoSum() { return [0, 1]; }",
    stdin: "",
    executionMode: "submit",
  });
});

test("code execution client lists persisted submissions", async () => {
  const fakeFetch = createFakeFetch({
    status: 200,
    body: {
      submissions: [
        {
          id: "submission-a",
          sessionId: "session-a",
          problemId: "problem-a",
          participantId: "participant-a",
          documentId: "document-a",
          languageId: 63,
          executionMode: "submit",
          status: "Wrong Answer",
          timeMs: 12,
          memoryKb: 1024,
          createdAt: "2026-07-13T00:00:00.000Z",
        },
      ],
    },
  });
  const client = createCodeExecutionClient({
    baseUrl: "http://api.test",
    token: "jwt-token",
    fetch: fakeFetch.fetchImpl,
  });

  const submissions = await client.listSubmissions({
    sessionId: "session-a",
    documentId: "document-a",
    limit: 10,
  });

  assert.equal(fakeFetch.calls[0].url, "http://api.test/code-executions?sessionId=session-a&documentId=document-a&limit=10");
  assert.equal(fakeFetch.calls[0].method, "GET");
  assert.equal(fakeFetch.calls[0].headers.get("Authorization"), "Bearer jwt-token");
  assert.equal(fakeFetch.calls[0].headers.get("Accept"), "application/json");
  assert.deepEqual(submissions, fakeFetch.result.body.submissions);
});

test("code execution client maps proxy errors to typed errors", async () => {
  const fakeFetch = createFakeFetch({
    status: 504,
    body: {
      error: {
        code: "CODE_EXECUTION_TIMEOUT",
        message: "Code execution timed out",
      },
    },
  });
  const client = createCodeExecutionClient({
    baseUrl: "http://api.test",
    token: "jwt-token",
    fetch: fakeFetch.fetchImpl,
  });

  await assert.rejects(
    () =>
      client.execute({
        languageId: 63,
        sourceCode: "while (true) {}",
      }),
    (error) => {
      assert(error instanceof CodeExecutionClientError);
      assert.equal(error.status, 504);
      assert.equal(error.code, "CODE_EXECUTION_TIMEOUT");
      assert.equal(error.message, "Code execution timed out");
      return true;
    },
  );
});

test("code execution client rejects invalid success responses", async () => {
  const fakeFetch = createFakeFetch({
    status: 201,
    body: {
      execution: {
        status: "accepted",
      },
    },
  });
  const client = createCodeExecutionClient({
    baseUrl: "http://api.test",
    token: "jwt-token",
    fetch: fakeFetch.fetchImpl,
  });

  await assert.rejects(
    () =>
      client.execute({
        languageId: 63,
        sourceCode: "console.log('ok')",
      }),
    /Code execution proxy returned an invalid response/,
  );
});

function createFakeFetch(result) {
  const calls = [];

  async function fetchImpl(url, init = {}) {
    calls.push({
      url: String(url),
      method: init.method,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(init.body) : null,
    });

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  return {
    calls,
    fetchImpl,
    result,
  };
}

function acceptedExecution() {
  return {
    token: null,
    status: {
      id: 3,
      description: "Accepted",
    },
    stdout: "ok\n",
    stderr: "",
    compileOutput: null,
    message: null,
    timeSeconds: null,
    memoryKb: null,
  };
}
