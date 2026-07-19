export function ok(value) {
  return Object.freeze({ ok: true, value });
}

export function err(code, message, { fieldErrors = {}, meta = {} } = {}) {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, fieldErrors: Object.freeze({ ...fieldErrors }), meta: Object.freeze({ ...meta }) })
  });
}
