import type { DiffHunk, DiffLine, DiffLineKind } from "./types";

const hunkPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of diff.split("\n")) {
    const hunkMatch = rawLine.match(hunkPattern);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      current = {
        header: rawLine,
        oldStart: oldLine,
        newStart: newLine,
        lines: [],
      };
      hunks.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    const marker = rawLine[0];
    const content = rawLine.slice(1);
    let kind: DiffLineKind = "context";
    const line: DiffLine = {
      key: `${hunks.length}-${current.lines.length}`,
      kind,
      content,
    };

    if (marker === "+") {
      kind = "addition";
      line.kind = kind;
      line.newLine = newLine++;
    } else if (marker === "-") {
      kind = "deletion";
      line.kind = kind;
      line.oldLine = oldLine++;
    } else if (marker === "\\") {
      line.kind = "meta";
      line.content = rawLine;
    } else {
      line.oldLine = oldLine++;
      line.newLine = newLine++;
    }

    line.key = `${line.oldLine ?? "x"}:${line.newLine ?? "x"}:${current.lines.length}`;
    current.lines.push(line);
  }

  return hunks;
}

export function getCommentLineKey(filePath: string, line: DiffLine) {
  const side = line.kind === "deletion" ? "old" : "new";
  const number = line.kind === "deletion" ? line.oldLine : line.newLine;
  return `${filePath}:${side}:${number ?? line.key}`;
}

export function languageFromPath(path: string) {
  if (path.endsWith(".tsx") || path.endsWith(".jsx")) return "tsx";
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json")) return "json";
  return "plaintext";
}
