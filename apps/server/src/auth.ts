import { jwtVerify } from "jose";
import { type RequestHandler } from "express";
import { USER_ROLES, type UserRole } from "@anecites/shared";

import { type ServerConfig } from "./config.js";
import { HttpError } from "./http-error.js";

const bearerTokenPattern = /^Bearer (?<token>.+)$/;

export interface AuthenticatedPrincipal {
  subject: string;
  role: UserRole;
}

export function requireAuth(config: ServerConfig): RequestHandler {
  const secret = new TextEncoder().encode(config.authJwtSecret);

  return async (request, _response, next) => {
    try {
      const token = parseBearerToken(request.header("authorization"));
      const result = await jwtVerify(token, secret, {
        algorithms: ["HS256"],
      });

      const subject = result.payload.sub;
      const role = result.payload.role;

      if (typeof subject !== "string" || subject.trim().length === 0 || !isUserRole(role)) {
        throw new HttpError(401, "UNAUTHENTICATED", "Invalid bearer token");
      }

      next();
    } catch (error) {
      if (error instanceof HttpError) {
        next(error);
        return;
      }

      next(new HttpError(401, "UNAUTHENTICATED", "Invalid bearer token"));
    }
  };
}

function parseBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) {
    throw new HttpError(401, "UNAUTHENTICATED", "Missing bearer token");
  }

  const match = bearerTokenPattern.exec(authorizationHeader);
  const token = match?.groups?.token;

  if (!token) {
    throw new HttpError(401, "UNAUTHENTICATED", "Missing bearer token");
  }

  return token;
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}
