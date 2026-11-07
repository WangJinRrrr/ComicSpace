type LogMeta = unknown;

function render(scope: string, level: string, message: string, meta?: LogMeta) {
  const prefix = `[${new Date().toISOString()}] [${scope}] ${level}`;
  if (meta === undefined) {
    console.log(prefix, message);
  } else {
    console.log(prefix, message, meta);
  }
}

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, meta) => {
      if (process.env.DEBUG) render(scope, "DEBUG", message, meta);
    },
    info: (message, meta) => render(scope, "INFO", message, meta),
    warn: (message, meta) => render(scope, "WARN", message, meta),
    error: (message, meta) => render(scope, "ERROR", message, meta),
  };
}

export const serverLogger = createLogger("server");
