export const CSV_FORMULA_PREFIX_PATTERN_SOURCE = "^[\\s\\u0000-\\u001F\\u007F-\\u009F]*[=+\\-@]";

export function csvEscape(value) {
  const text = neutralizeCsvFormula(String(value ?? ""));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function neutralizeCsvFormula(text) {
  return new RegExp(CSV_FORMULA_PREFIX_PATTERN_SOURCE).test(text) ? `'${text}` : text;
}
