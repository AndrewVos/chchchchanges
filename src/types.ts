export type ProviderKind = "github" | "bitbucket";

export type ReviewState = "changes-requested" | "approved" | "commented" | "waiting";

export type PullRequestSummary = {
  id: string;
  provider: ProviderKind;
  repo: string;
  number: number;
  title: string;
  author: string;
  branch: string;
  target: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  comments: number;
  state: ReviewState;
  files: ReviewFile[];
  isDemo?: boolean;
};

export type ReviewFile = {
  path: string;
  language: string;
  status: "modified" | "added" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  diff: string;
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
