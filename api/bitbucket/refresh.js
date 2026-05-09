async function readBody(req) {
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
}

module.exports = async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST, OPTIONS");
    res.end("Method not allowed.");
    return;
  }

  const clientId = process.env.BITBUCKET_CLIENT_ID;
  const clientSecret = process.env.BITBUCKET_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.statusCode = 500;
    res.end("Bitbucket broker missing required environment variables.");
    return;
  }

  try {
    const requestBody = await readBody(req);
    const refreshToken = String(requestBody.refresh_token || "");
    if (!refreshToken) {
      res.statusCode = 400;
      res.json({ error: "Missing refresh_token." });
      return;
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
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
      res.statusCode = response.ok ? 400 : response.status;
      res.json({
        error: token.error_description || token.error || "Bitbucket token refresh failed.",
      });
      return;
    }

    res.json({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
      token_type: token.token_type,
    });
  } catch (error) {
    res.statusCode = 500;
    res.json({
      error: error instanceof Error ? error.message : "Bitbucket token refresh failed.",
    });
  }
};
