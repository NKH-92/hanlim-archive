export function sanitizeReturnUrl(value) {
  const candidate = String(value ?? "");
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return "/";
  for (let index = 0; index < candidate.length; index += 1) {
    const code = candidate.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return "/";
  }
  return candidate;
}
