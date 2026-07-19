export async function isValidCsrfToken(request, session) {
  if (request.method !== "POST") return true;
  try {
    const form = await request.clone().formData();
    const token = String(form.get("csrf_token") ?? "");
    return token.length > 0 && token === session.csrfToken;
  } catch {
    return false;
  }
}
