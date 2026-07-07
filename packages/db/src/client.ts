import { PrismaClient } from "@prisma/client";

export { Prisma, PrismaClient } from "@prisma/client";

let cachedClient: PrismaClient | undefined;

export function createPrismaClient(
  options?: ConstructorParameters<typeof PrismaClient>[0],
): PrismaClient {
  return new PrismaClient(options);
}

export function getPrismaClient(): PrismaClient {
  cachedClient ??= createPrismaClient();
  return cachedClient;
}
