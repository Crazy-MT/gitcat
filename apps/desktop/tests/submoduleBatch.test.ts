import assert from "node:assert/strict";
import test from "node:test";

import { runSubmoduleBatch, type SubmoduleBatchItem } from "../src/app/submoduleBatch";
import type { MutationResult, PullOptions, PushOptions, RepositorySnapshot, SubmoduleInfo } from "../src/lib/types";

const module = (path: string, overrides: Partial<SubmoduleInfo> = {}): SubmoduleInfo => ({
  name: path, path, url: "https://example.com/module.git", absolute_path: `/parent/${path}`,
  initialized: true, head_oid: "a".repeat(40), recorded_oid: "a".repeat(40),
  head_summary: "A commit", head_committed_at: 1_700_000_000, branch: "main",
  dirty: false, conflicted: false, head_matches_recorded: true, ...overrides,
});
const success: MutationResult = { before_oid: null, after_oid: null, generation: "1", conflicts: [], needs_user_action: false };

function fixture(modules = [module("one"), module("two")]) {
  const calls: string[] = [];
  const progress: SubmoduleBatchItem[][] = [];
  const api = {
    listSubmodules: async () => modules,
    snapshot: async () => ({ head: { kind: "branch" }, operation_state: "normal", status: { clean: true } } as RepositorySnapshot),
    syncSubmodule: async (_id: string, path: string) => { calls.push(path); return success; },
    pull: async (_id: string, options: PullOptions) => { assert.equal(options.skip_submodules, true); calls.push("parent"); return success; },
    push: async (_id: string, options: PushOptions) => { assert.equal(options.skip_submodules, true); calls.push("parent"); return success; },
  };
  return { api, calls, progress, run: (action: "pull" | "push", includeParent = false) => runSubmoduleBatch({
    api, repositoryId: "parent", repositoryName: "Parent", action, includeParent,
    onProgress: (items) => progress.push(items),
  }) };
}

test("batch pull refreshes submodule membership after parent pull", async () => {
  const f = fixture();
  f.api.pull = async () => { f.calls.push("parent"); f.api.listSubmodules = async () => [module("new")]; return success; };
  const result = await f.run("pull", true);
  assert.deepEqual(f.calls, ["parent", "new"]);
  assert.deepEqual(result.map(({ path }) => path), [".", "new"]);
  assert.ok(f.progress.some((rows) => rows.some((row) => row.status === "running")));
});

test("batch continues after a failed child and retains per-repository failure", async () => {
  const f = fixture();
  f.api.syncSubmodule = async (_id, path) => {
    f.calls.push(path);
    if (path === "one") throw { code: "network_failed", message: "Remote unavailable" };
    return success;
  };
  const result = await f.run("pull");
  assert.deepEqual(f.calls, ["one", "two"]);
  assert.equal(result[0].status, "failed");
  assert.equal(result[0].message, "Remote unavailable");
  assert.equal(result[1].status, "success");
  assert.equal(f.progress[0][0].status, "pending", "past progress snapshots must remain immutable");
});

test("batch push skips detached and uninitialized children, and blocks parent publication", async () => {
  const f = fixture([module("detached", { branch: null }), module("empty", { initialized: false }), module("ready")]);
  const result = await f.run("push", true);
  assert.deepEqual(f.calls, ["ready"]);
  assert.deepEqual(result.map(({ status }) => status), ["skipped", "skipped", "success", "skipped"]);
  assert.match(result[0].message!, /detached HEAD/);
});

test("successful push visits children before parent", async () => {
  const f = fixture();
  await f.run("push", true);
  assert.deepEqual(f.calls, ["one", "two", "parent"]);
});

test("parent pull failure prevents stale child operations", async () => {
  const f = fixture();
  f.api.pull = async () => { throw new Error("Parent pull failed"); };
  const result = await f.run("pull", true);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(result.map(({ status }) => status), ["failed", "skipped", "skipped"]);
});

test("failed listing after parent pull leaves no pending results", async () => {
  const f = fixture();
  f.api.pull = async () => { f.api.listSubmodules = async () => { throw new Error("Malformed .gitmodules"); }; return success; };
  await assert.rejects(f.run("pull", true), /Malformed/);
  assert.ok(f.progress.at(-1)!.every((row) => row.status !== "pending" && row.status !== "running"));
  assert.deepEqual(f.calls, []);
});

test("dirty children and conflicts require explicit resolution", async () => {
  const f = fixture([module("dirty", { dirty: true }), module("conflict", { conflicted: true })]);
  assert.ok((await f.run("pull")).every((row) => row.status === "skipped"));
  assert.deepEqual(f.calls, []);
});

test("an operation returning conflicts is failed, not reported as successful", async () => {
  const f = fixture();
  f.api.syncSubmodule = async () => ({ ...success, needs_user_action: true });
  const result = await f.run("push", true);
  assert.deepEqual(result.map(({ status }) => status), ["failed", "failed", "skipped"]);
});
