import { contextBridge, ipcRenderer } from "electron";

type BitbucketCallback = {
  state: string;
  access_token?: string;
  expires_in?: string;
  token_type?: string;
  error?: string;
};

contextBridge.exposeInMainWorld("reviewDesk", {
  platform: process.platform,
  startGitHubDeviceFlow: (clientId: string) => ipcRenderer.invoke("oauth:github-device-start", clientId),
  pollGitHubDeviceFlow: (clientId: string, deviceCode: string) =>
    ipcRenderer.invoke("oauth:github-device-poll", clientId, deviceCode),
  connectBitbucket: (clientId: string, brokerUrl?: string) =>
    ipcRenderer.invoke("oauth:bitbucket-implicit", clientId, brokerUrl),
  getPendingBitbucketCallback: () => ipcRenderer.invoke("oauth:bitbucket-pending-callback"),
  onBitbucketCallback: (callback: (payload: BitbucketCallback) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: BitbucketCallback) => callback(payload);
    ipcRenderer.on("oauth:bitbucket-callback", handler);
    return () => ipcRenderer.removeListener("oauth:bitbucket-callback", handler);
  },
});
