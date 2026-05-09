import { languageFromPath } from "./diff";
import { appConfig } from "./config";
import type {
  AccountSettings,
  PullRequestInboxReason,
  PullRequestSummary,
  ProviderKind,
  PullRequestViewerRole,
  ReviewComment,
  ReviewFile,
} from "./types";

type PullRequestProvider = {
  kind: ProviderKind;
  label: string;
  color: string;
  loadPullRequests(
    settings: AccountSettings,
    scope: PullRequestViewerRole,
    options?: LoadOptions,
  ): Promise<PullRequestSummary[]>;
  loadInboxPullRequests(settings: AccountSettings, options?: LoadOptions): Promise<PullRequestSummary[]>;
  publishComment(comment: ReviewComment): Promise<ReviewComment>;
};

type LoadOptions = {
  onPullRequests?(pullRequests: PullRequestSummary[]): void;
  onProgress?(progress: LoadProgress): void;
  onWarning?(message: string): void;
};

export type LoadProgress = {
  provider: ProviderKind;
  completed: number;
  total: number;
};

type ProgressReporter = (completedDelta?: number, totalDelta?: number) => void;

export type LoadResult = {
  pullRequests: PullRequestSummary[];
  errors: string[];
  usingDemo: boolean;
  updatedSettings?: AccountSettings;
};

type BitbucketConnection = AccountSettings["bitbucketConnections"][number];

const oauthConfig = {
  bitbucketBrokerUrl: import.meta.env.VITE_BITBUCKET_BROKER_URL || appConfig.bitbucketBrokerUrl,
};

const githubSearchPageSize = 100;
const githubSearchPageLimit = 10;
const githubRequestConcurrency = 8;
const githubInboxQueryConcurrency = 2;
const githubNotificationPageLimit = 3;
const bitbucketPullRequestLimit = 1_000;
const bitbucketReviewerRepoLimit = 40;
const bitbucketReviewerPullRequestLimit = 50;
const bitbucketReviewerRequestConcurrency = 2;
const bitbucketWatchedPullRequestLimit = 50;
const providerRateLimitCooldownMs = 10 * 60 * 1000;

const rateLimitCooldownUntil: Partial<Record<ProviderKind, number>> = {};

const dashboardDiff = `@@ -1,13 +1,18 @@
 import { useMemo } from "react";
 import { Badge } from "./Badge";
 
 export function ReviewDashboard({ pullRequests }) {
-  const open = pullRequests.filter((item) => item.state !== "closed");
+  const open = useMemo(
+    () => pullRequests.filter((item) => item.state !== "closed"),
+    [pullRequests],
+  );
 
   return (
     <section className="dashboard">
       <header>
         <h1>Reviews</h1>
-        <span>{open.length} waiting</span>
+        <Badge tone="amber">{open.length} waiting</Badge>
       </header>
       <ul>
         {open.map((item) => (
           <li key={item.id}>{item.title}</li>
         ))}`;

const authDiff = `@@ -8,19 +8,24 @@ export async function createSession(request: Request) {
   const identity = await verifyProviderToken(request);
   if (!identity) {
     throw new Response("Unauthorized", { status: 401 });
   }
 
-  const session = await db.session.create({
-    data: {
-      userId: identity.id,
-      expiresAt: new Date(Date.now() + ONE_DAY),
-    },
-  });
+  const expiresAt = new Date(Date.now() + ONE_DAY);
+  const session = await db.$transaction(async (tx) => {
+    await tx.session.deleteMany({ where: { userId: identity.id, revoked: true } });
+    return tx.session.create({
+      data: {
+        userId: identity.id,
+        provider: identity.provider,
+        expiresAt,
+      },
+    });
+  });
 
   return session;
 }
 
 export function getCookieOptions() {
   return {
     httpOnly: true,
+    sameSite: "lax",
     secure: process.env.NODE_ENV === "production",
   };`;

const bitbucketDiff = `@@ -23,16 +23,25 @@ class PipelineReport:
     def summary(self):
         failed = [step for step in self.steps if step.status == "failed"]
         skipped = [step for step in self.steps if step.status == "skipped"]
-        return {
-            "failed": len(failed),
-            "skipped": len(skipped),
-            "duration": self.duration_seconds,
-        }
+        payload = {
+            "failed": len(failed),
+            "skipped": len(skipped),
+            "duration": self.duration_seconds,
+            "commit": self.commit_hash,
+        }
+        if self.duration_seconds > 900:
+            payload["slow"] = True
+        return payload
 
     def needs_attention(self):
-        return self.summary()["failed"] > 0
+        summary = self.summary()
+        return summary["failed"] > 0 or summary.get("slow", False)
 
 def format_duration(seconds):
-    return f"{seconds}s"
+    minutes, remainder = divmod(seconds, 60)
+    if minutes:
+        return f"{minutes}m {remainder}s"
+    return f"{remainder}s"`;

const configDiff = `@@ -1,10 +1,16 @@
 export const reviewConfig = {
   providers: {
     github: {
       enabled: true,
+      draftReviews: true,
     },
     bitbucket: {
       enabled: true,
+      inlineTasks: true,
     },
   },
+  diff: {
+    contextLines: 6,
+    syntaxHighlighting: true,
+  },
 };`;

const mockPullRequests: PullRequestSummary[] = [
  {
    id: "gh-1842",
    provider: "github",
    repo: "acme/review-hub",
    number: 1842,
    title: "Cache PR dashboard filters",
    description: "Adds memoized filtering for the review dashboard and exposes filter settings for providers.",
    url: "https://github.com/acme/review-hub/pull/1842",
    author: "maya",
    branch: "maya/cache-review-filters",
    branchUrl: "https://github.com/acme/review-hub/tree/maya/cache-review-filters",
    target: "main",
    targetUrl: "https://github.com/acme/review-hub/tree/main",
    updatedAt: "12 min ago",
    updatedAtIso: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    additions: 32,
    deletions: 9,
    comments: 4,
    state: "waiting",
    viewerRoles: ["reviewer"],
    inboxReasons: ["reviewer"],
    isDemo: true,
    files: [
      {
        path: "src/components/ReviewDashboard.tsx",
        language: "tsx",
        status: "modified",
        additions: 14,
        deletions: 3,
        diff: dashboardDiff,
      },
      {
        path: "src/config/review.ts",
        language: "ts",
        status: "modified",
        additions: 6,
        deletions: 0,
        diff: configDiff,
      },
    ],
  },
  {
    id: "gh-1840",
    provider: "github",
    repo: "acme/identity",
    number: 1840,
    title: "Persist provider on sessions",
    description: "Stores the provider on newly-created sessions so downstream audit logs can group events by source.",
    url: "https://github.com/acme/identity/pull/1840",
    author: "niko",
    branch: "niko/provider-session",
    branchUrl: "https://github.com/acme/identity/tree/niko/provider-session",
    target: "main",
    targetUrl: "https://github.com/acme/identity/tree/main",
    updatedAt: "42 min ago",
    updatedAtIso: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
    additions: 18,
    deletions: 7,
    comments: 2,
    state: "changes-requested",
    viewerRoles: ["author"],
    inboxReasons: ["author"],
    isDemo: true,
    files: [
      {
        path: "src/server/session.ts",
        language: "ts",
        status: "modified",
        additions: 12,
        deletions: 6,
        diff: authDiff,
      },
    ],
  },
  {
    id: "bb-731",
    provider: "bitbucket",
    repo: "platform/pipelines",
    number: 731,
    title: "Expose slow pipeline signal",
    description: "Adds a slow-pipeline flag to the report payload and updates duration formatting.",
    url: "https://bitbucket.org/platform/pipelines/pull-requests/731",
    author: "ren",
    branch: "ren/pipeline-attention",
    branchUrl: "https://bitbucket.org/platform/pipelines/branch/ren/pipeline-attention",
    target: "develop",
    targetUrl: "https://bitbucket.org/platform/pipelines/branch/develop",
    updatedAt: "1 hr ago",
    updatedAtIso: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    additions: 16,
    deletions: 5,
    comments: 7,
    state: "commented",
    viewerRoles: ["participant"],
    inboxReasons: ["watched"],
    isDemo: true,
    files: [
      {
        path: "reports/pipeline_report.py",
        language: "python",
        status: "modified",
        additions: 13,
        deletions: 4,
        diff: bitbucketDiff,
      },
    ],
  },
];

type GitHubUser = { login: string };
type GitHubSearchItem = {
  number: number;
  title: string;
  user: { login: string };
  html_url: string;
  updated_at: string;
  comments: number;
  pull_request?: unknown;
};
type GitHubSearchResponse = { items: GitHubSearchItem[] };
type GitHubFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
};
type GitHubPull = {
  number?: number;
  title?: string;
  user?: { login: string };
  html_url?: string;
  updated_at?: string;
  head: { ref: string; repo?: { html_url?: string } | null };
  base: { ref: string; repo?: { html_url?: string } | null };
  body?: string | null;
  additions?: number;
  deletions?: number;
  comments?: number;
  review_comments?: number;
  state?: "open" | "closed";
  draft?: boolean;
};
type GitHubRepository = {
  full_name: string;
  pulls_url?: string;
};
type GitHubNotificationReason =
  | "approval_requested"
  | "assign"
  | "author"
  | "ci_activity"
  | "comment"
  | "invitation"
  | "manual"
  | "member_feature_requested"
  | "mention"
  | "review_requested"
  | "security_advisory_credit"
  | "security_alert"
  | "state_change"
  | "subscribed"
  | "team_mention";
type GitHubNotification = {
  id: string;
  repository: GitHubRepository;
  subject: {
    title: string;
    url?: string;
    type: string;
  };
  reason: GitHubNotificationReason | string;
  unread: boolean;
  updated_at: string;
};

type BitbucketUser = { account_id?: string; nickname?: string; username?: string; display_name?: string; uuid?: string };
type BitbucketRepo = { slug: string; full_name: string; workspace?: { slug?: string } };
type BitbucketPull = {
  id: number;
  title: string;
  author?: BitbucketUser;
  reviewers?: BitbucketUser[];
  participants?: Array<{ user?: BitbucketUser }>;
  source?: { repository?: BitbucketRepo; branch?: { name?: string } };
  destination?: { repository?: BitbucketRepo; branch?: { name?: string } };
  summary?: { raw?: string; markup?: string; html?: string };
  updated_on: string;
  comment_count?: number;
  links?: { diff?: { href?: string }; html?: { href?: string } };
};

type GitHubPullRequestContext = {
  headers: HeadersInit;
  userLogin: string;
  role: PullRequestViewerRole;
  inboxReason?: PullRequestInboxReason;
};

type GitHubPullRequestRef = {
  repo: string;
  number: number;
};

function githubBranchUrl(repoUrl: string | undefined, branch: string) {
  return repoUrl ? `${repoUrl}/tree/${encodeURI(branch)}` : undefined;
}

function bitbucketBranchUrl(repo: BitbucketRepo, branch: string | undefined) {
  if (!branch) return undefined;
  const workspace = repo.workspace?.slug ?? repo.full_name.split("/")[0];
  return `https://bitbucket.org/${workspace}/${repo.slug}/branch/${encodeURI(branch)}`;
}

function bitbucketSelectedUser(user: BitbucketUser) {
  return user.uuid ?? user.nickname ?? user.username ?? user.account_id ?? user.display_name;
}

function bitbucketQueryString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function bitbucketReviewerQuery(user: BitbucketUser) {
  const clauses = [
    user.uuid ? `reviewers.uuid = ${bitbucketQueryString(user.uuid)}` : "",
    user.nickname ? `reviewers.nickname = ${bitbucketQueryString(user.nickname)}` : "",
    user.username ? `reviewers.username = ${bitbucketQueryString(user.username)}` : "",
  ].filter(Boolean);
  return clauses.length > 0 ? clauses.join(" OR ") : "";
}

function bitbucketRepoFromPull(pull: BitbucketPull, workspace: string): BitbucketRepo {
  const repo = pull.destination?.repository ?? pull.source?.repository;
  if (repo) {
    return {
      ...repo,
      full_name: repo.full_name || `${repo.workspace?.slug ?? workspace}/${repo.slug}`,
      workspace: { slug: repo.workspace?.slug ?? repo.full_name?.split("/")[0] ?? workspace },
    };
  }
  const match = pull.links?.html?.href?.match(/bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\//);
  const slug = match?.[2] ?? "repository";
  return {
    slug,
    full_name: `${match?.[1] ?? workspace}/${slug}`,
    workspace: { slug: match?.[1] ?? workspace },
  };
}

function bitbucketDiffUrl(repo: BitbucketRepo, pull: BitbucketPull) {
  const workspace = repo.workspace?.slug ?? repo.full_name.split("/")[0];
  return (
    pull.links?.diff?.href ??
    `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo.slug}/pullrequests/${pull.id}/diff`
  );
}

function hasGitHub(settings: AccountSettings) {
  return getGitHubConnections(settings).length > 0;
}

function hasBitbucket(settings: AccountSettings) {
  return getBitbucketConnections(settings).length > 0;
}

function rateLimitCooldownActive(provider: ProviderKind) {
  return (rateLimitCooldownUntil[provider] ?? 0) > Date.now();
}

function startRateLimitCooldown(provider: ProviderKind) {
  rateLimitCooldownUntil[provider] = Date.now() + providerRateLimitCooldownMs;
}

function getGitHubConnections(settings: AccountSettings) {
  const connections = [...(settings.githubConnections ?? [])];
  if (settings.githubToken.trim() && !connections.some((connection) => connection.token === settings.githubToken)) {
    connections.push({ login: "GitHub", token: settings.githubToken.trim() });
  }
  return connections.filter((connection) => connection.token.trim());
}

function getBitbucketConnections(settings: AccountSettings) {
  const connections = [...(settings.bitbucketConnections ?? [])];
  if (settings.bitbucketAccessToken.trim() && settings.bitbucketWorkspaces.trim()) {
    for (const workspace of settings.bitbucketWorkspaces.split(",").map((item) => item.trim()).filter(Boolean)) {
      if (!connections.some((connection) => connection.workspace === workspace)) {
        connections.push({ workspace, token: settings.bitbucketAccessToken.trim() });
      }
    }
  }
  return connections.filter((connection) => connection.workspace.trim() && connection.token.trim());
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}${body ? `: ${body.slice(0, 180)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function parseGitHubRepo(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

function parseGitHubApiPullRequestRef(url: string | undefined, repo: string): GitHubPullRequestRef | undefined {
  if (!url) return undefined;
  const match = url.match(/\/repos\/([^/]+\/[^/]+)\/(?:issues|pulls)\/(\d+)$/);
  const ref = match ? { repo: match[1], number: Number(match[2]) } : { repo, number: Number(url.split("/").pop()) };
  return Number.isFinite(ref.number) && ref.number > 0 ? ref : undefined;
}

function githubNotificationInboxReason(reason: string): PullRequestInboxReason {
  if (reason === "author") return "author";
  if (reason === "review_requested" || reason === "approval_requested") return "reviewer";
  if (reason === "mention" || reason === "team_mention") return "mentioned";
  return "watched";
}

function githubNotificationRole(reason: string): PullRequestViewerRole {
  if (reason === "author") return "author";
  if (reason === "review_requested" || reason === "approval_requested") return "reviewer";
  if (reason === "mention" || reason === "team_mention") return "mentioned";
  return "participant";
}

async function loadGitHubSearchItems(
  headers: HeadersInit,
  query: string,
  onItems?: (items: GitHubSearchItem[]) => Promise<void>,
  onRequest?: ProgressReporter,
): Promise<GitHubSearchItem[]> {
  const items: GitHubSearchItem[] = [];
  for (let page = 1; page <= githubSearchPageLimit; page += 1) {
    onRequest?.(0, 1);
    const response = await requestJson<GitHubSearchResponse>(
      `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${githubSearchPageSize}&page=${page}`,
      { headers },
    );
    items.push(...response.items);
    await onItems?.(response.items);
    onRequest?.(1, 0);
    if (response.items.length < githubSearchPageSize) break;
  }
  return items;
}

async function loadGitHubPagedItems<T>(url: string, headers: HeadersInit, perPage = 100): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const separator = url.includes("?") ? "&" : "?";
    const response = await requestJson<T[]>(`${url}${separator}per_page=${perPage}&page=${page}`, { headers });
    items.push(...response);
    if (response.length < perPage) break;
  }
  return items;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function uniqueRoles(roles: PullRequestViewerRole[]) {
  return [...new Set(roles)];
}

function uniqueInboxReasons(reasons: PullRequestInboxReason[]) {
  return [...new Set(reasons)];
}

function inboxReasonForRole(role: PullRequestViewerRole): PullRequestInboxReason | undefined {
  if (role === "author" || role === "reviewer" || role === "mentioned") return role;
  return undefined;
}

function isInboxReason(value: PullRequestInboxReason | undefined): value is PullRequestInboxReason {
  return value !== undefined;
}

function sortPullRequestsByUpdated(pullRequests: PullRequestSummary[]) {
  return [...pullRequests].sort(
    (left, right) => new Date(right.updatedAtIso).getTime() - new Date(left.updatedAtIso).getTime(),
  );
}

function mergePullRequestSummaries(pullRequests: PullRequestSummary[]) {
  const pullRequestsById = new Map<string, PullRequestSummary>();
  for (const pullRequest of pullRequests) {
    const current = pullRequestsById.get(pullRequest.id);
    pullRequestsById.set(
      pullRequest.id,
      current
        ? {
            ...current,
            ...pullRequest,
            files: pullRequest.filesLoaded ? pullRequest.files : current.filesLoaded ? current.files : pullRequest.files,
            filesLoaded: current.filesLoaded || pullRequest.filesLoaded,
            viewerRoles: uniqueRoles([...(current.viewerRoles ?? []), ...(pullRequest.viewerRoles ?? [])]),
            inboxReasons: uniqueInboxReasons([...(current.inboxReasons ?? []), ...(pullRequest.inboxReasons ?? [])]),
          }
        : pullRequest,
    );
  }
  return sortPullRequestsByUpdated([...pullRequestsById.values()]);
}

function sameBitbucketUser(left: BitbucketUser | undefined, right: BitbucketUser | undefined) {
  if (!left || !right) return false;
  if (left.uuid && right.uuid && left.uuid === right.uuid) return true;
  if (left.account_id && right.account_id && left.account_id === right.account_id) return true;
  if (left.nickname && right.nickname && left.nickname === right.nickname) return true;
  if (left.username && right.username && left.username === right.username) return true;
  if (left.display_name && right.display_name && left.display_name === right.display_name) return true;
  return false;
}

function toBitbucketPullRequestSummary(
  pull: BitbucketPull,
  user: BitbucketUser,
  workspace: string,
  roleHints: PullRequestViewerRole[] = [],
  inboxReasonHints: PullRequestInboxReason[] = [],
): PullRequestSummary {
  const repo = bitbucketRepoFromPull(pull, workspace);
  const repoWorkspace = repo.workspace?.slug ?? repo.full_name.split("/")[0];
  const viewerRoles: PullRequestViewerRole[] = [...roleHints];
  if (sameBitbucketUser(pull.author, user)) viewerRoles.push("author");
  if (pull.reviewers?.some((reviewer) => sameBitbucketUser(reviewer, user))) viewerRoles.push("reviewer");
  if (pull.participants?.some((participant) => sameBitbucketUser(participant.user, user))) {
    viewerRoles.push("participant");
  }
  const inboxReasons = uniqueInboxReasons([
    ...inboxReasonHints,
    ...viewerRoles.map(inboxReasonForRole).filter(isInboxReason),
  ]);
  return {
    id: `bitbucket-${repo.full_name}-${pull.id}`,
    provider: "bitbucket" as const,
    repo: repo.full_name,
    number: pull.id,
    title: pull.title,
    description: pull.summary?.raw?.trim() || undefined,
    url: pull.links?.html?.href ?? `https://bitbucket.org/${repoWorkspace}/${repo.slug}/pull-requests/${pull.id}`,
    author: pull.author?.display_name ?? pull.author?.nickname ?? "unknown",
    branch: pull.source?.branch?.name ?? "source",
    branchUrl: bitbucketBranchUrl(repo, pull.source?.branch?.name),
    target: pull.destination?.branch?.name ?? "target",
    targetUrl: bitbucketBranchUrl(repo, pull.destination?.branch?.name),
    updatedAt: formatDate(pull.updated_on),
    updatedAtIso: pull.updated_on,
    additions: 0,
    deletions: 0,
    comments: pull.comment_count ?? 0,
    state: "waiting" as const,
    viewerRoles: uniqueRoles(viewerRoles),
    inboxReasons,
    filesLoaded: false,
    connectionId: workspace,
    files: [],
    diffUrl: bitbucketDiffUrl(repo, pull),
  };
}

function toFile(filename: string, patch: string | undefined, file: Partial<ReviewFile> = {}): ReviewFile {
  return {
    path: filename,
    language: languageFromPath(filename),
    status: file.status ?? "modified",
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    diff: patch?.startsWith("@@") ? patch : `@@ -1,1 +1,1 @@\n ${patch || "No textual diff available."}`,
    diffUrl: file.diffUrl,
  };
}

function toReviewFileStatus(status: string): ReviewFile["status"] {
  if (status === "added") return "added";
  if (status === "removed" || status === "deleted") return "deleted";
  if (status === "renamed") return "renamed";
  return "modified";
}

function cleanDiffPath(path: string) {
  return path.replace(/^"|"$/g, "").replace(/^a\//, "").replace(/^b\//, "");
}

function bitbucketFilePathFromHeaders(oldHeader: string | undefined, newHeader: string | undefined) {
  const oldPath = oldHeader?.replace(/^---\s+/, "").split("\t")[0];
  const newPath = newHeader?.replace(/^\+\+\+\s+/, "").split("\t")[0];
  const preferred = newPath && newPath !== "/dev/null" ? newPath : oldPath;
  return preferred && preferred !== "/dev/null" ? cleanDiffPath(preferred) : "changed-file";
}

function splitBitbucketDiff(diff: string, diffUrl: string): ReviewFile[] {
  const lines = diff.split("\n");
  const files: ReviewFile[] = [];
  let currentLines: string[] = [];
  let currentPath = "";
  let oldHeader: string | undefined;
  let newHeader: string | undefined;

  const pushCurrent = () => {
    if (currentLines.length === 0) return;
    const fileDiff = currentLines.join("\n");
    const additions = currentLines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const deletions = currentLines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    files.push(toFile(currentPath || bitbucketFilePathFromHeaders(oldHeader, newHeader), fileDiff, {
      additions,
      deletions,
      diffUrl,
    }));
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      pushCurrent();
      currentLines = [line];
      oldHeader = undefined;
      newHeader = undefined;
      const match = line.match(/^diff --git\s+(.+?)\s+(.+)$/);
      currentPath = match ? cleanDiffPath(match[2]) : "";
      continue;
    }

    if (currentLines.length === 0) {
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
    if (line.startsWith("--- ")) oldHeader = line;
    if (line.startsWith("+++ ")) {
      newHeader = line;
      currentPath = bitbucketFilePathFromHeaders(oldHeader, newHeader);
    }
  }

  pushCurrent();
  return files.length > 0 ? files : [toFile("diff", diff || undefined, { diffUrl })];
}

async function loadGitHubPullRequests(
  settings: AccountSettings,
  scope: PullRequestViewerRole,
  options: LoadOptions = {},
): Promise<PullRequestSummary[]> {
  const connections = getGitHubConnections(settings);
  if (connections.length === 0) return [];
  let completed = 0;
  let total = 0;
  const reportProgress: ProgressReporter = (completedDelta = 0, totalDelta = 0) => {
    completed += completedDelta;
    total += totalDelta;
    options.onProgress?.({ provider: "github", completed, total: Math.max(total, completed, 1) });
  };
  const groups = await Promise.all(
    connections.map((connection) => loadGitHubPullRequestsForToken(connection.token, scope, options, reportProgress)),
  );
  return groups.flat();
}

async function loadGitHubPullRequestsForToken(
  token: string,
  scope: PullRequestViewerRole,
  options: LoadOptions = {},
  reportProgress: ProgressReporter = () => {},
): Promise<PullRequestSummary[]> {
  const headers = githubHeaders(token);
  reportProgress(0, 1);
  const user = await requestJson<GitHubUser>("https://api.github.com/user", { headers });
  reportProgress(1, 0);
  const roleQueries: Array<{ role: PullRequestViewerRole; query: string }> = [
    { role: "author", query: `is:pr is:open author:${user.login}` },
  ];
  const roleQuery = roleQueries.find(({ role }) => role === scope);
  if (!roleQuery) return [];

  return loadGitHubQueryPullRequests(
    roleQuery.query,
    { headers, userLogin: user.login, role: roleQuery.role, inboxReason: inboxReasonForRole(roleQuery.role) },
    options,
    reportProgress,
  );
}

async function loadGitHubQueryPullRequests(
  query: string,
  context: GitHubPullRequestContext,
  options: LoadOptions = {},
  reportProgress: ProgressReporter = () => {},
): Promise<PullRequestSummary[]> {
  const pullRequests: PullRequestSummary[] = [];
  await loadGitHubSearchItems(context.headers, query, async (items) => {
    const pageItems = items.filter((entry) => entry.pull_request);
    reportProgress(0, pageItems.length);
    const pagePullRequests = await mapWithConcurrency(pageItems, githubRequestConcurrency, async (item) => {
      const repoRef = parseGitHubRepo(item.html_url);
      if (!repoRef) {
        reportProgress(1, 0);
        return null;
      }
      const baseUrl = `https://api.github.com/repos/${repoRef.owner}/${repoRef.repo}/pulls/${repoRef.number}`;
      const pull = await requestJson<GitHubPull>(baseUrl, { headers: context.headers });
      reportProgress(1, 0);
      return {
        id: `github-${repoRef.owner}-${repoRef.repo}-${repoRef.number}`,
        provider: "github" as const,
        repo: `${repoRef.owner}/${repoRef.repo}`,
        number: item.number,
        title: item.title,
        description: pull.body?.trim() || undefined,
        url: item.html_url,
        author: item.user.login,
        branch: pull.head.ref,
        branchUrl: githubBranchUrl(pull.head.repo?.html_url, pull.head.ref),
        target: pull.base.ref,
        targetUrl: githubBranchUrl(pull.base.repo?.html_url, pull.base.ref),
        updatedAt: formatDate(item.updated_at),
        updatedAtIso: item.updated_at,
        additions: pull.additions ?? 0,
        deletions: pull.deletions ?? 0,
        comments: item.comments + (pull.review_comments ?? 0),
        state: "waiting" as const,
        viewerRoles: [context.role],
        inboxReasons: context.inboxReason ? [context.inboxReason] : [],
        filesLoaded: false,
        connectionId: context.userLogin,
        files: [
          toFile("pullrequest.diff", "GitHub file changes will load when this pull request is selected.", {
            additions: pull.additions ?? 0,
            deletions: pull.deletions ?? 0,
            diffUrl: `${baseUrl}/files`,
          }),
        ],
      };
    });
    const summaries = pagePullRequests.filter((item) => item !== null);
    pullRequests.push(...summaries);
    options.onPullRequests?.(summaries);
  }, reportProgress);

  return pullRequests;
}

async function loadGitHubNotifications(
  headers: HeadersInit,
  reportProgress: ProgressReporter,
): Promise<GitHubNotification[]> {
  const notifications: GitHubNotification[] = [];
  for (let page = 1; page <= githubNotificationPageLimit; page += 1) {
    reportProgress(0, 1);
    const items = await requestJson<GitHubNotification[]>(
      `https://api.github.com/notifications?all=true&participating=false&per_page=50&page=${page}`,
      { headers },
    );
    reportProgress(1, 0);
    notifications.push(...items);
    if (items.length < 50) break;
  }
  return notifications;
}

async function loadGitHubPullRequestFromRef(
  ref: GitHubPullRequestRef,
  context: GitHubPullRequestContext,
  reportProgress: ProgressReporter,
): Promise<PullRequestSummary[]> {
  const baseUrl = `https://api.github.com/repos/${ref.repo}/pulls/${ref.number}`;
  reportProgress(0, 1);
  const pull = await requestJson<GitHubPull>(baseUrl, { headers: context.headers });
  reportProgress(1, 0);
  if (pull.state && pull.state !== "open") {
    return [];
  }
  const updatedAtIso = pull.updated_at ?? new Date().toISOString();
  const number = pull.number ?? ref.number;
  return [
    {
      id: `github-${ref.repo.replace("/", "-")}-${number}`,
      provider: "github" as const,
      repo: ref.repo,
      number,
      title: pull.title ?? `Pull request #${number}`,
      description: pull.body?.trim() || undefined,
      url: pull.html_url,
      author: pull.user?.login ?? "unknown",
      branch: pull.head.ref,
      branchUrl: githubBranchUrl(pull.head.repo?.html_url, pull.head.ref),
      target: pull.base.ref,
      targetUrl: githubBranchUrl(pull.base.repo?.html_url, pull.base.ref),
      updatedAt: formatDate(updatedAtIso),
      updatedAtIso,
      additions: pull.additions ?? 0,
      deletions: pull.deletions ?? 0,
      comments: (pull.comments ?? 0) + (pull.review_comments ?? 0),
      state: "waiting" as const,
      viewerRoles: [context.role],
      inboxReasons: context.inboxReason ? [context.inboxReason] : [],
      filesLoaded: false,
      connectionId: context.userLogin,
      files: [
        toFile("pullrequest.diff", "GitHub file changes will load when this pull request is selected.", {
          additions: pull.additions ?? 0,
          deletions: pull.deletions ?? 0,
          diffUrl: `${baseUrl}/files`,
        }),
      ],
    },
  ];
}

async function loadGitHubInboxPullRequestsForToken(
  token: string,
  options: LoadOptions = {},
  reportProgress: ProgressReporter = () => {},
): Promise<PullRequestSummary[]> {
  const headers = githubHeaders(token);
  reportProgress(0, 1);
  const user = await requestJson<GitHubUser>("https://api.github.com/user", { headers });
  reportProgress(1, 0);
  const context = (role: PullRequestViewerRole, reason: PullRequestInboxReason) => ({
    headers,
    userLogin: user.login,
    role,
    inboxReason: reason,
  });
  const roleQueries: Array<{ role: PullRequestViewerRole; reason: PullRequestInboxReason; query: string }> = [
    { role: "author", reason: "author", query: `is:pr is:open author:${user.login}` },
  ];
  const roleGroups = await mapWithConcurrency(
    roleQueries,
    githubInboxQueryConcurrency,
    async (item) => {
      try {
        return await loadGitHubQueryPullRequests(item.query, context(item.role, item.reason), options, reportProgress);
      } catch (error) {
        if (!isRateLimited(error)) throw error;
        startRateLimitCooldown("github");
        options.onWarning?.("GitHub rate-limited inbox loading. Showing the pull requests found so far.");
        return [];
      }
    },
  );

  let notifications: GitHubNotification[] = [];
  if (rateLimitCooldownActive("github")) {
    options.onWarning?.("GitHub recently rate-limited notification loading. Skipping GitHub notifications for a few minutes.");
  } else {
    try {
      notifications = await loadGitHubNotifications(headers, reportProgress);
    } catch (error) {
      if (!isRateLimited(error)) throw error;
      startRateLimitCooldown("github");
      options.onWarning?.("GitHub rate-limited notification loading. Showing authored pull requests only for now.");
    }
  }
  const notificationRefs = notifications
    .filter((notification) => notification.subject.type === "PullRequest")
    .map((notification) => ({
      notification,
      ref: parseGitHubApiPullRequestRef(notification.subject.url, notification.repository.full_name),
    }))
    .filter((item): item is { notification: GitHubNotification; ref: GitHubPullRequestRef } => item.ref !== undefined);
  const notificationGroups = await mapWithConcurrency(notificationRefs, githubInboxQueryConcurrency, async ({ notification, ref }) => {
    try {
      const items = await loadGitHubPullRequestFromRef(
        ref,
        context(githubNotificationRole(notification.reason), githubNotificationInboxReason(notification.reason)),
        reportProgress,
      );
      const updatedItems = items.map((item) => ({
        ...item,
        title: item.title || notification.subject.title,
        updatedAt: formatDate(notification.updated_at),
        updatedAtIso: notification.updated_at,
      }));
      options.onPullRequests?.(updatedItems);
      return updatedItems;
    } catch (error) {
      if (!isRateLimited(error)) throw error;
      startRateLimitCooldown("github");
      options.onWarning?.("GitHub rate-limited notification PR loading. Showing the pull requests found so far.");
      return [];
    }
  });
  return mergePullRequestSummaries([...roleGroups.flat(), ...notificationGroups.flat()]);
}

async function loadGitHubInboxPullRequests(
  settings: AccountSettings,
  options: LoadOptions = {},
): Promise<PullRequestSummary[]> {
  const connections = getGitHubConnections(settings);
  if (connections.length === 0) return [];
  let completed = 0;
  let total = 0;
  const reportProgress: ProgressReporter = (completedDelta = 0, totalDelta = 0) => {
    completed += completedDelta;
    total += totalDelta;
    options.onProgress?.({ provider: "github", completed, total: Math.max(total, completed, 1) });
  };
  const groups = await Promise.all(
    connections.map((connection) => loadGitHubInboxPullRequestsForToken(connection.token, options, reportProgress)),
  );
  return mergePullRequestSummaries(groups.flat());
}

function bitbucketHeadersForToken(token: string): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function isUnauthorized(error: unknown) {
  return error instanceof Error && /^401\b/.test(error.message);
}

function isRateLimited(error: unknown) {
  return error instanceof Error && (/^429\b/.test(error.message) || /^403\b.*rate limit/i.test(error.message));
}

async function refreshBitbucketConnection(connection: BitbucketConnection) {
  if (!connection.refreshToken) {
    throw new Error(
      "Bitbucket access token expired and this saved connection does not have a refresh token yet. Disconnect and reconnect Bitbucket once.",
    );
  }
  if (!oauthConfig.bitbucketBrokerUrl) {
    throw new Error("Bitbucket access token expired and no hosted broker URL is configured for refresh.");
  }

  const response = await fetch(new URL("/api/bitbucket/refresh", oauthConfig.bitbucketBrokerUrl), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: connection.refreshToken }),
  });
  const token = await response.json();
  if (!response.ok || token.error || !token.access_token) {
    throw new Error(token.error || "Bitbucket token refresh failed. Reconnect Bitbucket and try again.");
  }

  connection.token = token.access_token;
  if (token.refresh_token) connection.refreshToken = token.refresh_token;
}

async function requestBitbucketJson<T>(url: string, connection: BitbucketConnection): Promise<T> {
  try {
    return await requestJson<T>(url, { headers: bitbucketHeadersForToken(connection.token) });
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    await refreshBitbucketConnection(connection);
    return requestJson<T>(url, { headers: bitbucketHeadersForToken(connection.token) });
  }
}

async function fetchBitbucketText(url: string, connection: BitbucketConnection): Promise<string> {
  const fetchWithToken = () => fetch(url, { headers: bitbucketHeadersForToken(connection.token) });
  let response = await fetchWithToken();
  if (response.status === 401) {
    await refreshBitbucketConnection(connection);
    response = await fetchWithToken();
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}${body ? `: ${body.slice(0, 180)}` : ""}`);
  }
  return response.text();
}

async function loadBitbucketPage<T>(
  url: string,
  connection: BitbucketConnection,
  limit = 50,
  onValues?: (values: T[]) => void,
  onRequest?: ProgressReporter,
): Promise<T[]> {
  const values: T[] = [];
  let next: string | undefined = url;
  while (next && values.length < limit) {
    onRequest?.(0, 1);
    const page: { values: T[]; next?: string } = await requestBitbucketJson(next, connection);
    onRequest?.(1, 0);
    const pageValues = page.values.slice(0, limit - values.length);
    values.push(...pageValues);
    onValues?.(pageValues);
    next = page.next;
  }
  return values.slice(0, limit);
}

async function loadBitbucketPullRequests(
  settings: AccountSettings,
  scope: PullRequestViewerRole,
  options: LoadOptions = {},
): Promise<PullRequestSummary[]> {
  const connections = getBitbucketConnections(settings);
  if (connections.length === 0) return [];
  let completed = 0;
  let total = 0;
  const reportProgress: ProgressReporter = (completedDelta = 0, totalDelta = 0) => {
    completed += completedDelta;
    total += totalDelta;
    options.onProgress?.({ provider: "bitbucket", completed, total: Math.max(total, completed, 1) });
  };
  const groups = await Promise.all(
    connections.map((connection) => loadBitbucketWorkspacePullRequests(connection, scope, options, reportProgress)),
  );
  return groups.flat();
}

async function loadBitbucketAuthoredPullRequests(
  connection: BitbucketConnection,
  user: BitbucketUser,
  selectedUser: string,
  options: LoadOptions = {},
  reportProgress: ProgressReporter = () => {},
): Promise<PullRequestSummary[]> {
  const pulls = await loadBitbucketPage<BitbucketPull>(
    `https://api.bitbucket.org/2.0/workspaces/${connection.workspace}/pullrequests/${encodeURIComponent(
      selectedUser,
    )}?state=OPEN&sort=-updated_on&pagelen=50`,
    connection,
    bitbucketPullRequestLimit,
    (items) =>
      options.onPullRequests?.(
        items.map((pull) => toBitbucketPullRequestSummary(pull, user, connection.workspace, ["author"], ["author"])),
      ),
    reportProgress,
  );
  return pulls.map((pull) => toBitbucketPullRequestSummary(pull, user, connection.workspace, ["author"], ["author"]));
}

async function loadBitbucketReviewerRepositories(
  connection: BitbucketConnection,
  reportProgress: ProgressReporter,
): Promise<string[]> {
  if (connection.repositories && connection.repositories.length > 0) {
    return connection.repositories;
  }

  const repos = await loadBitbucketPage<BitbucketRepo>(
    `https://api.bitbucket.org/2.0/repositories/${connection.workspace}?sort=-updated_on&pagelen=50`,
    connection,
    bitbucketReviewerRepoLimit,
    undefined,
    reportProgress,
  );
  connection.repositories = repos.map((repo) => repo.slug).filter(Boolean);
  return connection.repositories;
}

async function loadBitbucketReviewerPullRequests(
  connection: BitbucketConnection,
  user: BitbucketUser,
  options: LoadOptions = {},
  reportProgress: ProgressReporter = () => {},
  repositorySlugs?: string[],
): Promise<PullRequestSummary[]> {
  const reviewerQuery = bitbucketReviewerQuery(user);
  if (!reviewerQuery) return [];
  const repos = (repositorySlugs ?? (await loadBitbucketReviewerRepositories(connection, reportProgress))).slice(
    0,
    bitbucketReviewerRepoLimit,
  );
  if (repos.length === 0) return [];

  let rateLimited = false;
  let warned = false;
  reportProgress(0, repos.length);
  const pullGroups = await mapWithConcurrency(repos, bitbucketReviewerRequestConcurrency, async (repo) => {
    if (rateLimited) return [];
    let firstPage = true;
    const reportRepoProgress: ProgressReporter = (completedDelta = 0, totalDelta = 0) => {
      if (totalDelta > 0 && firstPage) return;
      reportProgress(completedDelta, totalDelta);
      if (completedDelta > 0) firstPage = false;
    };
    try {
      return loadBitbucketPage<BitbucketPull>(
        `https://api.bitbucket.org/2.0/repositories/${connection.workspace}/${repo}/pullrequests?state=OPEN&q=${encodeURIComponent(
          reviewerQuery,
        )}&sort=-updated_on&pagelen=50`,
        connection,
        bitbucketReviewerPullRequestLimit,
        (items) =>
          options.onPullRequests?.(
            items.map((pull) => toBitbucketPullRequestSummary(pull, user, connection.workspace, ["reviewer"], ["reviewer"])),
          ),
        reportRepoProgress,
      );
    } catch (error) {
      if (isRateLimited(error)) {
        rateLimited = true;
        startRateLimitCooldown("bitbucket");
        if (firstPage) reportProgress(1, 0);
        if (!warned) {
          warned = true;
          options.onWarning?.("Bitbucket rate-limited reviewer PR loading. Showing the pull requests found so far.");
        }
        return [];
      }
      throw error;
    }
  });

  const pulls = pullGroups.flat();
  return pulls.map((pull) => toBitbucketPullRequestSummary(pull, user, connection.workspace, ["reviewer"], ["reviewer"]));
}

async function loadBitbucketWatchedPullRequests(
  connection: BitbucketConnection,
  user: BitbucketUser,
  options: LoadOptions = {},
  reportProgress: ProgressReporter = () => {},
  repositorySlugs?: string[],
): Promise<PullRequestSummary[]> {
  const repos = (repositorySlugs ?? (await loadBitbucketReviewerRepositories(connection, reportProgress))).slice(
    0,
    bitbucketReviewerRepoLimit,
  );
  if (repos.length === 0) return [];

  let rateLimited = false;
  let warned = false;
  reportProgress(0, repos.length);
  const pullGroups = await mapWithConcurrency(repos, bitbucketReviewerRequestConcurrency, async (repo) => {
    if (rateLimited) return [];
    let firstPage = true;
    const reportRepoProgress: ProgressReporter = (completedDelta = 0, totalDelta = 0) => {
      if (totalDelta > 0 && firstPage) return;
      reportProgress(completedDelta, totalDelta);
      if (completedDelta > 0) firstPage = false;
    };
    try {
      return loadBitbucketPage<BitbucketPull>(
        `https://api.bitbucket.org/2.0/repositories/${connection.workspace}/${repo}/pullrequests?state=OPEN&sort=-updated_on&pagelen=50`,
        connection,
        bitbucketWatchedPullRequestLimit,
        (items) =>
          options.onPullRequests?.(
            items.map((pull) => toBitbucketPullRequestSummary(pull, user, connection.workspace, [], ["watched"])),
          ),
        reportRepoProgress,
      );
    } catch (error) {
      if (isRateLimited(error)) {
        rateLimited = true;
        startRateLimitCooldown("bitbucket");
        if (firstPage) reportProgress(1, 0);
        if (!warned) {
          warned = true;
          options.onWarning?.("Bitbucket rate-limited watched repo PR loading. Showing the pull requests found so far.");
        }
        return [];
      }
      throw error;
    }
  });

  return pullGroups
    .flat()
    .map((pull) => toBitbucketPullRequestSummary(pull, user, connection.workspace, [], ["watched"]));
}

async function loadBitbucketWorkspacePullRequests(
  connection: BitbucketConnection,
  scope: PullRequestViewerRole,
  options: LoadOptions = {},
  reportProgress: ProgressReporter = () => {},
): Promise<PullRequestSummary[]> {
  reportProgress(0, 1);
  const user = await requestBitbucketJson<BitbucketUser>("https://api.bitbucket.org/2.0/user", connection);
  reportProgress(1, 0);
  const selectedUser = bitbucketSelectedUser(user);
  if (!selectedUser) throw new Error("Bitbucket did not return a usable current user ID.");

  const [authoredPullRequests, reviewerPullRequests] = await Promise.all([
    scope === "author"
      ? loadBitbucketAuthoredPullRequests(connection, user, selectedUser, options, reportProgress)
      : Promise.resolve([]),
    scope === "reviewer"
      ? loadBitbucketReviewerPullRequests(connection, user, options, reportProgress)
      : Promise.resolve([]),
  ]);
  return mergePullRequestSummaries([...authoredPullRequests, ...reviewerPullRequests]);
}

async function loadBitbucketWorkspaceInboxPullRequests(
  connection: BitbucketConnection,
  options: LoadOptions = {},
  reportProgress: ProgressReporter = () => {},
): Promise<PullRequestSummary[]> {
  reportProgress(0, 1);
  const user = await requestBitbucketJson<BitbucketUser>("https://api.bitbucket.org/2.0/user", connection);
  reportProgress(1, 0);
  const selectedUser = bitbucketSelectedUser(user);
  if (!selectedUser) throw new Error("Bitbucket did not return a usable current user ID.");
  let repositorySlugs: string[] = [];
  if (rateLimitCooldownActive("bitbucket")) {
    options.onWarning?.("Bitbucket recently rate-limited inbox loading. Skipping watched repositories for a few minutes.");
  } else {
    try {
      repositorySlugs = await loadBitbucketReviewerRepositories(connection, reportProgress);
    } catch (error) {
      if (!isRateLimited(error)) throw error;
      startRateLimitCooldown("bitbucket");
      options.onWarning?.("Bitbucket rate-limited repository discovery. Showing authored pull requests only for now.");
    }
  }

  const [authoredPullRequests, watchedPullRequests] = await Promise.all([
    loadBitbucketAuthoredPullRequests(connection, user, selectedUser, options, reportProgress),
    repositorySlugs.length > 0
      ? loadBitbucketWatchedPullRequests(connection, user, options, reportProgress, repositorySlugs)
      : Promise.resolve([]),
  ]);
  return mergePullRequestSummaries([...authoredPullRequests, ...watchedPullRequests]);
}

async function loadBitbucketInboxPullRequests(
  settings: AccountSettings,
  options: LoadOptions = {},
): Promise<PullRequestSummary[]> {
  const connections = getBitbucketConnections(settings);
  if (connections.length === 0) return [];
  let completed = 0;
  let total = 0;
  const reportProgress: ProgressReporter = (completedDelta = 0, totalDelta = 0) => {
    completed += completedDelta;
    total += totalDelta;
    options.onProgress?.({ provider: "bitbucket", completed, total: Math.max(total, completed, 1) });
  };
  const groups = await Promise.all(
    connections.map((connection) => loadBitbucketWorkspaceInboxPullRequests(connection, options, reportProgress)),
  );
  return mergePullRequestSummaries(groups.flat());
}

export async function loadPullRequestFiles(
  settings: AccountSettings,
  pullRequest: PullRequestSummary,
): Promise<{ pullRequest: PullRequestSummary; updatedSettings?: AccountSettings }> {
  if (pullRequest.filesLoaded) {
    return { pullRequest };
  }

  const workingSettings = structuredClone(settings);
  const diffUrl = pullRequest.diffUrl ?? pullRequest.files[0]?.diffUrl;
  if (!diffUrl) {
    throw new Error(`${pullRequest.provider === "github" ? "GitHub" : "Bitbucket"} file changes URL is missing for this pull request.`);
  }

  if (pullRequest.provider === "github") {
    const connections = getGitHubConnections(workingSettings);
    const connection =
      connections.find((item) => item.login === pullRequest.connectionId) ?? connections[0];
    if (!connection) throw new Error("GitHub connection is missing for this pull request.");
    const files = await loadGitHubPagedItems<GitHubFile>(diffUrl, githubHeaders(connection.token));
    return {
      pullRequest: {
        ...pullRequest,
        filesLoaded: true,
        files: files.map((file) =>
          toFile(file.filename, file.patch, {
            status: toReviewFileStatus(file.status),
            additions: file.additions,
            deletions: file.deletions,
            diffUrl,
          }),
        ),
      },
    };
  }

  const workspace = pullRequest.connectionId ?? pullRequest.repo.split("/")[0];
  const connection = getBitbucketConnections(workingSettings).find((item) => item.workspace === workspace);
  if (!connection) {
    throw new Error("Bitbucket connection is missing for this pull request.");
  }
  const diff = await fetchBitbucketText(diffUrl, connection);
  const files = splitBitbucketDiff(diff, diffUrl);
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return {
    pullRequest: {
      ...pullRequest,
      additions,
      deletions,
      filesLoaded: true,
      files,
    },
    updatedSettings: JSON.stringify(workingSettings) === JSON.stringify(settings) ? undefined : workingSettings,
  };
}

export const providers: PullRequestProvider[] = [
  {
    kind: "github",
    label: "GitHub",
    color: "#6ee7b7",
    async loadPullRequests(settings, scope, options) {
      return loadGitHubPullRequests(settings, scope, options);
    },
    async loadInboxPullRequests(settings, options) {
      return loadGitHubInboxPullRequests(settings, options);
    },
    async publishComment(comment) {
      return { ...comment, pending: false };
    },
  },
  {
    kind: "bitbucket",
    label: "Bitbucket",
    color: "#7dd3fc",
    async loadPullRequests(settings, scope, options) {
      return loadBitbucketPullRequests(settings, scope, options);
    },
    async loadInboxPullRequests(settings, options) {
      return loadBitbucketInboxPullRequests(settings, options);
    },
    async publishComment(comment) {
      return { ...comment, pending: false };
    },
  },
];

export async function loadAllPullRequests(
  settings: AccountSettings,
  scope: PullRequestViewerRole = "reviewer",
  options: LoadOptions = {},
): Promise<LoadResult> {
  const workingSettings = structuredClone(settings);
  const hasAnyAccount = hasGitHub(workingSettings) || hasBitbucket(workingSettings);
  if (!hasAnyAccount) {
    return { pullRequests: [], errors: [], usingDemo: false };
  }

  const settled = await Promise.allSettled(
    providers.map((provider) => provider.loadPullRequests(workingSettings, scope, options)),
  );
  const pullRequests = settled.flatMap((item) => (item.status === "fulfilled" ? item.value : []));
  const errors = settled.flatMap((item, index) =>
    item.status === "rejected" ? [`${providers[index].label}: ${item.reason instanceof Error ? item.reason.message : "failed"}`] : [],
  );
  return {
    pullRequests,
    errors,
    usingDemo: false,
    updatedSettings: JSON.stringify(workingSettings) === JSON.stringify(settings) ? undefined : workingSettings,
  };
}

export async function loadInboxPullRequests(
  settings: AccountSettings,
  options: LoadOptions = {},
): Promise<LoadResult> {
  const workingSettings = structuredClone(settings);
  const hasAnyAccount = hasGitHub(workingSettings) || hasBitbucket(workingSettings);
  if (!hasAnyAccount) {
    return { pullRequests: [], errors: [], usingDemo: false };
  }

  const settled = await Promise.allSettled(
    providers.map((provider) => provider.loadInboxPullRequests(workingSettings, options)),
  );
  const pullRequests = mergePullRequestSummaries(
    settled.flatMap((item) => (item.status === "fulfilled" ? item.value : [])),
  );
  const errors = settled.flatMap((item, index) =>
    item.status === "rejected" ? [`${providers[index].label}: ${item.reason instanceof Error ? item.reason.message : "failed"}`] : [],
  );
  return {
    pullRequests,
    errors,
    usingDemo: false,
    updatedSettings: JSON.stringify(workingSettings) === JSON.stringify(settings) ? undefined : workingSettings,
  };
}
