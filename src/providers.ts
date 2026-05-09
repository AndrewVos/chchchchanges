import { languageFromPath } from "./diff";
import type { AccountSettings, PullRequestSummary, ProviderKind, ReviewComment, ReviewFile } from "./types";

type PullRequestProvider = {
  kind: ProviderKind;
  label: string;
  color: string;
  loadPullRequests(settings: AccountSettings): Promise<PullRequestSummary[]>;
  publishComment(comment: ReviewComment): Promise<ReviewComment>;
};

export type LoadResult = {
  pullRequests: PullRequestSummary[];
  errors: string[];
  usingDemo: boolean;
};

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
    author: "maya",
    branch: "maya/cache-review-filters",
    target: "main",
    updatedAt: "12 min ago",
    additions: 32,
    deletions: 9,
    comments: 4,
    state: "waiting",
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
    author: "niko",
    branch: "niko/provider-session",
    target: "main",
    updatedAt: "42 min ago",
    additions: 18,
    deletions: 7,
    comments: 2,
    state: "changes-requested",
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
    author: "ren",
    branch: "ren/pipeline-attention",
    target: "develop",
    updatedAt: "1 hr ago",
    additions: 16,
    deletions: 5,
    comments: 7,
    state: "commented",
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
  head: { ref: string };
  base: { ref: string };
  additions: number;
  deletions: number;
  review_comments: number;
};

type BitbucketUser = { username?: string; display_name?: string };
type BitbucketWorkspace = { slug: string };
type BitbucketRepo = { slug: string; full_name: string; workspace: { slug: string } };
type BitbucketPull = {
  id: number;
  title: string;
  author?: { display_name?: string; nickname?: string };
  source?: { branch?: { name?: string } };
  destination?: { branch?: { name?: string } };
  updated_on: string;
  comment_count?: number;
};

function hasGitHub(settings: AccountSettings) {
  return settings.githubToken.trim().length > 0;
}

function hasBitbucket(settings: AccountSettings) {
  return settings.bitbucketAccessToken.trim().length > 0;
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}${body ? `: ${body.slice(0, 180)}` : ""}`);
  }
  return response.json() as Promise<T>;
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function toFile(filename: string, patch: string | undefined, file: Partial<ReviewFile> = {}): ReviewFile {
  return {
    path: filename,
    language: languageFromPath(filename),
    status: file.status ?? "modified",
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    diff: patch?.startsWith("@@") ? patch : `@@ -1,1 +1,1 @@\n ${patch || "No textual diff available."}`,
  };
}

function toReviewFileStatus(status: string): ReviewFile["status"] {
  if (status === "added") return "added";
  if (status === "removed" || status === "deleted") return "deleted";
  if (status === "renamed") return "renamed";
  return "modified";
}

async function loadGitHubPullRequests(settings: AccountSettings): Promise<PullRequestSummary[]> {
  if (!hasGitHub(settings)) return [];
  const headers = githubHeaders(settings.githubToken.trim());
  const user = await requestJson<GitHubUser>("https://api.github.com/user", { headers });
  const search = await requestJson<GitHubSearchResponse>(
    `https://api.github.com/search/issues?q=${encodeURIComponent(
      `is:pr is:open involves:${user.login}`,
    )}&sort=updated&order=desc&per_page=20`,
    { headers },
  );

  const pullRequests: Array<PullRequestSummary | null> = await Promise.all(
    search.items.filter((item) => item.pull_request).map(async (item) => {
      const repoRef = parseGitHubRepo(item.html_url);
      if (!repoRef) return null;
      const baseUrl = `https://api.github.com/repos/${repoRef.owner}/${repoRef.repo}/pulls/${repoRef.number}`;
      const [pull, files] = await Promise.all([
        requestJson<GitHubPull>(baseUrl, { headers }),
        requestJson<GitHubFile[]>(`${baseUrl}/files`, { headers }),
      ]);
      return {
        id: `github-${repoRef.owner}-${repoRef.repo}-${repoRef.number}`,
        provider: "github" as const,
        repo: `${repoRef.owner}/${repoRef.repo}`,
        number: item.number,
        title: item.title,
        author: item.user.login,
        branch: pull.head.ref,
        target: pull.base.ref,
        updatedAt: formatDate(item.updated_at),
        additions: pull.additions,
        deletions: pull.deletions,
        comments: item.comments + pull.review_comments,
        state: "waiting" as const,
        files: files.map((file) =>
          toFile(file.filename, file.patch, {
            status: toReviewFileStatus(file.status),
            additions: file.additions,
            deletions: file.deletions,
          }),
        ),
      };
    }),
  );

  return pullRequests.filter((item): item is PullRequestSummary => item !== null);
}

function bitbucketHeaders(settings: AccountSettings): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${settings.bitbucketAccessToken.trim()}`,
  };
}

async function loadBitbucketPage<T>(url: string, headers: HeadersInit, limit = 50): Promise<T[]> {
  const values: T[] = [];
  let next: string | undefined = url;
  while (next && values.length < limit) {
    const page: { values: T[]; next?: string } = await requestJson(next, { headers });
    values.push(...page.values);
    next = page.next;
  }
  return values.slice(0, limit);
}

async function loadBitbucketPullRequests(settings: AccountSettings): Promise<PullRequestSummary[]> {
  if (!hasBitbucket(settings)) return [];
  const headers = bitbucketHeaders(settings);
  await requestJson<BitbucketUser>("https://api.bitbucket.org/2.0/user", { headers });
  const configuredWorkspaces = settings.bitbucketWorkspaces
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const workspaces =
    configuredWorkspaces.length > 0
      ? configuredWorkspaces
      : (
          await loadBitbucketPage<BitbucketWorkspace>(
            "https://api.bitbucket.org/2.0/workspaces?role=member&pagelen=50",
            headers,
          )
        ).map((workspace) => workspace.slug);

  const repos = (
    await Promise.all(
      workspaces.map((workspace) =>
        loadBitbucketPage<BitbucketRepo>(
          `https://api.bitbucket.org/2.0/repositories/${workspace}?role=member&pagelen=50`,
          headers,
          50,
        ),
      ),
    )
  ).flat();

  const openPullRequests = (
    await Promise.all(
      repos.slice(0, 40).map(async (repo) => {
        const pulls = await loadBitbucketPage<BitbucketPull>(
          `https://api.bitbucket.org/2.0/repositories/${repo.workspace.slug}/${repo.slug}/pullrequests?state=OPEN&pagelen=20`,
          headers,
          20,
        );
        return pulls.map((pull) => ({ repo, pull }));
      }),
    )
  ).flat();

  const summaries = await Promise.all(
    openPullRequests.slice(0, 30).map(async ({ repo, pull }) => {
      const diff = await fetch(
        `https://api.bitbucket.org/2.0/repositories/${repo.workspace.slug}/${repo.slug}/pullrequests/${pull.id}/diff`,
        { headers },
      ).then((response) => (response.ok ? response.text() : ""));
      const additions = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
      const deletions = diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
      return {
        id: `bitbucket-${repo.full_name}-${pull.id}`,
        provider: "bitbucket" as const,
        repo: repo.full_name,
        number: pull.id,
        title: pull.title,
        author: pull.author?.display_name ?? pull.author?.nickname ?? "unknown",
        branch: pull.source?.branch?.name ?? "source",
        target: pull.destination?.branch?.name ?? "target",
        updatedAt: formatDate(pull.updated_on),
        additions,
        deletions,
        comments: pull.comment_count ?? 0,
        state: "waiting" as const,
        files: [toFile("pullrequest.diff", diff || undefined, { additions, deletions })],
      };
    }),
  );

  return summaries;
}

export const providers: PullRequestProvider[] = [
  {
    kind: "github",
    label: "GitHub",
    color: "#6ee7b7",
    async loadPullRequests(settings) {
      return loadGitHubPullRequests(settings);
    },
    async publishComment(comment) {
      return { ...comment, pending: false };
    },
  },
  {
    kind: "bitbucket",
    label: "Bitbucket",
    color: "#7dd3fc",
    async loadPullRequests(settings) {
      return loadBitbucketPullRequests(settings);
    },
    async publishComment(comment) {
      return { ...comment, pending: false };
    },
  },
];

export async function loadAllPullRequests(settings: AccountSettings): Promise<LoadResult> {
  const hasAnyAccount = hasGitHub(settings) || hasBitbucket(settings);
  if (!hasAnyAccount) {
    return { pullRequests: mockPullRequests, errors: [], usingDemo: true };
  }

  const settled = await Promise.allSettled(providers.map((provider) => provider.loadPullRequests(settings)));
  const pullRequests = settled.flatMap((item) => (item.status === "fulfilled" ? item.value : []));
  const errors = settled.flatMap((item, index) =>
    item.status === "rejected" ? [`${providers[index].label}: ${item.reason instanceof Error ? item.reason.message : "failed"}`] : [],
  );
  return { pullRequests, errors, usingDemo: false };
}
