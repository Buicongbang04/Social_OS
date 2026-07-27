import pino, { type Logger as PinoLogger } from "pino";

export type LogContext = {
  correlationId?: string;
  workspaceId?: string;
  userId?: string;
  service?: string;
  [key: string]: unknown;
};

export type Logger = PinoLogger;

const REDACT_PATHS = [
  "password",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "authorization",
  "*.password",
  "*.secret",
  "*.token",
  "*.apiKey",
];

/**
 * Structured logger factory shared by every backend service/package.
 * Never log raw secrets/tokens — see docs/development/02_CODING_STANDARDS.md#logging.
 */
export function createLogger(
  service: string,
  context: LogContext = {},
): Logger {
  const isProduction = process.env.NODE_ENV === "production";

  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? "info",
    base: { service, ...context },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    transport: isProduction
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
  });
}

/**
 * Derive a child logger bound to a request/execution's Correlation ID —
 * used to trace one Execution/Task across Runtime → Worker → Gateway.
 */
export function withCorrelation(
  logger: Logger,
  correlationId: string,
  extra: LogContext = {},
): Logger {
  return logger.child({ correlationId, ...extra });
}
