type Level = "info" | "warn" | "error" | "debug";

function ts(): string {
  return new Date().toISOString();
}

function log(level: Level, msg: string, meta?: unknown) {
  const line = `[${ts()}] ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (meta !== undefined) {
    console[level === "debug" ? "log" : level](line, meta);
  } else {
    console[level === "debug" ? "log" : level](line);
  }
}

export const logger = {
  info: (msg: string, meta?: unknown) => log("info", msg, meta),
  warn: (msg: string, meta?: unknown) => log("warn", msg, meta),
  error: (msg: string, meta?: unknown) => log("error", msg, meta),
  debug: (msg: string, meta?: unknown) => log("debug", msg, meta),
};
