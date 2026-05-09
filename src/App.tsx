import { useEffect, useMemo, useState } from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import {
  CheckCircle2,
  CheckSquare2,
  ChevronDown,
  X,
  CircleDot,
  Code2,
  GitPullRequestArrow,
  MessageSquarePlus,
  PanelLeft,
  Search,
  Send,
  Settings,
} from "lucide-react";
import { siBitbucket, siGithub } from "simple-icons";
import { getCommentLineKey, languageFromPath, parseUnifiedDiff } from "./diff";
import { loadAllPullRequests, providers } from "./providers";
import { appConfig } from "./config";
import type { AccountSettings, DiffLine, ProviderKind, PullRequestSummary, ReviewComment, ReviewFile } from "./types";
import type { SimpleIcon } from "simple-icons";

declare global {
  interface Window {
    reviewDesk?: {
      platform: string;
      connectGitHub(clientId: string, brokerUrl?: string): Promise<{ state: string }>;
      startGitHubDeviceFlow(clientId: string): Promise<{
        device_code: string;
        user_code: string;
        verification_uri: string;
        expires_in: number;
        interval: number;
      }>;
      pollGitHubDeviceFlow(
        clientId: string,
        deviceCode: string,
      ): Promise<{ access_token?: string; error?: string; error_description?: string; interval?: number }>;
      getPendingGitHubCallback(): Promise<OAuthCallback | undefined>;
      onGitHubCallback(callback: (payload: OAuthCallback) => void): () => void;
      connectBitbucket(clientId: string, brokerUrl?: string): Promise<{ state: string }>;
      getPendingBitbucketCallback(): Promise<OAuthCallback | undefined>;
      onBitbucketCallback(callback: (payload: OAuthCallback) => void): () => void;
    };
  }
}

type OAuthCallback = {
  state: string;
  access_token?: string;
  expires_in?: string;
  token_type?: string;
  error?: string;
};

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);

const providerLabel: Record<ProviderKind, string> = {
  github: "GitHub",
  bitbucket: "Bitbucket",
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function BrandIcon({ icon, className }: { icon: SimpleIcon; className?: string }) {
  return (
    <svg className={className} role="img" viewBox="0 0 24 24" aria-label={icon.title}>
      <path fill="currentColor" d={icon.path} />
    </svg>
  );
}

const controls = {
  ghost:
    "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#334253] bg-[#151d26] px-3 text-[#c8d3df] disabled:cursor-not-allowed disabled:opacity-55",
  primary:
    "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#31b77a] bg-[#29a96f] px-3 font-bold text-[#06140e] disabled:cursor-not-allowed disabled:opacity-55",
  icon:
    "grid size-[34px] cursor-pointer place-items-center rounded-lg border border-[#334253] bg-[#151d26] text-[#c8d3df] disabled:cursor-not-allowed disabled:opacity-55",
  link:
    "cursor-pointer border-0 bg-transparent font-bold text-sky-300 underline underline-offset-[3px] disabled:cursor-not-allowed disabled:opacity-55",
};

const providerPillClasses: Record<ProviderKind, string> = {
  github: "bg-emerald-300/15 text-emerald-200",
  bitbucket: "bg-sky-300/15 text-sky-200",
};

const diffRowClasses: Record<DiffLine["kind"], string> = {
  addition: "bg-green-500/10",
  deletion: "bg-red-500/10",
  context: "",
  meta: "",
};

const diffMarkerClasses: Record<DiffLine["kind"], string> = {
  addition: "text-[#7ddf9f]",
  deletion: "text-[#ff9b9b]",
  context: "text-[#91a0af]",
  meta: "text-[#91a0af]",
};

const initialComments: ReviewComment[] = [
  {
    id: "c1",
    provider: "github",
    prId: "gh-1842",
    filePath: "src/components/ReviewDashboard.tsx",
    lineKey: "src/components/ReviewDashboard.tsx:new:7",
    author: "sam",
    body: "Memoization helps, but this still recalculates when parent sends a new array. Fine for now.",
    createdAt: "9 min ago",
  },
  {
    id: "c2",
    provider: "bitbucket",
    prId: "bb-731",
    filePath: "reports/pipeline_report.py",
    lineKey: "reports/pipeline_report.py:new:35",
    author: "lina",
    body: "Good threshold. We should expose this as repo config in the next pass.",
    createdAt: "34 min ago",
  },
];

const emptySettings: AccountSettings = {
  githubClientId: "",
  githubToken: "",
  githubConnections: [],
  bitbucketClientId: "",
  bitbucketAccessToken: "",
  bitbucketWorkspaces: "",
  bitbucketConnections: [],
};

const oauthConfig = {
  githubClientId: import.meta.env.VITE_GITHUB_CLIENT_ID || appConfig.githubClientId,
  githubBrokerUrl: import.meta.env.VITE_GITHUB_BROKER_URL || appConfig.githubBrokerUrl,
  bitbucketClientId: import.meta.env.VITE_BITBUCKET_CLIENT_ID || appConfig.bitbucketClientId,
  bitbucketBrokerUrl: import.meta.env.VITE_BITBUCKET_BROKER_URL || appConfig.bitbucketBrokerUrl,
};

function loadStoredSettings(): AccountSettings {
  try {
    const stored = { ...emptySettings, ...JSON.parse(localStorage.getItem("reviewDesk.accounts") ?? "{}") };
    if (stored.githubToken && stored.githubConnections.length === 0) {
      stored.githubConnections = [{ login: "GitHub", token: stored.githubToken }];
    }
    if (stored.bitbucketAccessToken && stored.bitbucketConnections.length === 0 && stored.bitbucketWorkspaces) {
      stored.bitbucketConnections = stored.bitbucketWorkspaces
        .split(",")
        .map((workspace: string) => workspace.trim())
        .filter(Boolean)
        .map((workspace: string) => ({ workspace, token: stored.bitbucketAccessToken }));
    }
    return stored;
  } catch {
    return emptySettings;
  }
}

function highlightCode(code: string, language: string) {
  if (language === "plaintext") {
    return code.replace(/[&<>"']/g, (char) => {
      const entities: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[char];
    });
  }
  try {
    return hljs.highlight(code || " ", { language }).value;
  } catch {
    return hljs.highlightAuto(code || " ").value;
  }
}

function stateLabel(state: PullRequestSummary["state"]) {
  if (state === "changes-requested") return "Changes requested";
  if (state === "approved") return "Approved";
  if (state === "commented") return "Commented";
  return "Waiting";
}

export function App() {
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderKind | "all">("all");
  const [selectedPrId, setSelectedPrId] = useState<string>("");
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");
  const [query, setQuery] = useState("");
  const [comments, setComments] = useState<ReviewComment[]>(initialComments);
  const [activeLineKey, setActiveLineKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [settings, setSettings] = useState<AccountSettings>(loadStoredSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<"general" | "connections">("general");
  const [connectView, setConnectView] = useState<"github" | "bitbucket" | null>(null);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [usingDemo, setUsingDemo] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [oauthStatus, setOauthStatus] = useState("");

  useEffect(() => {
    void refreshPullRequests(settings);
  }, []);

  useEffect(() => {
    localStorage.setItem("reviewDesk.accounts", JSON.stringify(settings));
  }, [settings]);

  async function refreshPullRequests(nextSettings = settings) {
    setIsLoading(true);
    try {
      const result = await loadAllPullRequests(nextSettings);
      setPullRequests(result.pullRequests);
      setLoadErrors(result.errors);
      setUsingDemo(result.usingDemo);
      setSelectedPrId(result.pullRequests[0]?.id ?? "");
      setSelectedFilePath(result.pullRequests[0]?.files[0]?.path ?? "");
    } finally {
      setIsLoading(false);
    }
  }

  function updateSettings(patch: Partial<AccountSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function loadGitHubLogin(token: string) {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return "GitHub";
    const user = (await response.json()) as { login?: string };
    return user.login ?? "GitHub";
  }

  async function connectGitHub() {
    try {
      const clientId = oauthConfig.githubClientId || settings.githubClientId;
      if (!clientId.trim() && !oauthConfig.githubBrokerUrl) {
        setOauthStatus("Missing GitHub client ID or broker URL. Add VITE_GITHUB_BROKER_URL for hosted auth.");
        return;
      }
      if (!window.reviewDesk) {
        setOauthStatus("OAuth connect needs Electron app, not browser preview.");
        return;
      }
      setOauthStatus("Opening GitHub login in your browser...");
      const { state } = await window.reviewDesk.connectGitHub(
        clientId.trim() || "broker",
        oauthConfig.githubBrokerUrl || undefined,
      );
      const token = await waitForOAuthCallback(
        state,
        "GitHub",
        window.reviewDesk.getPendingGitHubCallback,
        window.reviewDesk.onGitHubCallback,
      );
      const login = await loadGitHubLogin(token.access_token);
      const githubConnections = [
        ...settings.githubConnections.filter((connection) => connection.login !== login),
        { login, token: token.access_token },
      ];
      const next = { ...settings, githubToken: "", githubConnections };
      setSettings(next);
      setOauthStatus("GitHub connected.");
      await refreshPullRequests(next);
      setConnectView(null);
    } catch (error) {
      setOauthStatus(error instanceof Error ? error.message : "GitHub OAuth failed.");
    }
  }

  async function connectBitbucket() {
    try {
      if (!settings.bitbucketWorkspaces.trim()) {
        setOauthStatus("Bitbucket workspace is required before connecting.");
        setConnectView("bitbucket");
        setSettingsOpen(false);
        return;
      }
      const clientId = oauthConfig.bitbucketClientId || settings.bitbucketClientId;
      if (!clientId.trim() && !oauthConfig.bitbucketBrokerUrl) {
        setOauthStatus("Missing Bitbucket client ID or broker URL. Add VITE_BITBUCKET_BROKER_URL for hosted auth.");
        return;
      }
      if (!window.reviewDesk) {
        setOauthStatus("OAuth connect needs Electron app, not browser preview.");
        return;
      }
      setOauthStatus("Opening Bitbucket login in your browser...");
      const { state } = await window.reviewDesk.connectBitbucket(
        clientId.trim() || "broker",
        oauthConfig.bitbucketBrokerUrl || undefined,
      );
      const token = await waitForOAuthCallback(
        state,
        "Bitbucket",
        window.reviewDesk.getPendingBitbucketCallback,
        window.reviewDesk.onBitbucketCallback,
      );
      const workspaces = settings.bitbucketWorkspaces
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const existing = settings.bitbucketConnections.filter(
        (connection) => !workspaces.includes(connection.workspace),
      );
      const bitbucketConnections = [
        ...existing,
        ...workspaces.map((workspace) => ({ workspace, token: token.access_token })),
      ];
      const next = { ...settings, bitbucketAccessToken: "", bitbucketConnections };
      setSettings(next);
      setOauthStatus("Bitbucket connected.");
      await refreshPullRequests(next);
      setConnectView(null);
    } catch (error) {
      setOauthStatus(error instanceof Error ? error.message : "Bitbucket OAuth failed.");
    }
  }

  async function disconnectProvider(provider: ProviderKind, id: string) {
    const next =
      provider === "github"
        ? {
            ...settings,
            githubToken: "",
            githubConnections: settings.githubConnections.filter((connection) => connection.login !== id),
          }
        : {
            ...settings,
            bitbucketAccessToken: "",
            bitbucketConnections: settings.bitbucketConnections.filter((connection) => connection.workspace !== id),
          };
    setSettings(next);
    setOauthStatus(`${providerLabel[provider]} disconnected.`);
    await refreshPullRequests(next);
  }

  async function waitForOAuthCallback(
    state: string,
    providerName: string,
    getPending: () => Promise<OAuthCallback | undefined>,
    onCallback: (callback: (payload: OAuthCallback) => void) => () => void,
  ) {
    if (!window.reviewDesk) throw new Error("OAuth connect needs Electron app.");
    const pending = await getPending();
    if (pending?.state === state) {
      if (pending.error) throw new Error(pending.error);
      if (pending.access_token) return { access_token: pending.access_token };
    }

    return new Promise<{ access_token: string }>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        unsubscribe();
        reject(new Error(`${providerName} OAuth timed out`));
      }, 180000);

      const unsubscribe = onCallback((payload) => {
        if (payload.state !== state) return;
        window.clearTimeout(timeout);
        unsubscribe();
        if (payload.error) {
          reject(new Error(payload.error));
          return;
        }
        if (!payload.access_token) {
          reject(new Error(`${providerName} did not return a token`));
          return;
        }
        resolve({ access_token: payload.access_token });
      });
    });
  }

  const visiblePullRequests = useMemo(() => {
    return pullRequests.filter((pr) => {
      const providerMatch = selectedProvider === "all" || pr.provider === selectedProvider;
      const textMatch = `${pr.title} ${pr.repo} ${pr.author}`.toLowerCase().includes(query.toLowerCase());
      return providerMatch && textMatch;
    });
  }, [pullRequests, query, selectedProvider]);

  const selectedPr = pullRequests.find((pr) => pr.id === selectedPrId) ?? visiblePullRequests[0];
  const selectedFile =
    selectedPr?.files.find((file) => file.path === selectedFilePath) ?? selectedPr?.files[0];

  useEffect(() => {
    if (selectedPr && !selectedPr.files.some((file) => file.path === selectedFilePath)) {
      setSelectedFilePath(selectedPr.files[0]?.path ?? "");
    }
  }, [selectedFilePath, selectedPr]);

  function selectPullRequest(pr: PullRequestSummary) {
    setSelectedPrId(pr.id);
    setSelectedFilePath(pr.files[0]?.path ?? "");
    setActiveLineKey(null);
    setDraft("");
  }

  async function addComment(file: ReviewFile, line: DiffLine) {
    if (!selectedPr || !draft.trim()) return;
    const lineKey = getCommentLineKey(file.path, line);
    const nextComment: ReviewComment = {
      id: crypto.randomUUID(),
      provider: selectedPr.provider,
      prId: selectedPr.id,
      filePath: file.path,
      lineKey,
      author: "you",
      body: draft.trim(),
      createdAt: "Draft",
      pending: true,
    };
    setComments((items) => [...items, nextComment]);
    setDraft("");
    setActiveLineKey(null);
    const provider = providers.find((item) => item.kind === selectedPr.provider);
    const publishedComment = await provider?.publishComment(nextComment);
    if (publishedComment) {
      setComments((items) =>
        items.map((item) =>
          item.id === nextComment.id ? { ...publishedComment, createdAt: "Now" } : item,
        ),
      );
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-[340px_minmax(0,1fr)] bg-[#101319] text-[#e7edf4] max-[1040px]:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="flex min-h-screen flex-col gap-[18px] border-r border-[#26313d] bg-[#141a22] px-[18px] pb-[18px] pt-[26px]">
        <div className="flex items-center gap-3 pl-1.5">
          <div className="grid size-[42px] place-items-center rounded-lg border border-[#3b4858] bg-[#1d2631] text-[#6ee7b7]">
            <GitPullRequestArrow size={20} />
          </div>
          <div>
            <strong className="block text-[17px] tracking-normal">Chchchchanges</strong>
            <span className="block text-[13px] text-[#91a0af]">Pull request review</span>
          </div>
          <button
            className="ml-auto grid size-9 cursor-pointer place-items-center rounded-lg border border-[#334253] bg-[#151d26] text-[#c8d3df]"
            onClick={() => {
              setSettingsPage("general");
              setSettingsOpen(true);
            }}
            aria-label="Settings"
          >
            <Settings size={17} />
          </button>
        </div>

        <div className="flex h-[42px] items-center gap-2.5 rounded-lg border border-[#2d3947] bg-[#0f141b] px-3 text-[#91a0af]">
          <Search size={16} />
          <input
            className="w-full border-0 bg-transparent text-[#e7edf4] outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search PRs"
          />
        </div>

        <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-[#0f141b] p-[5px]" aria-label="Provider filter">
          <button
            className={cn(
              "h-8 cursor-pointer rounded-md border-0 bg-transparent text-[#91a0af]",
              selectedProvider === "all" && "bg-[#253241] text-[#f7fafc]",
            )}
            onClick={() => setSelectedProvider("all")}
          >
            All
          </button>
          {providers.map((provider) => (
            <button
              key={provider.kind}
              className={cn(
                "h-8 cursor-pointer rounded-md border-0 bg-transparent text-[#91a0af]",
                selectedProvider === provider.kind && "bg-[#253241] text-[#f7fafc]",
              )}
              onClick={() => setSelectedProvider(provider.kind)}
            >
              {provider.label}
            </button>
          ))}
        </div>

        {loadErrors.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-[#665a34] bg-[#f0cf78]/10 px-3 py-2.5">
            {loadErrors.map((error) => (
              <p className="m-0 text-xs leading-[1.4] text-[#f0cf78]" key={error}>
                {error}
              </p>
            ))}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto pr-0.5">
          {visiblePullRequests.map((pr) => (
            <button
              key={pr.id}
              className={cn(
                "flex w-full cursor-pointer flex-col gap-2 rounded-lg border border-[#26313d] bg-[#111820] p-3.5 text-left text-[#dbe6f0]",
                selectedPr?.id === pr.id && "border-[#6ee7b7] bg-[#17212b]",
              )}
              onClick={() => selectPullRequest(pr)}
            >
              <span className={cn("w-fit rounded-full px-2 py-[3px] text-[11px] font-bold", providerPillClasses[pr.provider])}>
                {providerLabel[pr.provider]}
              </span>
              {pr.isDemo && (
                <span className="w-fit rounded-full border border-[#665a34] px-[7px] py-0.5 text-[11px] font-bold text-[#f5d987]">
                  Demo
                </span>
              )}
              <strong>{pr.title}</strong>
              <span className="text-[13px] text-[#91a0af]">
                {pr.repo} #{pr.number}
              </span>
              <span className="flex items-center justify-between gap-2.5 text-xs text-[#91a0af]">
                <span>{pr.author}</span>
                <span>{pr.updatedAt}</span>
              </span>
              <span className="flex items-center justify-start gap-2.5 text-xs text-[#91a0af]">
                <span className="text-[#7ddf9f]">+{pr.additions}</span>
                <span className="text-[#ff9b9b]">-{pr.deletions}</span>
                <span>{pr.comments} comments</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="min-h-screen min-w-0 p-[26px]">
        {selectedPr && selectedFile ? (
          <>
            <header className="mb-5 flex items-start justify-between gap-6">
              <div>
                <div className="flex items-center gap-1.5 text-[13px] text-[#91a0af]">
                  <span>{providerLabel[selectedPr.provider]}</span>
                  <ChevronDown size={14} />
                  <span>{selectedPr.repo}</span>
                </div>
                <h1 className="my-2 max-w-[920px] text-[28px] leading-[1.15] tracking-normal">{selectedPr.title}</h1>
                <p className="m-0 text-[#9eacba]">
                  #{selectedPr.number} from <strong>{selectedPr.branch}</strong> into{" "}
                  <strong>{selectedPr.target}</strong>
                </p>
              </div>
              <div className="flex gap-2.5">
                <button className={controls.ghost}>
                  <PanelLeft size={16} />
                  Files {selectedPr.files.length}
                </button>
                <button className={controls.primary}>
                  <CheckCircle2 size={16} />
                  Approve
                </button>
              </div>
            </header>

            <section className="grid min-h-[calc(100vh-154px)] grid-cols-[280px_minmax(0,1fr)] overflow-hidden rounded-lg border border-[#26313d] bg-[#0e141b] max-[1040px]:grid-cols-[220px_minmax(0,1fr)]">
              <nav className="flex flex-col gap-1 border-r border-[#26313d] bg-[#121923] p-3" aria-label="Changed files">
                {selectedPr.files.map((file) => (
                  <button
                    key={file.path}
                    className={cn(
                      "grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] gap-2 rounded-[7px] border border-transparent bg-transparent p-2.5 text-left text-[#cbd7e3]",
                      selectedFile.path === file.path && "border-[#3d4f63] bg-[#1a2430]",
                    )}
                    onClick={() => setSelectedFilePath(file.path)}
                  >
                    <Code2 size={15} />
                    <span className="break-words">{file.path}</span>
                    <span className="col-start-2 flex gap-2 text-xs">
                      <b>+{file.additions}</b>
                      <i className="not-italic text-[#ff9b9b]">-{file.deletions}</i>
                    </span>
                  </button>
                ))}
              </nav>

              <DiffViewer
                file={selectedFile}
                pr={selectedPr}
                comments={comments}
                activeLineKey={activeLineKey}
                draft={draft}
                onActivateLine={setActiveLineKey}
                onDraftChange={setDraft}
                onSubmit={addComment}
              />
            </section>
          </>
        ) : (
          <div className="grid min-h-[60vh] place-items-center text-center text-[#91a0af]">
            <div className="flex max-w-[360px] flex-col items-center gap-3">
              <h2 className="m-0 text-[22px] tracking-normal text-[#e7edf4]">No accounts connected</h2>
              <p className="m-0">Connect GitHub or Bitbucket to review pull requests.</p>
              <button
                className={controls.primary}
                onClick={() => {
                  setSettingsPage("connections");
                  setSettingsOpen(true);
                }}
              >
                Settings
              </button>
            </div>
          </div>
        )}
      </main>

      {settingsOpen && (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-[#05080c]/60 p-6"
          role="presentation"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <section
            className="w-[min(640px,calc(100vw-32px))] rounded-lg border border-[#334253] bg-[#121923] text-[#e7edf4] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-[#253241] p-4">
              <div>
                <h2 className="m-0 text-lg tracking-normal" id="settings-title">
                  Settings
                </h2>
                <p className="m-0 text-[13px] text-[#91a0af]">
                  {settingsPage === "general" ? "General app preferences." : "Accounts used to load pull requests."}
                </p>
              </div>
              <button className={controls.icon} onClick={() => setSettingsOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </header>

            <div className="grid min-h-[300px] grid-cols-[160px_minmax(0,1fr)]">
              <nav className="flex flex-col gap-1.5 border-r border-[#253241] p-3.5" aria-label="Settings pages">
                <button
                  className={cn(
                    "h-9 cursor-pointer rounded-lg border border-transparent bg-transparent px-2.5 text-left text-[#91a0af]",
                    settingsPage === "general" && "border-[#3d4f63] bg-[#1a2430] text-[#e7edf4]",
                  )}
                  onClick={() => setSettingsPage("general")}
                >
                  General
                </button>
                <button
                  className={cn(
                    "h-9 cursor-pointer rounded-lg border border-transparent bg-transparent px-2.5 text-left text-[#91a0af]",
                    settingsPage === "connections" && "border-[#3d4f63] bg-[#1a2430] text-[#e7edf4]",
                  )}
                  onClick={() => setSettingsPage("connections")}
                >
                  Connections
                </button>
              </nav>

              <div className="flex min-w-0 flex-col gap-3 p-3.5">
                {settingsPage === "general" && <p className="m-0 text-[#91a0af]">No general settings yet.</p>}
                {settingsPage === "connections" && (
                  <>
                    <div className="flex flex-col gap-2">
                      {settings.githubConnections.length === 0 && settings.bitbucketConnections.length === 0 && (
                        <p className="m-0 text-[13px] text-[#91a0af]">No accounts connected.</p>
                      )}
                      {settings.githubConnections.map((connection) => (
                        <div
                          className="flex min-h-[34px] items-center justify-between gap-3 rounded-lg border border-[#253241] bg-[#151d26] px-[9px] py-[7px] text-[13px]"
                          key={`github-${connection.login}`}
                        >
                          <span className="inline-flex min-w-0 items-center gap-2 break-words">
                            <CheckSquare2 className="text-[#7ddf9f]" size={16} />
                            GitHub: {connection.login}
                          </span>
                          <button
                            className={cn(controls.link, "text-[#ffb4b4]")}
                            onClick={() => void disconnectProvider("github", connection.login)}
                          >
                            Disconnect
                          </button>
                        </div>
                      ))}
                      {settings.bitbucketConnections.map((connection) => (
                        <div
                          className="flex min-h-[34px] items-center justify-between gap-3 rounded-lg border border-[#253241] bg-[#151d26] px-[9px] py-[7px] text-[13px]"
                          key={`bitbucket-${connection.workspace}`}
                        >
                          <span className="inline-flex min-w-0 items-center gap-2 break-words">
                            <CheckSquare2 className="text-[#7ddf9f]" size={16} />
                            Bitbucket: {connection.workspace}
                          </span>
                          <button
                            className={cn(controls.link, "text-[#ffb4b4]")}
                            onClick={() => void disconnectProvider("bitbucket", connection.workspace)}
                          >
                            Disconnect
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col gap-2 border-t border-[#253241] pt-2.5">
                      <button
                        className="flex min-h-[38px] cursor-pointer items-center gap-2.5 rounded-lg border border-[#334253] bg-[#151d26] px-[11px] text-left text-[#e7edf4]"
                        onClick={() => {
                          setSettingsOpen(false);
                          setConnectView("github");
                        }}
                      >
                        <BrandIcon icon={siGithub} className="size-4 text-[#e7edf4]" />
                        Connect GitHub
                      </button>
                      <button
                        className="flex min-h-[38px] cursor-pointer items-center gap-2.5 rounded-lg border border-[#334253] bg-[#151d26] px-[11px] text-left text-[#e7edf4]"
                        onClick={() => {
                          setSettingsOpen(false);
                          setConnectView("bitbucket");
                        }}
                      >
                        <BrandIcon icon={siBitbucket} className="size-4 text-[#2684ff]" />
                        Connect Bitbucket
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {connectView && (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-[#05080c]/60 p-6"
          role="presentation"
          onMouseDown={() => setConnectView(null)}
        >
          <section
            className="w-[min(460px,calc(100vw-32px))] rounded-lg border border-[#334253] bg-[#121923] text-[#e7edf4] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-[#253241] p-4">
              <div>
                <h2 className="m-0 text-lg tracking-normal" id="connect-title">
                  {connectView === "github" && "Connect GitHub"}
                  {connectView === "bitbucket" && "Connect Bitbucket"}
                </h2>
                <p className="m-0 text-[13px] text-[#91a0af]">
                  {connectView === "github" && "Authorize a GitHub account in your browser."}
                  {connectView === "bitbucket" && "Choose a workspace, then authorize Bitbucket."}
                </p>
              </div>
              <button className={controls.icon} onClick={() => setConnectView(null)} aria-label="Close">
                <X size={18} />
              </button>
            </header>

            <div className="flex flex-col gap-2.5 px-4 pb-4 pt-3.5">
              {connectView === "bitbucket" && (
                <label className="mt-1 flex flex-col gap-[5px] text-[13px] text-[#91a0af]">
                  Bitbucket workspace
                  <input
                    className="h-[38px] min-w-0 rounded-[7px] border border-[#334253] bg-[#0d1218] px-2.5 text-[#e7edf4] outline-none"
                    value={settings.bitbucketWorkspaces}
                    onChange={(event) => updateSettings({ bitbucketWorkspaces: event.target.value })}
                    placeholder="workspace-slug"
                    autoFocus
                  />
                </label>
              )}
            </div>

            <footer className="flex items-center justify-between gap-4 border-t border-[#253241] p-4">
              <button className={controls.ghost} onClick={() => setConnectView(null)}>
                Cancel
              </button>
              {connectView === "github" && (
                <button
                  className={controls.primary}
                  onClick={connectGitHub}
                  disabled={!oauthConfig.githubClientId && !oauthConfig.githubBrokerUrl}
                >
                  Connect
                </button>
              )}
              {connectView === "bitbucket" && (
                <button
                  className={controls.primary}
                  onClick={connectBitbucket}
                  disabled={
                    (!oauthConfig.bitbucketClientId && !oauthConfig.bitbucketBrokerUrl) ||
                    !settings.bitbucketWorkspaces.trim()
                  }
                >
                  Connect
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

type DiffViewerProps = {
  file: ReviewFile;
  pr: PullRequestSummary;
  comments: ReviewComment[];
  activeLineKey: string | null;
  draft: string;
  onActivateLine(lineKey: string | null): void;
  onDraftChange(value: string): void;
  onSubmit(file: ReviewFile, line: DiffLine): void;
};

function DiffViewer({
  file,
  pr,
  comments,
  activeLineKey,
  draft,
  onActivateLine,
  onDraftChange,
  onSubmit,
}: DiffViewerProps) {
  const hunks = useMemo(() => parseUnifiedDiff(file.diff), [file.diff]);
  const language = languageFromPath(file.path);

  return (
    <div className="min-w-0 overflow-hidden">
      <div className="flex min-h-[54px] items-center justify-between border-b border-[#26313d] bg-[#141c25] px-4">
        <div className="flex items-center gap-2.5">
          <strong>{file.path}</strong>
          <span className="text-[13px] text-[#91a0af]">{file.status}</span>
        </div>
        <div className="flex items-center gap-2.5 text-[13px]">
          <span className="text-[#7ddf9f]">+{file.additions}</span>
          <span className="text-[#ff9b9b]">-{file.deletions}</span>
        </div>
      </div>

      <div
        className="max-h-[calc(100vh-208px)] overflow-auto font-mono text-[13px] leading-[1.55]"
        role="table"
        aria-label={`${file.path} unified diff`}
      >
        {hunks.map((hunk) => (
          <div key={hunk.header}>
            <div className="sticky top-0 z-[2] border-b border-[#24303c] bg-[#1b2734] px-3.5 py-[7px] text-[#8fb9ff]">
              {hunk.header}
            </div>
            {hunk.lines.map((line) => {
              const lineKey = getCommentLineKey(file.path, line);
              const lineComments = comments.filter(
                (comment) => comment.prId === pr.id && comment.filePath === file.path && comment.lineKey === lineKey,
              );
              return (
                <div key={line.key}>
                  <div
                    className={cn(
                      "group grid min-h-[25px] grid-cols-[58px_58px_34px_minmax(720px,1fr)] border-b border-[#26313d]/60 max-[1040px]:grid-cols-[46px_46px_32px_minmax(620px,1fr)]",
                      diffRowClasses[line.kind],
                    )}
                  >
                    <span className="select-none border-r border-[#26313d]/75 px-2.5 py-0.5 text-right text-[#6d7d8d]">
                      {line.oldLine ?? ""}
                    </span>
                    <span className="select-none border-r border-[#26313d]/75 px-2.5 py-0.5 text-right text-[#6d7d8d]">
                      {line.newLine ?? ""}
                    </span>
                    <button
                      className="grid w-full cursor-pointer place-items-center border-0 border-r border-[#26313d]/75 bg-transparent text-transparent group-hover:text-[#9fb2c5] focus-visible:text-[#9fb2c5]"
                      title="Add inline comment"
                      onClick={() => onActivateLine(activeLineKey === lineKey ? null : lineKey)}
                    >
                      <MessageSquarePlus size={14} />
                    </button>
                    <code className="min-w-0 whitespace-pre px-3 py-0.5">
                      <span className={cn("mr-3 inline-block", diffMarkerClasses[line.kind])}>
                        {line.kind === "addition" ? "+" : line.kind === "deletion" ? "-" : " "}
                      </span>
                      <span dangerouslySetInnerHTML={{ __html: highlightCode(line.content, language) }} />
                    </code>
                  </div>

                  {lineComments.map((comment) => (
                    <div
                      className="mb-2.5 ml-[150px] mr-[18px] mt-2 flex gap-2.5 rounded-lg border border-[#334253] bg-[#151d26] p-3 text-[#dce6ef] max-[1040px]:ml-[124px]"
                      key={comment.id}
                    >
                      <CircleDot className="mt-[3px] text-[#f2c96d]" size={14} />
                      <div>
                        <strong>
                          {comment.author}
                          {comment.pending ? " (pending)" : ""}
                        </strong>
                        <p className="my-1 text-[#c5d0dc]">{comment.body}</p>
                        <span className="text-xs text-[#7d8b99]">{comment.createdAt}</span>
                      </div>
                    </div>
                  ))}

                  {activeLineKey === lineKey && (
                    <div className="mb-2.5 ml-[150px] mr-[18px] mt-2 rounded-lg border border-[#334253] bg-[#151d26] p-2.5 max-[1040px]:ml-[124px]">
                      <textarea
                        className="block min-h-[86px] w-full resize-y rounded-[7px] border border-[#334253] bg-[#0d1218] p-2.5 text-[#e7edf4] outline-none"
                        value={draft}
                        onChange={(event) => onDraftChange(event.target.value)}
                        placeholder={`Comment on ${file.path}:${line.newLine ?? line.oldLine}`}
                        autoFocus
                      />
                      <div className="mt-2.5 flex justify-end gap-2">
                        <button className={controls.ghost} onClick={() => onActivateLine(null)}>
                          Cancel
                        </button>
                        <button className={controls.primary} onClick={() => onSubmit(file, line)}>
                          <Send size={15} />
                          Add comment
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
