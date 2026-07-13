import assert from "node:assert/strict";
import test from "node:test";

import { canHostLocalDemo, shouldBlockPublicDemoRequest } from "../dist/public-demo.js";

test("only loopback and packaged desktop origins may host local demo meetings", () => {
  assert.equal(canHostLocalDemo("http://127.0.0.1:4173/"), true);
  assert.equal(canHostLocalDemo("http://localhost:5173/"), true);
  assert.equal(canHostLocalDemo("tauri://localhost/"), true);
  assert.equal(canHostLocalDemo("https://demo.trycloudflare.com/"), false);
  assert.equal(canHostLocalDemo("not a URL"), false);
});

test("public gateway blocks meeting creation but permits candidate routes", () => {
  const input = {
    configuredPublicHost: "demo.trycloudflare.com",
    hostHeader: "demo.trycloudflare.com",
  };

  assert.equal(
    shouldBlockPublicDemoRequest({
      ...input,
      method: "POST",
      requestUrl: "/api/local-demo/meetings",
    }),
    true,
  );
  assert.equal(
    shouldBlockPublicDemoRequest({
      ...input,
      method: "POST",
      requestUrl: "/api/local-demo/meetings/?source=public",
    }),
    true,
  );
  assert.equal(
    shouldBlockPublicDemoRequest({
      ...input,
      method: "POST",
      requestUrl: "/api/local-demo/meetings/join",
    }),
    false,
  );
  assert.equal(
    shouldBlockPublicDemoRequest({
      ...input,
      hostHeader: "127.0.0.1:4173",
      method: "POST",
      requestUrl: "/api/local-demo/meetings",
    }),
    false,
  );
});
