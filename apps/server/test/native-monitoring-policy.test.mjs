import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";

import { canonicalizeNativeMonitoringPolicyPayload } from "@anecites/shared";
import { buildNativeMonitoringPolicyManifest } from "../dist/index.js";

test("native monitoring policy builder signs a stable versioned manifest", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = buildNativeMonitoringPolicyManifest({
    monitoringPolicyVersion: "2026-07-17.1",
    monitoringProhibitedApplicationRules: [
      {
        id: "fixture.assistant",
        processNames: ["fixture.exe"],
        windowTitleContains: [],
      },
    ],
    monitoringPolicySigningKeyId: "test-key",
    monitoringPolicySigningPrivateKeyPkcs8Base64: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
  });

  assert.equal(manifest.signature.keyId, "test-key");
  assert.equal(manifest.digestSha256.length, 64);
  assert.equal(verify(
    null,
    Buffer.from(canonicalizeNativeMonitoringPolicyPayload(manifest)),
    publicKey,
    Buffer.from(manifest.signature.valueBase64, "base64"),
  ), true);
});
