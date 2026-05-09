import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";

const isDev = process.env.NODE_ENV !== "production" && !app.isPackaged;
const appProtocol = "chchchchanges";
const githubRedirectUri = `${appProtocol}://oauth/github`;
const bitbucketRedirectUri = `${appProtocol}://oauth/bitbucket`;
type OAuthPayload = { state: string; access_token?: string; expires_in?: string; token_type?: string; error?: string };
const pendingGitHubStates = new Map<string, NodeJS.Timeout>();
const pendingBitbucketStates = new Map<string, { timeout: NodeJS.Timeout; clientId: string }>();
let pendingGitHubCallback: OAuthPayload | undefined;
let pendingBitbucketCallback: OAuthPayload | undefined;

function registerAppProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(appProtocol, process.execPath, [path.resolve(process.argv[1])]);
    return;
  }
  app.setAsDefaultProtocolClient(appProtocol);
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = argv.find((arg) => arg.startsWith(`${appProtocol}://`));
    if (deepLink) {
      void handleOAuthCallback(deepLink);
    }
    const focusedWindow = BrowserWindow.getAllWindows()[0];
    if (focusedWindow) {
      if (focusedWindow.isMinimized()) focusedWindow.restore();
      focusedWindow.focus();
    }
  });
}

async function handleOAuthCallback(url: string) {
  const provider = url.startsWith(githubRedirectUri) ? "github" : url.startsWith(bitbucketRedirectUri) ? "bitbucket" : "";
  if (!provider) return false;
  console.log(`[oauth] ${provider} callback received: ${url.replace(/access_token=[^&#]+/, "access_token=<redacted>")}`);
  const parsed = new URL(url);
  const params = parsed.hash ? new URLSearchParams(parsed.hash.slice(1)) : parsed.searchParams;
  const state = params.get("state") ?? "";
  if (provider === "github") {
    const timeout = pendingGitHubStates.get(state);
    if (timeout) {
      clearTimeout(timeout);
      pendingGitHubStates.delete(state);
    }
  } else {
    const pending = pendingBitbucketStates.get(state);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingBitbucketStates.delete(state);
    }
  }

  let payload: OAuthPayload = {
    state,
    access_token: params.get("access_token") ?? undefined,
    expires_in: params.get("expires_in") ?? undefined,
    token_type: params.get("token_type") ?? undefined,
    error: params.get("error_description") ?? params.get("error") ?? undefined,
  };

  const code = params.get("code");
  if (provider === "bitbucket" && !payload.access_token && !payload.error && code) {
    payload = {
      state,
      error:
        "Bitbucket returned an authorization code. Bitbucket Cloud requires a client secret to exchange that code, so public desktop OAuth needs a hosted broker.",
    };
  }
  if (provider === "github") pendingGitHubCallback = payload;
  if (provider === "bitbucket") pendingBitbucketCallback = payload;

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(`oauth:${provider}-callback`, payload);
    if (window.isMinimized()) window.restore();
    window.focus();
  }
  return true;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    title: "Chchchchanges",
    backgroundColor: "#101319",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    void window.loadURL("http://127.0.0.1:5173");
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

type GitHubDeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

type GitHubTokenResponse =
  | { access_token: string; token_type: string; scope: string }
  | { error: string; error_description?: string; interval?: number };

ipcMain.handle("oauth:github-device-start", async (_event, clientId: string) => {
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: "repo read:user",
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub device flow failed: ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`);
  }
  const payload = (await response.json()) as GitHubDeviceCode;
  await shell.openExternal(payload.verification_uri);
  return payload;
});

ipcMain.handle("oauth:github-device-poll", async (_event, clientId: string, deviceCode: string) => {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub token poll failed: ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`);
  }
  return (await response.json()) as GitHubTokenResponse;
});

ipcMain.handle("oauth:github-broker", async (_event, clientId: string, brokerUrl?: string) => {
  const state = crypto.randomUUID();
  pendingGitHubCallback = undefined;
  const timeout = setTimeout(() => pendingGitHubStates.delete(state), 180000);
  pendingGitHubStates.set(state, timeout);

  const authUrl = brokerUrl
    ? new URL("/api/github/start", brokerUrl)
    : new URL("https://github.com/login/oauth/authorize");
  if (brokerUrl) {
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("redirect_uri", githubRedirectUri);
  } else {
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", githubRedirectUri);
    authUrl.searchParams.set("scope", "repo read:user");
    authUrl.searchParams.set("state", state);
  }
  console.log(`[oauth] opening github auth via ${brokerUrl ? "broker" : "direct"} with state ${state}`);
  void shell.openExternal(authUrl.toString());

  return { state };
});

ipcMain.handle("oauth:github-pending-callback", async () => pendingGitHubCallback);

ipcMain.handle("oauth:bitbucket-implicit", async (_event, clientId: string, brokerUrl?: string) => {
  const state = crypto.randomUUID();
  pendingBitbucketCallback = undefined;
  const timeout = setTimeout(() => pendingBitbucketStates.delete(state), 180000);
  pendingBitbucketStates.set(state, { timeout, clientId });

  const authUrl = brokerUrl
    ? new URL("/api/bitbucket/start", brokerUrl)
    : new URL("https://bitbucket.org/site/oauth2/authorize");
  if (brokerUrl) {
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("redirect_uri", bitbucketRedirectUri);
  } else {
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("redirect_uri", bitbucketRedirectUri);
  }
  console.log(`[oauth] opening bitbucket auth via ${brokerUrl ? "broker" : "direct"} with state ${state}`);
  void shell.openExternal(authUrl.toString());

  return { state };
});

ipcMain.handle("oauth:bitbucket-pending-callback", async () => pendingBitbucketCallback);

if (singleInstanceLock) {
  registerAppProtocol();
  app.whenReady().then(createWindow);
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  void handleOAuthCallback(url);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
