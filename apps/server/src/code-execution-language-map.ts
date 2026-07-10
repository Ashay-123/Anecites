import { type CodeExecutionProviderName } from "./config.js";

export interface ExecutionRuntimeMapping {
  languageId: number;
  providerLanguage: string;
  providerVersion: string;
  sourceFileName: string;
}

const PISTON_RUNTIME_MAPPINGS: readonly ExecutionRuntimeMapping[] = [
  {
    languageId: 63,
    providerLanguage: "javascript",
    providerVersion: "20.11.1",
    sourceFileName: "main.js",
  },
  {
    languageId: 71,
    providerLanguage: "python",
    providerVersion: "3.12.0",
    sourceFileName: "main.py",
  },
];

export function resolveExecutionRuntime(
  provider: CodeExecutionProviderName,
  languageId: number,
): ExecutionRuntimeMapping | null {
  if (provider !== "piston") {
    return null;
  }

  return PISTON_RUNTIME_MAPPINGS.find((mapping) => mapping.languageId === languageId) ?? null;
}

