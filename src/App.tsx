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
} from "lucide-react";
import { getCommentLineKey, languageFromPath, parseUnifiedDiff } from "./diff";
import { loadAllPullRequests, providers } from "./providers";
import { appConfig } from "./config";
import type { AccountSettings, DiffLine, ProviderKind, PullRequestSummary, ReviewComment, ReviewFile } from "./types";

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
  const [connectMenuOpen, setConnectMenuOpen] = useState(false);
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
        setConnectMenuOpen(false);
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
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <GitPullRequestArrow size={20} />
          </div>
          <div>
            <strong>Chchchchanges</strong>
            <span>Pull request review</span>
          </div>
        </div>

        <div className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search PRs" />
        </div>

        <div className="provider-filter" aria-label="Provider filter">
          <button className={selectedProvider === "all" ? "active" : ""} onClick={() => setSelectedProvider("all")}>
            All
          </button>
          {providers.map((provider) => (
            <button
              key={provider.kind}
              className={selectedProvider === provider.kind ? "active" : ""}
              onClick={() => setSelectedProvider(provider.kind)}
            >
              {provider.label}
            </button>
          ))}
        </div>

        {loadErrors.length > 0 && (
          <div className="notice">
            {loadErrors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        )}

        <div className="pr-list">
          {visiblePullRequests.map((pr) => (
            <button
              key={pr.id}
              className={`pr-card ${selectedPr?.id === pr.id ? "selected" : ""}`}
              onClick={() => selectPullRequest(pr)}
            >
              <span className={`provider-pill ${pr.provider}`}>{providerLabel[pr.provider]}</span>
              {pr.isDemo && <span className="demo-pill">Demo</span>}
              <strong>{pr.title}</strong>
              <span className="muted">
                {pr.repo} #{pr.number}
              </span>
              <span className="pr-meta">
                <span>{pr.author}</span>
                <span>{pr.updatedAt}</span>
              </span>
              <span className="stats">
                <span className="plus">+{pr.additions}</span>
                <span className="minus">-{pr.deletions}</span>
                <span>{pr.comments} comments</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="review-pane">
        {selectedPr && selectedFile ? (
          <>
            <header className="review-header">
              <div>
                <div className="crumbs">
                  <span>{providerLabel[selectedPr.provider]}</span>
                  <ChevronDown size={14} />
                  <span>{selectedPr.repo}</span>
                </div>
                <h1>{selectedPr.title}</h1>
                <p>
                  #{selectedPr.number} from <strong>{selectedPr.branch}</strong> into{" "}
                  <strong>{selectedPr.target}</strong>
                </p>
              </div>
              <div className="review-actions">
                <button className="ghost" onClick={() => setConnectMenuOpen((value) => !value)}>
                  Connect
                </button>
                <button className="ghost">
                  <PanelLeft size={16} />
                  Files {selectedPr.files.length}
                </button>
                <button className="approve">
                  <CheckCircle2 size={16} />
                  Approve
                </button>
              </div>
            </header>

            <section className="workspace">
              <nav className="file-rail" aria-label="Changed files">
                {selectedPr.files.map((file) => (
                  <button
                    key={file.path}
                    className={selectedFile.path === file.path ? "active" : ""}
                    onClick={() => setSelectedFilePath(file.path)}
                  >
                    <Code2 size={15} />
                    <span>{file.path}</span>
                    <span className="file-delta">
                      <b>+{file.additions}</b>
                      <i>-{file.deletions}</i>
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
          <div className="empty-state">
            <div>
              <h2>No accounts connected</h2>
              <p>Connect GitHub or Bitbucket to review pull requests.</p>
              <button className="approve" onClick={() => setConnectMenuOpen(true)}>
                Connect
              </button>
            </div>
          </div>
        )}
      </main>

      {connectMenuOpen && (
        <div className="dropdown-layer" role="presentation" onMouseDown={() => setConnectMenuOpen(false)}>
          <section className="connect-dropdown" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dropdown-section">
              <strong>Connected accounts</strong>
              {settings.githubConnections.length === 0 && settings.bitbucketConnections.length === 0 && (
                <p>No accounts connected.</p>
              )}
              {settings.githubConnections.map((connection) => (
                <div className="connection-chip compact" key={`github-${connection.login}`}>
                  <span>
                    <CheckSquare2 className="connected-check" size={16} />
                    GitHub: {connection.login}
                  </span>
                  <button
                    className="link-button disconnect"
                    onClick={() => void disconnectProvider("github", connection.login)}
                  >
                    Disconnect
                  </button>
                </div>
              ))}
              {settings.bitbucketConnections.map((connection) => (
                <div className="connection-chip compact" key={`bitbucket-${connection.workspace}`}>
                  <span>
                    <CheckSquare2 className="connected-check" size={16} />
                    Bitbucket: {connection.workspace}
                  </span>
                  <button
                    className="link-button disconnect"
                    onClick={() => void disconnectProvider("bitbucket", connection.workspace)}
                  >
                    Disconnect
                  </button>
                </div>
              ))}
            </div>
            <div className="dropdown-actions">
              <button
                className="link-button"
                onClick={() => {
                  setConnectMenuOpen(false);
                  setConnectView("github");
                }}
              >
                Connect GitHub account
              </button>
              <button
                className="link-button"
                onClick={() => {
                  setConnectMenuOpen(false);
                  setConnectView("bitbucket");
                }}
              >
                Connect Bitbucket account
              </button>
            </div>
          </section>
        </div>
      )}

      {connectView && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConnectView(null)}>
          <section
            className="connect-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="connect-title">
                  {connectView === "github" && "Connect GitHub"}
                  {connectView === "bitbucket" && "Connect Bitbucket"}
                </h2>
                <p>
                  {connectView === "github" && "Authorize a GitHub account in your browser."}
                  {connectView === "bitbucket" && "Choose a workspace, then authorize Bitbucket."}
                </p>
              </div>
              <button className="icon-button" onClick={() => setConnectView(null)} aria-label="Close">
                <X size={18} />
              </button>
            </header>

            <div className="provider-connect-list">
              {connectView === "github" && (
                <div className="connect-action-panel">
                  <button
                    className="approve"
                    onClick={connectGitHub}
                    disabled={!oauthConfig.githubClientId && !oauthConfig.githubBrokerUrl}
                  >
                    Connect GitHub account
                  </button>
                </div>
              )}

              {connectView === "bitbucket" && (
                <>
                  <label className="workspace-field">
                    Bitbucket workspace
                    <input
                      value={settings.bitbucketWorkspaces}
                      onChange={(event) => updateSettings({ bitbucketWorkspaces: event.target.value })}
                      placeholder="workspace-slug"
                      autoFocus
                    />
                  </label>
                  <div className="connect-action-panel">
                    <button
                      className="approve"
                      onClick={connectBitbucket}
                      disabled={
                        (!oauthConfig.bitbucketClientId && !oauthConfig.bitbucketBrokerUrl) ||
                        !settings.bitbucketWorkspaces.trim()
                      }
                    >
                      Connect Bitbucket account
                    </button>
                  </div>
                </>
              )}
            </div>

            <footer>
              <button className="ghost" onClick={() => setConnectView(null)}>
                Cancel
              </button>
              {oauthStatus && <p>{oauthStatus}</p>}
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
    <div className="diff-wrap">
      <div className="file-header">
        <div>
          <strong>{file.path}</strong>
          <span>{file.status}</span>
        </div>
        <div className="file-summary">
          <span className="plus">+{file.additions}</span>
          <span className="minus">-{file.deletions}</span>
        </div>
      </div>

      <div className="diff-table" role="table" aria-label={`${file.path} unified diff`}>
        {hunks.map((hunk) => (
          <div className="hunk" key={hunk.header}>
            <div className="hunk-header">{hunk.header}</div>
            {hunk.lines.map((line) => {
              const lineKey = getCommentLineKey(file.path, line);
              const lineComments = comments.filter(
                (comment) => comment.prId === pr.id && comment.filePath === file.path && comment.lineKey === lineKey,
              );
              return (
                <div className="diff-row-group" key={line.key}>
                  <div className={`diff-row ${line.kind}`}>
                    <span className="gutter old">{line.oldLine ?? ""}</span>
                    <span className="gutter new">{line.newLine ?? ""}</span>
                    <button
                      className="comment-trigger"
                      title="Add inline comment"
                      onClick={() => onActivateLine(activeLineKey === lineKey ? null : lineKey)}
                    >
                      <MessageSquarePlus size={14} />
                    </button>
                    <code
                      className="code-line"
                      dangerouslySetInnerHTML={{ __html: highlightCode(line.content, language) }}
                    />
                  </div>

                  {lineComments.map((comment) => (
                    <div className="inline-comment" key={comment.id}>
                      <CircleDot size={14} />
                      <div>
                        <strong>
                          {comment.author}
                          {comment.pending ? " (pending)" : ""}
                        </strong>
                        <p>{comment.body}</p>
                        <span>{comment.createdAt}</span>
                      </div>
                    </div>
                  ))}

                  {activeLineKey === lineKey && (
                    <div className="comment-composer">
                      <textarea
                        value={draft}
                        onChange={(event) => onDraftChange(event.target.value)}
                        placeholder={`Comment on ${file.path}:${line.newLine ?? line.oldLine}`}
                        autoFocus
                      />
                      <div>
                        <button className="ghost" onClick={() => onActivateLine(null)}>
                          Cancel
                        </button>
                        <button className="send" onClick={() => onSubmit(file, line)}>
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
