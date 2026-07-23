import { createHash, createPrivateKey, sign } from "node:crypto";
import {
  NATIVE_MONITORING_POLICY_SCHEMA_VERSION,
  canonicalizeNativeMonitoringPolicyPayload,
  createNativeMonitoringPolicyManifest,
  type NativeMonitoringPolicyManifest,
} from "@anecites/shared";

import type { ServerConfig } from "./config.js";

export function buildNativeMonitoringPolicyManifest(
  config: Pick<
    ServerConfig,
    | "monitoringPolicyVersion"
    | "monitoringProhibitedApplicationRules"
    | "monitoringPolicySigningKeyId"
    | "monitoringPolicySigningPrivateKeyPkcs8Base64"
  >,
): NativeMonitoringPolicyManifest {
  const payload = {
    schemaVersion: NATIVE_MONITORING_POLICY_SCHEMA_VERSION,
    policyVersion: config.monitoringPolicyVersion,
    prohibitedApplicationRules: config.monitoringProhibitedApplicationRules,
  } as const;
  const canonicalPayload = canonicalizeNativeMonitoringPolicyPayload(payload);
  const digestSha256 = createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
  const signature = config.monitoringPolicySigningKeyId && config.monitoringPolicySigningPrivateKeyPkcs8Base64
    ? {
        algorithm: "Ed25519" as const,
        keyId: config.monitoringPolicySigningKeyId,
        valueBase64: sign(
          null,
          Buffer.from(canonicalPayload, "utf8"),
          createPrivateKey({
            key: Buffer.from(config.monitoringPolicySigningPrivateKeyPkcs8Base64, "base64"),
            format: "der",
            type: "pkcs8",
          }),
        ).toString("base64"),
      }
    : null;

  return createNativeMonitoringPolicyManifest({
    ...payload,
    digestSha256,
    signature,
  });
}
