import express, {
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { createPrismaClient, type PrismaClient } from "@anecites/db";

import { requireAuth } from "./auth.js";
import { type FetchLike } from "./code-execution-provider.js";
import { createCodeExecutionRouter } from "./code-executions.js";
import { type ServerConfig } from "./config.js";
import { isHttpError } from "./http-error.js";
import { consoleLogger, type Logger } from "./logger.js";
import { createSessionRouter } from "./sessions.js";

export interface CreateAppOptions {
  logger?: Logger;
  prisma?: PrismaClient;
  fetch?: FetchLike;
}

export function createApp(config: ServerConfig, options: CreateAppOptions = {}) {
  const logger = options.logger ?? consoleLogger;
  const prisma = options.prisma ?? createPrismaClient({
    datasources: {
      db: {
        url: config.databaseUrl,
      },
    },
  });
  const app = express();
  const fetchImpl = options.fetch ?? fetch;

  app.disable("x-powered-by");
  app.use(createRequestLogger(logger));
  app.use(createCorsMiddleware(config));
  app.use(express.json({ limit: config.jsonBodyLimit }));

  app.get("/health", (_request: Request, response: Response) => {
    response.status(200).json({
      status: "ok",
      service: "anecites-api",
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.use("/sessions", requireAuth(config), createSessionRouter(prisma));
  app.use("/code-executions", requireAuth(config), createCodeExecutionRouter(config, fetchImpl));

  app.use((_request: Request, response: Response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });

  app.use(createErrorHandler(logger));

  return app;
}

function createRequestLogger(logger: Logger): RequestHandler {
  return (request, response, next) => {
    const startedAt = performance.now();

    response.on("finish", () => {
      logger.info("request.completed", {
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });

    next();
  };
}

function createCorsMiddleware(config: ServerConfig): RequestHandler {
  return (request, response, next) => {
    const origin = request.header("origin");

    if (origin === config.appOrigin) {
      response.header("Access-Control-Allow-Origin", config.appOrigin);
      response.header("Vary", "Origin");
      response.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      response.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
    }

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }

    next();
  };
}

function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _request, response, _next) => {
    logger.error("request.failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    if (response.headersSent) {
      return;
    }

    const statusCode = isHttpError(error) ? error.status : typeof error?.status === "number" ? error.status : 500;
    const errorPayload = isHttpError(error)
      ? {
          code: error.code,
          message: error.message,
        }
      : responseErrorPayload(statusCode);

    response.status(statusCode).json({
      error: errorPayload,
    });
  };
}

function responseErrorPayload(statusCode: number) {
  if (statusCode === 400) {
    return {
      code: "BAD_REQUEST",
      message: "Invalid request body",
    };
  }

  if (statusCode === 413) {
    return {
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body too large",
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  };
}
