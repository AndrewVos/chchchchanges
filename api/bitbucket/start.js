const crypto = require("node:crypto");

function baseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

module.exports = async function handler(req, res) {
  const clientId = process.env.BITBUCKET_CLIENT_ID;
  const stateSecret = process.env.OAUTH_STATE_SECRET || process.env.BITBUCKET_CLIENT_SECRET;
  if (!clientId || !stateSecret) {
    res.statusCode = 500;
    res.end("Bitbucket broker missing BITBUCKET_CLIENT_ID or OAUTH_STATE_SECRET.");
    return;
  }

  const desktopState = String(req.query.state || "");
  const appRedirect = String(req.query.redirect_uri || "");
  if (!desktopState || !appRedirect.startsWith("chchchchanges://oauth/bitbucket")) {
    res.statusCode = 400;
    res.end("Invalid OAuth request.");
    return;
  }

  const payload = Buffer.from(
    JSON.stringify({
      desktopState,
      appRedirect,
      nonce: crypto.randomUUID(),
    }),
  ).toString("base64url");
  const brokerState = `${payload}.${sign(payload, stateSecret)}`;

  const authUrl = new URL("https://bitbucket.org/site/oauth2/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", brokerState);
  authUrl.searchParams.set("redirect_uri", `${baseUrl(req)}/api/bitbucket/callback`);

  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
};
