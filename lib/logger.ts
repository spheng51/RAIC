const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;
const SENSITIVE_KEY_PATTERN = /(authorization|api[-_]?key|secret|token|password|cookie)/i;
const MAX_SERIALIZATION_DEPTH = 4;

function getMinLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return env in LOG_LEVELS ? (env as LogLevel) : 'info';
}

function isJsonFormat(): boolean {
  return process.env.LOG_FORMAT === 'json';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_SERIALIZATION_DEPTH) {
    return '[Truncated]';
  }

  if (value instanceof Error) {
    return serializeError(value, false, depth + 1);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, depth + 1));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeValue(entry, depth + 1),
      ]),
    );
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  return value;
}

function serializeError(error: Error, includeStack: boolean, depth = 0): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  const errorWithMeta = error as Error & {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    cause?: unknown;
  };

  if (errorWithMeta.code != null) {
    serialized.code = sanitizeValue(errorWithMeta.code, depth + 1);
  }
  if (errorWithMeta.status != null) {
    serialized.status = sanitizeValue(errorWithMeta.status, depth + 1);
  }
  if (errorWithMeta.statusCode != null) {
    serialized.statusCode = sanitizeValue(errorWithMeta.statusCode, depth + 1);
  }
  if (errorWithMeta.cause != null) {
    serialized.cause = sanitizeValue(errorWithMeta.cause, depth + 1);
  }

  for (const [key, value] of Object.entries(error as unknown as Record<string, unknown>)) {
    if (key === 'name' || key === 'message' || key === 'stack') {
      continue;
    }
    if (serialized[key] !== undefined) {
      continue;
    }
    serialized[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : sanitizeValue(value, depth + 1);
  }

  if (includeStack && error.stack) {
    serialized.stack = error.stack;
  }

  return serialized;
}

function serializeArg(arg: unknown, includeStack: boolean): unknown {
  if (arg instanceof Error) {
    return serializeError(arg, includeStack);
  }
  return sanitizeValue(arg);
}

function formatSerializedArg(arg: unknown): string {
  return typeof arg === 'string' ? arg : JSON.stringify(arg);
}

function formatLine(level: LogLevel, tag: string, args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const upperLevel = level.toUpperCase();
  const includeStack = level === 'debug';
  const serializedArgs = args.map((arg) => serializeArg(arg, includeStack));
  const message = serializedArgs.map((arg) => formatSerializedArg(arg)).join(' ');

  if (isJsonFormat()) {
    return JSON.stringify({ timestamp, level: upperLevel, tag, message, data: serializedArgs });
  }
  return `[${timestamp}] [${upperLevel}] [${tag}] ${message}`;
}

export function createLogger(tag: string) {
  const emit = (level: LogLevel, args: unknown[]) => {
    if (LOG_LEVELS[level] < LOG_LEVELS[getMinLevel()]) return;

    const line = formatLine(level, tag, args);

    // Console output
    const fn =
      level === 'debug'
        ? console.debug
        : level === 'warn'
          ? console.warn
          : level === 'error'
            ? console.error
            : console.log;
    fn(line);
  };

  return {
    debug: (...args: unknown[]) => emit('debug', args),
    info: (...args: unknown[]) => emit('info', args),
    warn: (...args: unknown[]) => emit('warn', args),
    error: (...args: unknown[]) => emit('error', args),
  };
}
