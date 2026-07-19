export function parseCookies(header) {
  return Object.fromEntries(String(header ?? "").split(";").map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [key, rest.join("=")];
  }).filter(([key]) => key));
}
