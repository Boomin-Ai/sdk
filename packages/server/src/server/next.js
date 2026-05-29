import { postHandoff } from "../server.js";

export function createBoominCreatorJoinHandler(options) {
  if (!options?.getCurrentUser) throw new Error("createBoominCreatorJoinHandler requires getCurrentUser.");

  return async function GET(request) {
    const currentUser = await options.getCurrentUser(request);
    if (!currentUser) {
      if (options.loginUrl) return Response.redirect(new URL(options.loginUrl, request.url).toString(), 302);
      return new Response("Sign in required.", { status: 401 });
    }

    try {
      const result = await postHandoff({
        apiBase: options.apiBase,
        publicKey: options.publicKey,
        programId: options.programId,
        redirectUri: options.redirectUri,
        signingSecret: options.signingSecret,
        issuer: options.issuer,
        audience: options.audience,
        externalUserId: currentUser.externalUserId,
        email: currentUser.email,
        name: currentUser.name,
        metadata: currentUser.metadata || {},
      });

      const authUrl = result.authUrl || result.auth_url;
      if (typeof authUrl === "string" && authUrl) return Response.redirect(authUrl, 302);

      return Response.redirect(withBoominParams(options.redirectUri, {
        boomin_status: String(result.status || "pending_approval"),
        boomin_session_id: String(result.sessionId || result.session_id || ""),
        boomin_username: nestedString(result, ["instagram", "username"]) || "",
      }), 302);
    } catch (error) {
      return Response.redirect(withBoominParams(options.redirectUri, {
        boomin_status: "failed",
        boomin_error: error?.code || "handoff_failed",
        boomin_error_detail: error instanceof Error ? error.message : "Boomin handoff failed.",
      }), 302);
    }
  };
}

function withBoominParams(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

function nestedString(value, path) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = current[key];
  }
  return typeof current === "string" ? current : null;
}
