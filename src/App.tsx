import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
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
  Clock3,
  X,
  CircleDot,
  GitPullRequestArrow,
  Loader2,
  MessageSquarePlus,
  Monitor,
  Moon,
  Search,
  Send,
  Settings,
  Sun,
  XCircle,
} from "lucide-react";
import { siBitbucket, siGithub } from "simple-icons";
import { getCommentLineKey, languageFromPath, parseUnifiedDiff } from "./diff";
import {
  loadInboxPullRequests,
  loadPullRequestFiles,
  providers,
  type LoadProgress,
} from "./providers";
import { appConfig } from "./config";
import type {
  AccountSettings,
  DiffLine,
  ProviderKind,
  PullRequestSummary,
  ReviewComment,
  ReviewFile,
} from "./types";
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
  refresh_token?: string;
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

type ToastTone = "info" | "success" | "error";
type Toast = { id: string; message: string; tone: ToastTone };
type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";
type ProviderProgressState = Record<ProviderKind, { completed: number; total: number }>;
type InboxState = {
  readAtByPrId: Record<string, string>;
  snoozedUntilByPrId: Record<string, string>;
};
type SnoozeOption = { label: string; milliseconds: number };

const snoozeOptions: SnoozeOption[] = [
  { label: "1 hour", milliseconds: 60 * 60 * 1000 },
  { label: "3 hours", milliseconds: 3 * 60 * 60 * 1000 },
  { label: "1 day", milliseconds: 24 * 60 * 60 * 1000 },
  { label: "1 week", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { label: "2 weeks", milliseconds: 14 * 24 * 60 * 60 * 1000 },
  { label: "1 month", milliseconds: 30 * 24 * 60 * 60 * 1000 },
];

function emptyProviderProgress(): ProviderProgressState {
  return {
    github: { completed: 0, total: 0 },
    bitbucket: { completed: 0, total: 0 },
  };
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function mergePullRequests(current: PullRequestSummary[], incoming: PullRequestSummary[]) {
  const items = new Map(current.map((item) => [item.id, item]));
  for (const pullRequest of incoming) {
    const existing = items.get(pullRequest.id);
    items.set(
      pullRequest.id,
      existing
        ? {
            ...existing,
            ...pullRequest,
            files: pullRequest.filesLoaded ? pullRequest.files : existing.filesLoaded ? existing.files : pullRequest.files,
            filesLoaded: existing.filesLoaded || pullRequest.filesLoaded,
            viewerRoles: [...new Set([...(existing.viewerRoles ?? []), ...(pullRequest.viewerRoles ?? [])])],
            inboxReasons: [...new Set([...(existing.inboxReasons ?? []), ...(pullRequest.inboxReasons ?? [])])],
          }
        : pullRequest,
    );
  }
  return [...items.values()].sort(
    (left, right) => new Date(right.updatedAtIso).getTime() - new Date(left.updatedAtIso).getTime(),
  );
}

function filterButtonClasses(active: boolean) {
  return cn(
    "min-h-8 cursor-pointer rounded-md border px-2.5 text-[12px]",
    active
      ? "border-[var(--filter-active-border)] bg-[var(--filter-active-bg)] text-[var(--filter-active-text)]"
      : "border-transparent bg-transparent text-[var(--text-muted)]",
  );
}

function loadThemePreference(): ThemePreference {
  const stored = localStorage.getItem("reviewDesk.theme");
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function loadInboxState(): InboxState {
  try {
    const stored = JSON.parse(localStorage.getItem("reviewDesk.inboxState") ?? "{}") as Partial<InboxState>;
    return {
      readAtByPrId: stored.readAtByPrId && typeof stored.readAtByPrId === "object" ? stored.readAtByPrId : {},
      snoozedUntilByPrId:
        stored.snoozedUntilByPrId && typeof stored.snoozedUntilByPrId === "object"
          ? stored.snoozedUntilByPrId
          : {},
    };
  } catch {
    return { readAtByPrId: {}, snoozedUntilByPrId: {} };
  }
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function nextThemePreference(value: ThemePreference): ThemePreference {
  if (value === "system") return "light";
  if (value === "light") return "dark";
  return "system";
}

function themeVars(theme: ResolvedTheme): CSSProperties & Record<`--${string}`, string> {
  const dark = theme === "dark";
  return {
    colorScheme: theme,
    "--bg": dark ? "#101319" : "#f5f7fa",
    "--sidebar": dark ? "#141a22" : "#eef2f7",
    "--surface": dark ? "#121923" : "#ffffff",
    "--surface-2": dark ? "#151d26" : "#f8fafc",
    "--surface-3": dark ? "#0f141b" : "#e8edf3",
    "--surface-4": dark ? "#1a2430" : "#dce6f0",
    "--panel": dark ? "#0e141b" : "#ffffff",
    "--panel-header": dark ? "#141c25" : "#f3f6fa",
    "--diff-header": dark ? "#1b2734" : "#e9f1fb",
    "--border": dark ? "#26313d" : "#d2dbe6",
    "--border-strong": dark ? "#334253" : "#bdc9d6",
    "--border-active": dark ? "#3d4f63" : "#9db4cc",
    "--text": dark ? "#e7edf4" : "#17202a",
    "--text-muted": dark ? "#91a0af" : "#64748b",
    "--text-soft": dark ? "#c8d3df" : "#3f4f60",
    "--text-card": dark ? "#dbe6f0" : "#263241",
    "--accent": dark ? "#6ee7b7" : "#098461",
    "--link": dark ? "#7dd3fc" : "#0369a1",
    "--success": dark ? "#7ddf9f" : "#168753",
    "--danger": dark ? "#ff9b9b" : "#c24141",
    "--warning": dark ? "#f5d987" : "#9a6a00",
    "--warning-bg": dark ? "rgba(240,207,120,0.10)" : "rgba(245,158,11,0.12)",
    "--warning-border": dark ? "#665a34" : "#d69e2e",
    "--primary-bg": dark ? "#173a30" : "#d7f5e8",
    "--primary-border": dark ? "#2d6a55" : "#9fdcbe",
    "--primary-text": dark ? "#a7f3d0" : "#116149",
    "--primary-hover": dark ? "#1f493d" : "#c5efd8",
    "--github-pill-bg": dark ? "rgba(110,231,183,0.15)" : "rgba(16,185,129,0.14)",
    "--github-pill-text": dark ? "#a7f3d0" : "#047857",
    "--bitbucket-pill-bg": dark ? "rgba(125,211,252,0.15)" : "rgba(14,165,233,0.14)",
    "--bitbucket-pill-text": dark ? "#bae6fd" : "#0369a1",
    "--filter-active-bg": dark ? "#253241" : "#cbd5e1",
    "--filter-active-border": "transparent",
    "--filter-active-text": dark ? "#f7fafc" : "#17202a",
    "--overlay": dark ? "rgba(5,8,12,0.60)" : "rgba(15,23,42,0.28)",
  } as CSSProperties & Record<`--${string}`, string>;
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
    "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 text-[var(--text-soft)] disabled:cursor-not-allowed disabled:opacity-55",
  primary:
    "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--primary-border)] bg-[var(--primary-bg)] px-3 font-bold text-[var(--primary-text)] transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-55",
  success:
    "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 font-bold text-[var(--success)] transition-colors hover:bg-[var(--surface-4)] disabled:cursor-not-allowed disabled:opacity-55",
  icon:
    "grid size-[34px] cursor-pointer place-items-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-soft)] disabled:cursor-not-allowed disabled:opacity-55",
  link:
    "cursor-pointer border-0 bg-transparent font-bold text-[var(--link)] underline underline-offset-[3px] disabled:cursor-not-allowed disabled:opacity-55",
};

const externalLinkClasses =
  "cursor-pointer rounded-[4px] text-inherit no-underline transition-colors hover:text-[var(--link)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--link)]";

const providerPillClasses: Record<ProviderKind, string> = {
  github: "bg-[var(--github-pill-bg)] text-[var(--github-pill-text)]",
  bitbucket: "bg-[var(--bitbucket-pill-bg)] text-[var(--bitbucket-pill-text)]",
};

const diffRowClasses: Record<DiffLine["kind"], string> = {
  addition: "bg-green-500/10",
  deletion: "bg-red-500/10",
  context: "",
  meta: "",
};

const diffMarkerClasses: Record<DiffLine["kind"], string> = {
  addition: "text-[var(--success)]",
  deletion: "text-[var(--danger)]",
  context: "text-[var(--text-muted)]",
  meta: "text-[var(--text-muted)]",
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

function loadPercent(progress: { completed: number; total: number }) {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((progress.completed / progress.total) * 100)));
}

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.round(months / 12)}y`;
}

export function App() {
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderKind | "all">("all");
  const [selectedPrId, setSelectedPrId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [comments, setComments] = useState<ReviewComment[]>(initialComments);
  const [activeLineKey, setActiveLineKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [settings, setSettings] = useState<AccountSettings>(loadStoredSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<"general" | "connections">("general");
  const [connectView, setConnectView] = useState<"github" | "bitbucket" | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<"github" | "bitbucket" | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [usingDemo, setUsingDemo] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [providerProgress, setProviderProgress] = useState<ProviderProgressState>(emptyProviderProgress);
  const [loadingFileIds, setLoadingFileIds] = useState<Set<string>>(() => new Set());
  const [failedFileIds, setFailedFileIds] = useState<Set<string>>(() => new Set());
  const [inboxState, setInboxState] = useState<InboxState>(loadInboxState);
  const [now, setNow] = useState(() => Date.now());
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const refreshIdRef = useRef("");
  const loadingFileIdsRef = useRef<Set<string>>(new Set());
  const failedFileIdsRef = useRef<Set<string>>(new Set());
  const resolvedTheme = themePreference === "system" ? systemTheme : themePreference;
  const ThemeIcon = themePreference === "system" ? Monitor : themePreference === "light" ? Sun : Moon;

  useEffect(() => {
    void refreshPullRequests(settings);
  }, []);

  useEffect(() => {
    localStorage.setItem("reviewDesk.accounts", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem("reviewDesk.theme", themePreference);
  }, [themePreference]);

  useEffect(() => {
    localStorage.setItem("reviewDesk.inboxState", JSON.stringify(inboxState));
  }, [inboxState]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const updateTheme = () => setSystemTheme(query.matches ? "light" : "dark");
    updateTheme();
    query.addEventListener("change", updateTheme);
    return () => query.removeEventListener("change", updateTheme);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timeout = window.setTimeout(() => {
      setToasts((items) => items.slice(1));
    }, 6500);
    return () => window.clearTimeout(timeout);
  }, [toasts]);

  function showToast(message: string, tone: ToastTone = "info") {
    setToasts((items) => [...items.slice(-2), { id: crypto.randomUUID(), message, tone }]);
  }

  async function refreshPullRequests(nextSettings = settings) {
    const refreshId = crypto.randomUUID();
    refreshIdRef.current = refreshId;
    setPullRequests([]);
    setSelectedPrId("");
    loadingFileIdsRef.current = new Set();
    failedFileIdsRef.current = new Set();
    setLoadingFileIds(new Set());
    setFailedFileIds(new Set());
    setProviderProgress(emptyProviderProgress());
    setIsLoading(true);
    try {
      const result = await loadInboxPullRequests(nextSettings, {
        onPullRequests: (items) => {
          if (refreshIdRef.current !== refreshId || items.length === 0) return;
          setPullRequests((current) => mergePullRequests(current, items));
          setSelectedPrId((current) => current || items[0]?.id || "");
        },
        onProgress: (progress: LoadProgress) => {
          if (refreshIdRef.current !== refreshId) return;
          setProviderProgress((current) => ({
            ...current,
            [progress.provider]: {
              completed: progress.completed,
              total: progress.total,
            },
          }));
        },
        onWarning: (message) => {
          if (refreshIdRef.current !== refreshId) return;
          showToast(message, "error");
        },
      });
      if (refreshIdRef.current !== refreshId) return;
      if (result.updatedSettings) {
        setSettings(result.updatedSettings);
      }
      setPullRequests((current) => mergePullRequests(current, result.pullRequests));
      result.errors.forEach((error) => showToast(error, "error"));
      setUsingDemo(result.usingDemo);
      setSelectedPrId((current) => current || result.pullRequests[0]?.id || "");
    } finally {
      if (refreshIdRef.current === refreshId) setIsLoading(false);
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
      setConnectingProvider("github");
      const clientId = oauthConfig.githubClientId || settings.githubClientId;
      if (!clientId.trim() && !oauthConfig.githubBrokerUrl) {
        showToast("Missing GitHub client ID or broker URL. Add VITE_GITHUB_BROKER_URL for hosted auth.", "error");
        return;
      }
      if (!window.reviewDesk) {
        showToast("OAuth connect needs Electron app, not browser preview.", "error");
        return;
      }
      showToast("Opening GitHub login in your browser...");
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
      showToast("GitHub connected.", "success");
      setConnectView(null);
      setConnectingProvider(null);
      void refreshPullRequests(next);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "GitHub OAuth failed.", "error");
    } finally {
      setConnectingProvider(null);
    }
  }

  async function connectBitbucket() {
    try {
      setConnectingProvider("bitbucket");
      if (!settings.bitbucketWorkspaces.trim()) {
        showToast("Bitbucket workspace is required before connecting.", "error");
        setConnectView("bitbucket");
        setSettingsOpen(false);
        return;
      }
      const clientId = oauthConfig.bitbucketClientId || settings.bitbucketClientId;
      if (!clientId.trim() && !oauthConfig.bitbucketBrokerUrl) {
        showToast("Missing Bitbucket client ID or broker URL. Add VITE_BITBUCKET_BROKER_URL for hosted auth.", "error");
        return;
      }
      if (!window.reviewDesk) {
        showToast("OAuth connect needs Electron app, not browser preview.", "error");
        return;
      }
      showToast("Opening Bitbucket login in your browser...");
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
        ...workspaces.map((workspace) => ({
          workspace,
          token: token.access_token,
          refreshToken: token.refresh_token,
        })),
      ];
      const next = { ...settings, bitbucketAccessToken: "", bitbucketConnections };
      setSettings(next);
      showToast("Bitbucket connected.", "success");
      setConnectView(null);
      setConnectingProvider(null);
      void refreshPullRequests(next);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Bitbucket OAuth failed.", "error");
    } finally {
      setConnectingProvider(null);
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
    showToast(`${providerLabel[provider]} disconnected.`);
    await refreshPullRequests(next);
  }

  function closeConnectModal() {
    if (connectingProvider) return;
    setConnectView(null);
  }

  async function waitForOAuthCallback(
    state: string,
    providerName: string,
    getPending: () => Promise<OAuthCallback | undefined>,
    onCallback: (callback: (payload: OAuthCallback) => void) => () => void,
  ): Promise<OAuthCallback & { access_token: string }> {
    if (!window.reviewDesk) throw new Error("OAuth connect needs Electron app.");
    const pending = await getPending();
    if (pending?.state === state) {
      if (pending.error) throw new Error(pending.error);
      if (pending.access_token) return { ...pending, access_token: pending.access_token };
    }

    return new Promise<OAuthCallback & { access_token: string }>((resolve, reject) => {
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
        resolve({ ...payload, access_token: payload.access_token });
      });
    });
  }

  const visiblePullRequests = useMemo(() => {
    return pullRequests.filter((pr) => {
      const providerMatch = selectedProvider === "all" || pr.provider === selectedProvider;
      const snoozedUntil = inboxState.snoozedUntilByPrId[pr.id];
      const snoozed = snoozedUntil ? new Date(snoozedUntil).getTime() > now : false;
      const textMatch = `${pr.title} ${pr.repo} ${pr.author}`.toLowerCase().includes(query.toLowerCase());
      return providerMatch && !snoozed && textMatch;
    });
  }, [inboxState.snoozedUntilByPrId, now, pullRequests, query, selectedProvider]);
  const providerCounts = useMemo(() => {
    return pullRequests.reduce(
      (counts, pr) => {
        const snoozedUntil = inboxState.snoozedUntilByPrId[pr.id];
        const snoozed = snoozedUntil ? new Date(snoozedUntil).getTime() > now : false;
        if (!snoozed) counts[pr.provider] += 1;
        return counts;
      },
      { github: 0, bitbucket: 0 } satisfies Record<ProviderKind, number>,
    );
  }, [inboxState.snoozedUntilByPrId, now, pullRequests]);
  const totalProviderCount = providerCounts.github + providerCounts.bitbucket;
  const connectedProviders = useMemo(
    () => ({
      github: settings.githubConnections.length > 0,
      bitbucket: settings.bitbucketConnections.length > 0,
    }),
    [settings.bitbucketConnections.length, settings.githubConnections.length],
  );
  const loadingProviders = useMemo(
    () =>
      providers
        .filter((provider) => connectedProviders[provider.kind] || providerProgress[provider.kind].total > 0)
        .map((provider) => {
          const progress = providerProgress[provider.kind];
          return {
            kind: provider.kind,
            label: provider.label,
            percent: loadPercent(progress),
            completed: progress.completed,
            total: progress.total,
          };
        }),
    [connectedProviders, providerProgress],
  );

  const selectedPr = visiblePullRequests.find((pr) => pr.id === selectedPrId) ?? visiblePullRequests[0];
  const selectedFilesLoading = Boolean(selectedPr && loadingFileIds.has(selectedPr.id));
  const selectedDescription = selectedPr?.description?.trim() ?? "";
  const hasConnectedAccounts = settings.githubConnections.length > 0 || settings.bitbucketConnections.length > 0;
  const isFiltered = selectedProvider !== "all" || query.trim().length > 0;
  const markdownComponents = useMemo<Components>(
    () => ({
      a({ href, children, className, ...props }) {
        return (
          <a
            {...props}
            className={cn(externalLinkClasses, className)}
            href={href}
            onClick={(event) => openExternal(event, href)}
          >
            {children}
          </a>
        );
      },
      blockquote({ children }) {
        return (
          <blockquote className="my-2 border-l-2 border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-1 text-[var(--text-muted)]">
            {children}
          </blockquote>
        );
      },
      code({ children, className }) {
        return (
          <code
            className={cn(
              "rounded-[4px] bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--text)]",
              className,
            )}
          >
            {children}
          </code>
        );
      },
      del({ children }) {
        return <del className="text-[var(--text-muted)]">{children}</del>;
      },
      em({ children }) {
        return <em className="text-[var(--text-soft)]">{children}</em>;
      },
      h1({ children }) {
        return <h2 className="mb-2 mt-3 text-[17px] font-bold text-[var(--text)]">{children}</h2>;
      },
      h2({ children }) {
        return <h3 className="mb-2 mt-3 text-[16px] font-bold text-[var(--text)]">{children}</h3>;
      },
      h3({ children }) {
        return <h4 className="mb-1.5 mt-2.5 text-[15px] font-bold text-[var(--text)]">{children}</h4>;
      },
      img({ alt, src }) {
        return <img alt={alt ?? ""} className="my-2 max-w-full rounded-lg border border-[var(--border)]" src={src} />;
      },
      hr() {
        return <hr className="my-3 border-[var(--border)]" />;
      },
      input({ checked, type }) {
        return (
          <input
            checked={checked}
            className="mr-2 align-middle accent-[var(--accent)]"
            disabled
            readOnly
            type={type}
          />
        );
      },
      li({ children }) {
        return <li className="my-1 pl-1 marker:text-[var(--text-muted)]">{children}</li>;
      },
      ol({ children }) {
        return <ol className="my-2 ml-5 list-decimal text-[var(--text-soft)]">{children}</ol>;
      },
      p({ children }) {
        return <p className="my-2 text-[var(--text-soft)]">{children}</p>;
      },
      pre({ children }) {
        return (
          <pre className="my-2 max-w-full overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-3 text-[13px] text-[var(--text)] [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[var(--text)]">
            {children}
          </pre>
        );
      },
      strong({ children }) {
        return <strong className="text-[var(--text)]">{children}</strong>;
      },
      table({ children }) {
        return (
          <table className="my-2 block max-w-full overflow-x-auto rounded-lg border border-[var(--border)] text-left text-[13px] text-[var(--text-soft)]">
            {children}
          </table>
        );
      },
      td({ children }) {
        return <td className="border-t border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[var(--text-soft)]">{children}</td>;
      },
      th({ children }) {
        return <th className="border-b border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[var(--text)]">{children}</th>;
      },
      ul({ children }) {
        return <ul className="my-2 ml-5 list-disc text-[var(--text-soft)]">{children}</ul>;
      },
    }),
    [],
  );

  useEffect(() => {
    if (!selectedPr || selectedPr.filesLoaded || selectedPr.isDemo) return;
    if (loadingFileIdsRef.current.has(selectedPr.id) || failedFileIdsRef.current.has(selectedPr.id)) return;

    let cancelled = false;
    loadingFileIdsRef.current = new Set(loadingFileIdsRef.current).add(selectedPr.id);
    setLoadingFileIds((items) => new Set(items).add(selectedPr.id));
    void loadPullRequestFiles(settings, selectedPr)
      .then((result) => {
        if (cancelled) return;
        if (result.updatedSettings) setSettings(result.updatedSettings);
        setPullRequests((items) =>
          items.map((item) => (item.id === result.pullRequest.id ? mergePullRequests([item], [result.pullRequest])[0] : item)),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        failedFileIdsRef.current = new Set(failedFileIdsRef.current).add(selectedPr.id);
        setFailedFileIds((items) => new Set(items).add(selectedPr.id));
        showToast(
          error instanceof Error
            ? `${providerLabel[selectedPr.provider]} changes: ${error.message}`
            : `${providerLabel[selectedPr.provider]} changes failed.`,
          "error",
        );
      })
      .finally(() => {
        if (cancelled) return;
        const nextLoading = new Set(loadingFileIdsRef.current);
        nextLoading.delete(selectedPr.id);
        loadingFileIdsRef.current = nextLoading;
        setLoadingFileIds((items) => {
          const next = new Set(items);
          next.delete(selectedPr.id);
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPr, settings]);

  function selectPullRequest(pr: PullRequestSummary) {
    setSelectedPrId(pr.id);
    setActiveLineKey(null);
    setDraft("");
    setInboxState((current) => ({
      ...current,
      readAtByPrId: { ...current.readAtByPrId, [pr.id]: new Date().toISOString() },
    }));
  }

  function isPullRequestUnread(pr: PullRequestSummary) {
    const readAt = inboxState.readAtByPrId[pr.id];
    return !readAt || new Date(pr.updatedAtIso).getTime() > new Date(readAt).getTime();
  }

  function snoozePullRequest(pr: PullRequestSummary, option: SnoozeOption) {
    const snoozedUntil = new Date(Date.now() + option.milliseconds).toISOString();
    setInboxState((current) => ({
      ...current,
      snoozedUntilByPrId: { ...current.snoozedUntilByPrId, [pr.id]: snoozedUntil },
    }));
    showToast(`Snoozed ${pr.repo} #${pr.number} for ${option.label}.`);
    if (selectedPrId === pr.id) {
      const nextPr = visiblePullRequests.find((item) => item.id !== pr.id);
      setSelectedPrId(nextPr?.id ?? "");
    }
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

  function openExternal(event: React.MouseEvent<HTMLAnchorElement>, url: string | undefined) {
    if (!url) {
      event.preventDefault();
      return;
    }
    if (window.reviewDesk) {
      event.preventDefault();
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div
      className="relative grid h-screen overflow-hidden grid-cols-[380px_minmax(0,1fr)] bg-[var(--bg)] text-[var(--text)] max-[1040px]:grid-cols-[330px_minmax(0,1fr)]"
      style={themeVars(resolvedTheme)}
    >
      <div className="fixed left-0 right-0 top-0 z-10 h-8 [-webkit-app-region:drag]" aria-hidden="true" />
      <aside className="flex h-screen min-h-0 flex-col gap-[18px] overflow-hidden border-r border-[var(--border)] bg-[var(--sidebar)] px-5 pb-[18px] pt-8">
        <div className="flex min-h-[54px] items-center gap-3 rounded-lg px-1">
          <div className="grid size-11 shrink-0 place-items-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--accent)]">
            <GitPullRequestArrow size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-[17px] leading-5 tracking-normal">Chchchchanges</strong>
            <span className="mt-1 block truncate text-[13px] leading-4 text-[var(--text-muted)]">Pull request review</span>
          </div>
          <button
            className="ml-2 grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-soft)]"
            onClick={() => setThemePreference((current) => nextThemePreference(current))}
            aria-label={`Theme: ${themePreference}`}
            title={`Theme: ${themePreference}`}
          >
            <ThemeIcon size={17} />
          </button>
          <button
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-soft)]"
            onClick={() => {
              setSettingsPage("general");
              setSettingsOpen(true);
            }}
            aria-label="Settings"
          >
            <Settings size={17} />
          </button>
        </div>

        <div className="flex h-[42px] items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-3)] px-3 text-[var(--text-muted)]">
          <Search size={16} />
          <input
            className="w-full border-0 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search PRs"
          />
        </div>

        <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-[var(--surface-3)] p-[5px]" aria-label="Provider filter">
          <button
            className={filterButtonClasses(selectedProvider === "all")}
            onClick={() => setSelectedProvider("all")}
          >
            All <span className="text-[var(--text-muted)]">{totalProviderCount}</span>
          </button>
          {providers.map((provider) => (
            <button
              key={provider.kind}
              className={filterButtonClasses(selectedProvider === provider.kind)}
              onClick={() => setSelectedProvider(provider.kind)}
            >
              {provider.label} <span className="text-[var(--text-muted)]">{providerCounts[provider.kind]}</span>
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto pr-0.5">
          {visiblePullRequests.map((pr) => {
            const unread = isPullRequestUnread(pr);
            return (
            <article
              key={pr.id}
              role="button"
              tabIndex={0}
              className={cn(
                "grid w-full cursor-pointer grid-cols-[10px_minmax(0,1fr)] gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5 text-left text-[var(--text-card)] outline-none",
                selectedPr?.id === pr.id && "border-[var(--accent)] bg-[var(--surface-4)]",
                unread && "border-[var(--border-strong)]",
              )}
              onClick={() => selectPullRequest(pr)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") selectPullRequest(pr);
              }}
            >
              <span className="flex h-full min-h-[92px] items-center justify-center">
                {unread && <span className="size-2 rounded-full bg-[var(--accent)]" aria-label="Unread" />}
              </span>
              <span className="flex min-w-0 flex-col gap-2">
                <span className="flex min-w-0 items-center justify-between gap-3 text-[13px] text-[var(--text-muted)]">
                  <span className="min-w-0 truncate">
                    {pr.repo}
                  </span>
                  <span className="shrink-0 text-xs">{relativeTime(pr.updatedAtIso)}</span>
                </span>
                <strong
                  className={cn(
                    "min-w-0 overflow-hidden text-[13px] leading-5 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]",
                    !unread && "font-semibold text-[var(--text-soft)]",
                  )}
                >
                  {pr.title}
                </strong>
              {pr.isDemo && (
                <span className="w-fit rounded-full border border-[var(--warning-border)] px-[7px] py-0.5 text-[11px] font-bold text-[var(--warning)]">
                  Demo
                </span>
              )}
              </span>
            </article>
            );
          })}
        </div>

        {isLoading && loadingProviders.length > 0 && (
          <div className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--text-muted)]">
            <div className="mb-2 flex items-center gap-2 font-bold text-[var(--text-soft)]">
              <Loader2 className="animate-spin text-[var(--link)]" size={14} />
              Loading pull requests
            </div>
            <div className="flex flex-col gap-2">
              {loadingProviders.map((provider) => (
                <div className="grid gap-1.5" key={provider.kind}>
                  <div className="flex items-center justify-between gap-3">
                    <span>{provider.label}</span>
                    <span className="font-mono text-[var(--text-soft)]">
                      {provider.percent}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-[width]"
                      style={{ width: `${provider.percent}%` }}
                    />
                  </div>
                  {provider.total > 0 && (
                    <span className="font-mono text-[11px]">
                      {provider.completed}/{provider.total} requests
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      <main className="flex h-screen min-w-0 flex-col overflow-hidden p-[26px]">
        {selectedPr ? (
          <>
            <header className="mb-5 flex max-h-[34vh] shrink-0 items-start justify-between gap-6 overflow-auto pr-1">
              <div>
                <div className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
                  <span>{providerLabel[selectedPr.provider]}</span>
                  <ChevronDown size={14} />
                  <span>{selectedPr.repo}</span>
                </div>
                <h1 className="my-2 max-w-[920px] text-[28px] leading-[1.15] tracking-normal">
                  <a
                    className={externalLinkClasses}
                    href={selectedPr.url}
                    onClick={(event) => openExternal(event, selectedPr.url)}
                  >
                    {selectedPr.title}
                  </a>
                </h1>
                <p className="m-0 text-[var(--text-muted)]">
                  <a
                    className={externalLinkClasses}
                    href={selectedPr.url}
                    onClick={(event) => openExternal(event, selectedPr.url)}
                  >
                    #{selectedPr.number}
                  </a>{" "}
                  opened by <strong>{selectedPr.author}</strong>{" "}
                  from{" "}
                  <a
                    className={externalLinkClasses}
                    href={selectedPr.branchUrl}
                    onClick={(event) => openExternal(event, selectedPr.branchUrl)}
                  >
                    <strong>{selectedPr.branch}</strong>
                  </a>{" "}
                  into{" "}
                  <a
                    className={externalLinkClasses}
                    href={selectedPr.targetUrl}
                    onClick={(event) => openExternal(event, selectedPr.targetUrl)}
                  >
                    <strong>{selectedPr.target}</strong>
                  </a>
                </p>
                {selectedDescription && (
                  <div className="mt-3 max-w-[920px] text-[14px] leading-6 text-[var(--text-soft)]">
                    <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                      {selectedDescription}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
              <div className="flex gap-2.5">
                <div className="group relative">
                  <button className={controls.ghost}>
                    <Clock3 size={16} />
                    Snooze
                  </button>
                  <div className="pointer-events-none absolute right-0 top-11 z-10 hidden w-36 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-1 shadow-2xl group-focus-within:pointer-events-auto group-focus-within:block group-hover:pointer-events-auto group-hover:block">
                    {snoozeOptions.map((option) => (
                      <button
                        className="block w-full cursor-pointer rounded-md px-2.5 py-2 text-left text-[13px] text-[var(--text-soft)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
                        key={option.label}
                        onClick={() => snoozePullRequest(selectedPr, option)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button className={controls.success}>
                  <CheckCircle2 size={16} />
                  Approve
                </button>
              </div>
            </header>

            <section className="min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)]">
              {!selectedPr.filesLoaded ? (
                <div className="grid h-full min-h-0 min-w-0 place-items-center text-[var(--text-muted)]">
                  <div className="flex items-center gap-2">
                    <Loader2 className="animate-spin text-[var(--link)]" size={17} />
                    Loading file changes
                  </div>
                </div>
              ) : (
                <DiffStack
                  files={selectedPr.files}
                  pr={selectedPr}
                  comments={comments}
                  loading={selectedFilesLoading}
                  activeLineKey={activeLineKey}
                  draft={draft}
                  onActivateLine={setActiveLineKey}
                  onDraftChange={setDraft}
                  onSubmit={addComment}
                />
              )}
            </section>
          </>
        ) : (
          <div className="grid min-h-[60vh] place-items-center text-center text-[var(--text-muted)]">
            <div className="flex max-w-[360px] flex-col items-center gap-3">
              <h2 className="m-0 text-[22px] tracking-normal text-[var(--text)]">
                {hasConnectedAccounts ? "No pull requests found" : "No accounts connected"}
              </h2>
              <p className="m-0">
                {hasConnectedAccounts
                  ? "Try a different provider or search filter."
                  : "Connect GitHub or Bitbucket to review pull requests."}
              </p>
              {hasConnectedAccounts && isFiltered ? (
                <button
                  className={controls.primary}
                  onClick={() => {
                    setSelectedProvider("all");
                    setQuery("");
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <button
                  className={controls.primary}
                  onClick={() => {
                    setSettingsPage("connections");
                    setSettingsOpen(true);
                  }}
                >
                  Settings
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {settingsOpen && (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-[var(--overlay)] p-6"
          role="presentation"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <section
            className="w-[min(640px,calc(100vw-32px))] rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-4">
              <div>
                <h2 className="m-0 text-lg tracking-normal" id="settings-title">
                  Settings
                </h2>
                <p className="m-0 text-[13px] text-[var(--text-muted)]">
                  {settingsPage === "general" ? "General app preferences." : "Accounts used to load pull requests."}
                </p>
              </div>
              <button className={controls.icon} onClick={() => setSettingsOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </header>

            <div className="grid min-h-[300px] grid-cols-[160px_minmax(0,1fr)]">
              <nav className="flex flex-col gap-1.5 border-r border-[var(--border)] p-3.5" aria-label="Settings pages">
                <button
                  className={cn(
                    "h-9 cursor-pointer rounded-lg border border-transparent bg-transparent px-2.5 text-left text-[var(--text-muted)]",
                    settingsPage === "general" && "border-[var(--border-active)] bg-[var(--surface-4)] text-[var(--text)]",
                  )}
                  onClick={() => setSettingsPage("general")}
                >
                  General
                </button>
                <button
                  className={cn(
                    "h-9 cursor-pointer rounded-lg border border-transparent bg-transparent px-2.5 text-left text-[var(--text-muted)]",
                    settingsPage === "connections" && "border-[var(--border-active)] bg-[var(--surface-4)] text-[var(--text)]",
                  )}
                  onClick={() => setSettingsPage("connections")}
                >
                  Connections
                </button>
              </nav>

              <div className="flex min-w-0 flex-col gap-3 p-3.5">
                {settingsPage === "general" && <p className="m-0 text-[var(--text-muted)]">No general settings yet.</p>}
                {settingsPage === "connections" && (
                  <>
                    <div className="flex flex-col gap-2">
                      {settings.githubConnections.length === 0 && settings.bitbucketConnections.length === 0 && (
                        <p className="m-0 text-[13px] text-[var(--text-muted)]">No accounts connected.</p>
                      )}
                      {settings.githubConnections.map((connection) => (
                        <div
                          className="flex min-h-[34px] items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-[9px] py-[7px] text-[13px]"
                          key={`github-${connection.login}`}
                        >
                          <span className="inline-flex min-w-0 items-center gap-2 break-words">
                            <CheckSquare2 className="text-[var(--success)]" size={16} />
                            GitHub: {connection.login}
                          </span>
                          <button
                            className={cn(controls.link, "text-[var(--danger)]")}
                            onClick={() => void disconnectProvider("github", connection.login)}
                          >
                            Disconnect
                          </button>
                        </div>
                      ))}
                      {settings.bitbucketConnections.map((connection) => (
                        <div
                          className="flex min-h-[34px] items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-[9px] py-[7px] text-[13px]"
                          key={`bitbucket-${connection.workspace}`}
                        >
                          <span className="inline-flex min-w-0 items-center gap-2 break-words">
                            <CheckSquare2 className="text-[var(--success)]" size={16} />
                            Bitbucket: {connection.workspace}
                          </span>
                          <button
                            className={cn(controls.link, "text-[var(--danger)]")}
                            onClick={() => void disconnectProvider("bitbucket", connection.workspace)}
                          >
                            Disconnect
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-2.5">
                      <button
                        className="flex min-h-[38px] cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-[11px] text-left text-[var(--text)]"
                        onClick={() => {
                          setSettingsOpen(false);
                          setConnectView("github");
                        }}
                      >
                        <BrandIcon icon={siGithub} className="size-4 text-[var(--text)]" />
                        Connect GitHub
                      </button>
                      <button
                        className="flex min-h-[38px] cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-[11px] text-left text-[var(--text)]"
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
          className="fixed inset-0 z-20 grid place-items-center bg-[var(--overlay)] p-6"
          role="presentation"
          onMouseDown={closeConnectModal}
        >
          <section
            className={cn(
              "relative w-[min(460px,calc(100vw-32px))] rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] shadow-2xl",
              connectingProvider && "pointer-events-none",
            )}
            role="dialog"
            aria-modal="true"
            aria-busy={Boolean(connectingProvider)}
            aria-labelledby="connect-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-4">
              <div>
                <h2 className="m-0 text-lg tracking-normal" id="connect-title">
                  {connectView === "github" && "Connect GitHub"}
                  {connectView === "bitbucket" && "Connect Bitbucket"}
                </h2>
                <p className="m-0 text-[13px] text-[var(--text-muted)]">
                  {connectView === "github" && "Authorize a GitHub account in your browser."}
                  {connectView === "bitbucket" && "Choose a workspace, then authorize Bitbucket."}
                </p>
              </div>
              <button
                className={controls.icon}
                onClick={closeConnectModal}
                disabled={Boolean(connectingProvider)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </header>

            <div className="flex flex-col gap-2.5 px-4 pb-4 pt-3.5">
              {connectView === "bitbucket" && (
                <label className="mt-1 flex flex-col gap-[5px] text-[13px] text-[var(--text-muted)]">
                  Bitbucket workspace
                  <input
                    className="h-[38px] min-w-0 rounded-[7px] border border-[var(--border-strong)] bg-[var(--surface-3)] px-2.5 text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-55"
                    value={settings.bitbucketWorkspaces}
                    onChange={(event) => updateSettings({ bitbucketWorkspaces: event.target.value })}
                    placeholder="workspace-slug"
                    disabled={Boolean(connectingProvider)}
                    autoFocus
                  />
                </label>
              )}
            </div>

            <footer className="flex items-center justify-between gap-4 border-t border-[var(--border)] p-4">
              <button className={controls.ghost} onClick={closeConnectModal} disabled={Boolean(connectingProvider)}>
                Cancel
              </button>
              {connectView === "github" && (
                <button
                  className={controls.primary}
                  onClick={connectGitHub}
                  disabled={Boolean(connectingProvider) || (!oauthConfig.githubClientId && !oauthConfig.githubBrokerUrl)}
                >
                  {connectingProvider === "github" && <Loader2 className="animate-spin" size={15} />}
                  {connectingProvider === "github" ? "Connecting" : "Connect"}
                </button>
              )}
              {connectView === "bitbucket" && (
                <button
                  className={controls.primary}
                  onClick={connectBitbucket}
                  disabled={
                    Boolean(connectingProvider) ||
                    (!oauthConfig.bitbucketClientId && !oauthConfig.bitbucketBrokerUrl) ||
                    !settings.bitbucketWorkspaces.trim()
                  }
                >
                  {connectingProvider === "bitbucket" && <Loader2 className="animate-spin" size={15} />}
                  {connectingProvider === "bitbucket" ? "Connecting" : "Connect"}
                </button>
              )}
            </footer>

            {connectingProvider && (
              <div className="absolute inset-0 grid place-items-center rounded-lg bg-[var(--overlay)] backdrop-blur-[1px]">
                <div className="inline-flex items-center gap-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm font-bold text-[var(--text)] shadow-2xl">
                  <Loader2 className="animate-spin text-[var(--link)]" size={17} />
                  Connecting {providerLabel[connectingProvider]}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      <div className="fixed right-5 top-5 z-30 flex w-[min(420px,calc(100vw-32px))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border bg-[var(--surface)] px-3.5 py-3 text-sm text-[var(--text)] shadow-2xl",
              toast.tone === "error" && "border-[#7f3333]",
              toast.tone === "success" && "border-[#2f7a55]",
              toast.tone === "info" && "border-[var(--border-strong)]",
            )}
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            <span
              className={cn(
                "mt-1 size-2 shrink-0 rounded-full",
                toast.tone === "error" && "bg-[#ff9b9b]",
                toast.tone === "success" && "bg-[#7ddf9f]",
                toast.tone === "info" && "bg-[#7dd3fc]",
              )}
            />
            <p className="m-0 min-w-0 flex-1 leading-[1.35]">{toast.message}</p>
            <button
              className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[var(--text-muted)]"
              onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}
              aria-label="Dismiss notification"
            >
              <XCircle size={16} />
            </button>
          </div>
        ))}
      </div>
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

type DiffStackProps = {
  files: ReviewFile[];
  loading?: boolean;
} & Omit<DiffViewerProps, "file">;

function DiffStack({
  files,
  pr,
  comments,
  loading,
  activeLineKey,
  draft,
  onActivateLine,
  onDraftChange,
  onSubmit,
}: DiffStackProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-auto">
      {loading && (
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-3 text-[var(--text-muted)]">
          <Loader2 className="animate-spin text-[var(--link)]" size={15} />
          Loading file changes
        </div>
      )}
      {files.map((file) => (
        <DiffViewer
          key={file.path}
          file={file}
          pr={pr}
          comments={comments}
          activeLineKey={activeLineKey}
          draft={draft}
          onActivateLine={onActivateLine}
          onDraftChange={onDraftChange}
          onSubmit={onSubmit}
        />
      ))}
    </div>
  );
}

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
    <div className="flex min-w-0 flex-col border-b border-[var(--border)] last:border-b-0">
      <div className="flex min-h-[54px] items-center justify-between border-b border-[var(--border)] bg-[var(--panel-header)] px-4">
        <div className="flex items-center gap-2.5">
          <strong>{file.path}</strong>
          <span className="text-[13px] text-[var(--text-muted)]">{file.status}</span>
        </div>
        <div className="flex items-center gap-2.5 text-[13px]">
          <span className="text-[var(--success)]">+{file.additions}</span>
          <span className="text-[var(--danger)]">-{file.deletions}</span>
        </div>
      </div>

      <div
        className="font-mono text-[13px] leading-[1.55]"
        role="table"
        aria-label={`${file.path} unified diff`}
      >
        {hunks.map((hunk) => (
          <div key={hunk.header}>
            <div className="sticky top-0 z-[2] border-b border-[var(--border)] bg-[var(--diff-header)] px-3.5 py-[7px] text-[var(--link)]">
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
                      "group grid min-h-[25px] grid-cols-[58px_58px_34px_minmax(720px,1fr)] border-b border-[var(--border)] max-[1040px]:grid-cols-[46px_46px_32px_minmax(620px,1fr)]",
                      diffRowClasses[line.kind],
                    )}
                  >
                    <span className="select-none border-r border-[var(--border)] px-2.5 py-0.5 text-right text-[var(--text-muted)]">
                      {line.oldLine ?? ""}
                    </span>
                    <span className="select-none border-r border-[var(--border)] px-2.5 py-0.5 text-right text-[var(--text-muted)]">
                      {line.newLine ?? ""}
                    </span>
                    <button
                      className="grid w-full cursor-pointer place-items-center border-0 border-r border-[var(--border)] bg-transparent text-transparent group-hover:text-[var(--text-muted)] focus-visible:text-[var(--text-muted)]"
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
                      className="mb-2.5 ml-[150px] mr-[18px] mt-2 flex gap-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] p-3 text-[var(--text-card)] max-[1040px]:ml-[124px]"
                      key={comment.id}
                    >
                      <CircleDot className="mt-[3px] text-[var(--warning)]" size={14} />
                      <div>
                        <strong>
                          {comment.author}
                          {comment.pending ? " (pending)" : ""}
                        </strong>
                        <p className="my-1 text-[var(--text-soft)]">{comment.body}</p>
                        <span className="text-xs text-[var(--text-muted)]">{comment.createdAt}</span>
                      </div>
                    </div>
                  ))}

                  {activeLineKey === lineKey && (
                    <div className="mb-2.5 ml-[150px] mr-[18px] mt-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] p-2.5 max-[1040px]:ml-[124px]">
                      <textarea
                        className="block min-h-[86px] w-full resize-y rounded-[7px] border border-[var(--border-strong)] bg-[var(--surface-3)] p-2.5 text-[var(--text)] outline-none"
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
