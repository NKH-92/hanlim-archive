export function logError(context, error, extra = {}) {
  try {
    console.error(JSON.stringify({
      level: "error",
      at: context,
      message: error && error.message ? error.message : String(error),
      ...extra
    }));
  } catch {
    console.error(context, error);
  }
}

export function createLogger({ requestId = "", sink = console } = {}) {
  return Object.freeze({
    info(event, fields = {}) {
      write(sink, "info", event, requestId, fields);
    },
    error(event, error, fields = {}) {
      write(sink, "error", event, requestId, {
        message: error && error.message ? error.message : String(error),
        ...fields
      });
    }
  });
}

function write(sink, level, event, requestId, fields) {
  const method = level === "error" ? "error" : "log";
  sink[method](JSON.stringify({ level, event, requestId, ...fields }));
}
