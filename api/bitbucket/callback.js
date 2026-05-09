const crypto = require("node:crypto");

function baseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function readState(rawState, secret) {
  const [payload, signature] = String(rawState || "").split(".");
  if (!payload || !signature || signature !== sign(payload, secret)) {
    throw new Error("Invalid OAuth state.");
  }
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function redirectToApp(res, appRedirect, params) {
  const url = new URL(appRedirect);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  res.writeHead(302, { Location: url.toString() });
  res.end();
}

module.exports = async function handler(req, res) {
  const clientId = process.env.BITBUCKET_CLIENT_ID;
  const clientSecret = process.env.BITBUCKET_CLIENT_SECRET;
  const stateSecret = process.env.OAUTH_STATE_SECRET || clientSecret;
  if (!clientId || !clientSecret || !stateSecret) {
    res.statusCode = 500;
    res.end("Bitbucket broker missing required environment variables.");
    return;
  }

  let state;
  try {
    state = readState(req.query.state, stateSecret);
  } catch (error) {
    res.statusCode = 400;
    res.end(error instanceof Error ? error.message : "Invalid OAuth state.");
    return;
  }

  if (req.query.error) {
    redirectToApp(res, state.appRedirect, {
      state: state.desktopState,
      error: req.query.error_description || req.query.error,
    });
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(req.query.code || ""),
      redirect_uri: `${baseUrl(req)}/api/bitbucket/callback`,
    });
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch("https://bitbucket.org/site/oauth2/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const token = await response.json();
    if (!response.ok || token.error || !token.access_token) {
      throw new Error(token.error_description || token.error || "Bitbucket token exchange failed.");
    }

    redirectToApp(res, state.appRedirect, {
      state: state.desktopState,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
      token_type: token.token_type,
    });
  } catch (error) {
    redirectToApp(res, state.appRedirect, {
      state: state.desktopState,
      error: error instanceof Error ? error.message : "Bitbucket token exchange failed.",
    });
  }
};
