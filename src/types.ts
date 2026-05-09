export type ProviderKind = "github" | "bitbucket";

export type ReviewState = "changes-requested" | "approved" | "commented" | "waiting";

export type PullRequestViewerRole = "author" | "reviewer" | "assignee" | "mentioned" | "participant";
export type PullRequestInboxReason = "author" | "reviewer" | "mentioned" | "watched";

export type PullRequestSummary = {
  id: string;
  provider: ProviderKind;
  repo: string;
  number: number;
  title: string;
  description?: string;
  url?: string;
  author: string;
  branch: string;
  branchUrl?: string;
  target: string;
  targetUrl?: string;
  updatedAt: string;
  updatedAtIso: string;
  additions: number;
  deletions: number;
  comments: number;
  state: ReviewState;
  viewerRoles?: PullRequestViewerRole[];
  inboxReasons?: PullRequestInboxReason[];
  files: ReviewFile[];
  filesLoaded?: boolean;
  commentsLoaded?: boolean;
  diffUrl?: string;
  connectionId?: string;
  isDemo?: boolean;
};

export type ReviewFile = {
  path: string;
  previousPath?: string;
  language: string;
  status: "modified" | "added" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  diff: string;
  diffUrl?: string;
};

export type ReviewComment = {
  id: string;
  provider: ProviderKind;
  prId: string;
  filePath: string;
  lineKey: string;
  author: string;
  body: string;
  createdAt: string;
  pending?: boolean;
};

export type AccountSettings = {
  githubClientId: string;
  githubToken: string;
  githubConnections: Array<{
    login: string;
    token: string;
  }>;
  bitbucketClientId: string;
  bitbucketAccessToken: string;
  bitbucketWorkspaces: string;
  bitbucketConnections: Array<{
    workspace: string;
    token: string;
    refreshToken?: string;
    repositories?: string[];
  }>;
};

export type DiffLineKind = "context" | "addition" | "deletion" | "meta";

export type DiffLine = {
  key: string;
  kind: DiffLineKind;
  oldLine?: number;
  newLine?: number;
  content: string;
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
};
