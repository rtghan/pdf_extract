/**
 * Structured logging utility for observability
 *
 * Provides JSON-structured logs with:
 * - Log levels (debug, info, warn, error)
 * - Timestamps in ISO 8601 format
 * - Request context (requestId, userId, etc.)
 * - Automatic error serialization
 * - Child loggers with inherited context
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  userId?: string;
  engine?: string;
  conversionId?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  duration_ms?: number;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Configurable minimum log level (default: info in production, debug in dev)
const MIN_LOG_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LOG_LEVEL];
}

function serializeError(error: unknown): LogEntry["error"] | undefined {
  if (!error) return undefined;

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

function formatLog(entry: LogEntry): string {
  // In development, use pretty printing; in production, use compact JSON
  if (process.env.NODE_ENV === "development") {
    return JSON.stringify(entry, null, 2);
  }
  return JSON.stringify(entry);
}

function writeLog(entry: LogEntry): void {
  const output = formatLog(entry);

  // Use appropriate console method based on level
  switch (entry.level) {
    case "error":
      console.error(output);
      break;
    case "warn":
      console.warn(output);
      break;
    case "debug":
      console.debug(output);
      break;
    default:
      console.log(output);
  }
}

export class Logger {
  private context: LogContext;

  constructor(context: LogContext = {}) {
    this.context = context;
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: LogContext): Logger {
    return new Logger({ ...this.context, ...additionalContext });
  }

  /**
   * Log a message at the specified level
   */
  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(Object.keys(this.context).length > 0 && { context: this.context }),
      ...data,
    };

    writeLog(entry);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, error?: unknown, data?: Record<string, unknown>): void {
    this.log("error", message, {
      ...data,
      error: serializeError(error),
    });
  }

  /**
   * Log with timing information
   */
  withTiming<T>(
    operation: string,
    fn: () => T | Promise<T>
  ): T | Promise<T> {
    const start = performance.now();
    const result = fn();

    if (result instanceof Promise) {
      return result.then(
        (value) => {
          const duration_ms = Math.round(performance.now() - start);
          this.info(`${operation} completed`, { duration_ms });
          return value;
        },
        (error) => {
          const duration_ms = Math.round(performance.now() - start);
          this.error(`${operation} failed`, error, { duration_ms });
          throw error;
        }
      );
    }

    const duration_ms = Math.round(performance.now() - start);
    this.info(`${operation} completed`, { duration_ms });
    return result;
  }
}

// Default logger instance
export const logger = new Logger();

// Helper to create a request-scoped logger
export function createRequestLogger(requestId: string, userId?: string): Logger {
  return new Logger({
    requestId,
    ...(userId && { userId }),
  });
}

// Generate a unique request ID
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
