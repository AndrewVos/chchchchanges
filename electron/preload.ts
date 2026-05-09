import { contextBridge, ipcRenderer } from "electron";

type OAuthCallback = {
  state: string;
  access_token?: string;
  expires_in?: string;
  token_type?: string;
  error?: string;
};

contextBridge.exposeInMainWorld("reviewDesk", {
  platform: process.platform,
  connectGitHub: (clientId: string, brokerUrl?: string) => ipcRenderer.invoke("oauth:github-broker", clientId, brokerUrl),
  startGitHubDeviceFlow: (clientId: string) => ipcRenderer.invoke("oauth:github-device-start", clientId),
  pollGitHubDeviceFlow: (clientId: string, deviceCode: string) =>
    ipcRenderer.invoke("oauth:github-device-poll", clientId, deviceCode),
  getPendingGitHubCallback: () => ipcRenderer.invoke("oauth:github-pending-callback"),
  onGitHubCallback: (callback: (payload: OAuthCallback) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: OAuthCallback) => callback(payload);
    ipcRenderer.on("oauth:github-callback", handler);
    return () => ipcRenderer.removeListener("oauth:github-callback", handler);
  },
  connectBitbucket: (clientId: string, brokerUrl?: string) =>
    ipcRenderer.invoke("oauth:bitbucket-implicit", clientId, brokerUrl),
  getPendingBitbucketCallback: () => ipcRenderer.invoke("oauth:bitbucket-pending-callback"),
  onBitbucketCallback: (callback: (payload: OAuthCallback) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: OAuthCallback) => callback(payload);
    ipcRenderer.on("oauth:bitbucket-callback", handler);
    return () => ipcRenderer.removeListener("oauth:bitbucket-callback", handler);
  },
});
