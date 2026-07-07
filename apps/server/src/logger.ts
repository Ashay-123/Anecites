export interface Logger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info(message, metadata) {
    console.info(message, metadata ?? {});
  },
  warn(message, metadata) {
    console.warn(message, metadata ?? {});
  },
  error(message, metadata) {
    console.error(message, metadata ?? {});
  },
};
