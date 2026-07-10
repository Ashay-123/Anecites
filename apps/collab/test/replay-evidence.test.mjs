import assert from "node:assert/strict";
import test from "node:test";

import { createObjectStorageReplayEvidenceSink } from "../dist/index.js";

test("object-storage replay sink writes immutable NDJSON update objects", async () => {
  const puts = [];
  const objectStore = {
    async putObject(input) {
      puts.push(input);
    },
  };
  const sink = createObjectStorageReplayEvidenceSink(objectStore, {
    bucket: "anecites-dev",
    keyPrefix: "replay/editor",
  });

  await sink({
    sessionId: "session-a",
    documentId: "document-a",
    participantId: "participant-a",
    occurredAt: "2026-07-10T01:00:00.000Z",
    updateBase64: "YWJj",
  });

  assert.equal(puts.length, 1);
  assert.equal(puts[0].bucket, "anecites-dev");
  assert.match(
    puts[0].key,
    /^replay\/editor\/session-a\/document-a\/2026-07-10T01-00-00-000Z-[0-9]{6}\.ndjson$/,
  );
  assert.equal(puts[0].contentType, "application/x-ndjson");
  assert.deepEqual(JSON.parse(puts[0].body.trim()), {
    type: "editor.yjs_update",
    sessionId: "session-a",
    documentId: "document-a",
    participantId: "participant-a",
    occurredAt: "2026-07-10T01:00:00.000Z",
    updateBase64: "YWJj",
  });
});
