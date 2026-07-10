import { type ServerConfig } from "./config.js";
import { Judge0ExecutionProvider } from "./judge0-execution-provider.js";
import { PistonExecutionProvider } from "./piston-execution-provider.js";

export type FetchLike = typeof fetch;

export interface ExecutionProviderHealth {
  ok: boolean;
  provider: string;
}

export interface ExecutionRuntime {
  language: string;
  version: string;
  aliases: readonly string[];
}

export interface CodeExecutionRequest {
  languageId: number;
  sourceCode: string;
  stdin: string;
  cpuTimeLimitSeconds: number;
  wallTimeLimitSeconds: number;
  memoryLimitKb: number;
  stackLimitKb: number;
  outputLimitBytes: number;
}

export interface CodeExecutionResult {
  token: string | null;
  status: {
    id: number;
    description: string;
  };
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  message: string | null;
  timeSeconds: number | null;
  memoryKb: number | null;
}

export interface CodeExecutionProvider {
  healthCheck(): Promise<ExecutionProviderHealth>;
  listRuntimes(): Promise<ExecutionRuntime[]>;
  execute(request: CodeExecutionRequest): Promise<CodeExecutionResult>;
}

export function createCodeExecutionProvider(config: ServerConfig, fetchImpl: FetchLike = fetch): CodeExecutionProvider {
  if (config.codeExecutionProvider === "piston") {
    return new PistonExecutionProvider(config, fetchImpl);
  }

  return new Judge0ExecutionProvider(config, fetchImpl);
}

