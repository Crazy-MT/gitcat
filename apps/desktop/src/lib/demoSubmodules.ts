import type { CommitSummary, SubmoduleInfo } from "./types";

export { comparablePath as demoRepositoryKey } from "./paths";

export function demoSubmodulePath(root: string, path: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${path.replace(/\//g, separator)}`;
}

/** Samples deliberately cover the states visible in the submodule manager. */
export function createDemoSubmodules(commits: CommitSummary[]): SubmoduleInfo[] {
  const rows = [
    { path: "packages/design-system", commit: 0, recorded: 0, branch: "main" },
    { path: "packages/shared", commit: 3, recorded: 5, branch: "main" },
    { path: "tools/automation", commit: 6, recorded: 6, branch: "main", uninitialized: true },
    { path: "vendor/syntax", commit: 7, recorded: 7, branch: null },
  ];
  return rows.map((row) => {
    const commit = commits[row.commit];
    const initialized = !row.uninitialized;
    return {
      name: row.path,
      path: row.path,
      absolute_path: "",
      url: `https://github.com/example/${row.path.split("/").pop()}.git`,
      initialized,
      head_oid: initialized ? commit.oid : null,
      recorded_oid: commits[row.recorded].oid,
      head_summary: initialized ? commit.subject : null,
      head_committed_at: initialized ? commit.committed_at.seconds : null,
      branch: initialized ? row.branch : null,
      dirty: false,
      conflicted: false,
      head_matches_recorded: initialized && row.commit === row.recorded,
    };
  });
}
