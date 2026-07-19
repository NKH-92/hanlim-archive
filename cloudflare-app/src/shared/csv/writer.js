export function csvEscape(value) {
  const text = neutralizeCsvFormula(String(value ?? ""));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function neutralizeCsvFormula(text) {
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}
