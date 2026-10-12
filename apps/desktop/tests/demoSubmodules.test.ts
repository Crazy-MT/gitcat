import assert from "node:assert/strict";
import test from "node:test";

import { createDemoGitCatApi, DEMO_REPOSITORY_ID } from "../src/lib/demo";
import type { ApiError } from "../src/lib/types";

const commitOptions = (message: string) => ({ message, amend: false, signoff: false });
const codeIs = (code: ApiError["code"]) => (error: unknown) => (error as ApiError).code === code;

async function fixture() {
  const api = createDemoGitCatApi();
  const parent = await api.openRepository("C:\\Demo\\parent");
  const modules = await api.listSubmodules(parent.repository_id);
  return { api, parent, modules };
}

test("demo child tabs have independent repository handles and survive closing another tab", async () => {
  const { api, parent, modules } = await fixture();
  assert.equal(parent.repository_id, DEMO_REPOSITORY_ID);
  const module = modules.find((item) => item.initialized && item.branch)!;
  const child = await api.openRepository(module.absolute_path);
  assert.notEqual(child.repository_id, parent.repository_id);
  assert.equal(child.info.root, module.absolute_path);
  assert.notEqual(child.info.name, parent.info.name);
  assert.deepEqual(await api.listSubmodules(child.repository_id), []);
  assert.equal((await api.snapshot(child.repository_id)).status.clean, true);

  await api.closeRepository(child.repository_id);
  await assert.rejects(api.snapshot(child.repository_id), codeIs("repository_closed"));
  assert.ok(await api.snapshot(parent.repository_id));
  const reopened = await api.openRepository(module.absolute_path.replace(/\\/g, "/").toLowerCase());
  assert.equal(reopened.repository_id, child.repository_id);
  await api.closeRepository(parent.repository_id);
  assert.ok(await api.snapshot(child.repository_id));
});

test("demo restores concurrent repository tabs without mixing their state", async () => {
  const api = createDemoGitCatApi();
  const [first, second] = await Promise.all([
    api.openRepository("/demo/first"), api.openRepository("/demo/second"),
  ]);
  assert.notEqual(first.repository_id, second.repository_id);
  const untouched = await api.snapshot(second.repository_id);
  await api.createCommit(first.repository_id, commitOptions("Only the first repository changes"));
  assert.deepEqual(await api.snapshot(second.repository_id), untouched);
  assert.notDeepEqual((await api.snapshot(first.repository_id)).head, untouched.head);
});

test("demo submodule CRUD updates staged registration and requires removal confirmation", async () => {
  const { api, parent } = await fixture();
  const id = parent.repository_id;
  const path = "packages/new-module";
  await assert.rejects(api.addSubmodule(id, "https://example.com/module.git", "../outside"), codeIs("invalid_path"));
  await api.addSubmodule(id, "https://example.com/module.git", path);
  await assert.rejects(api.addSubmodule(id, "https://example.com/duplicate.git", path), codeIs("invalid_path"));
  let status = (await api.snapshot(id)).status.entries;
  assert.equal(status.find((entry) => entry.path === path)?.index, "added");
  assert.equal(status.find((entry) => entry.path === ".gitmodules")?.index, "modified");
  await api.setSubmoduleUrl(id, path, "git@example.com:team/renamed.git");
  assert.equal((await api.listSubmodules(id)).find((module) => module.path === path)?.url, "git@example.com:team/renamed.git");
  await assert.rejects(api.removeSubmodule(id, path, false), codeIs("invalid_request"));
  assert.ok((await api.listSubmodules(id)).some((module) => module.path === path));
  await api.removeSubmodule(id, path, true);
  assert.ok(!(await api.listSubmodules(id)).some((module) => module.path === path));
  status = (await api.snapshot(id)).status.entries;
  assert.equal(status.find((entry) => entry.path === path)?.index, "deleted");
});

test("demo initialization checks out the recorded commit before a separate remote update", async () => {
  const { api, parent, modules } = await fixture();
  const module = modules.find((item) => !item.initialized)!;
  await assert.rejects(api.openRepository(module.absolute_path), codeIs("invalid_request"));
  const initialized = await api.updateSubmodule(parent.repository_id, module.path);
  assert.equal(initialized.notice, "Initialized at the commit recorded by the parent repository.");
  const recorded = (await api.listSubmodules(parent.repository_id)).find((item) => item.path === module.path)!;
  assert.equal(recorded.initialized, true);
  assert.equal(recorded.head_oid, module.recorded_oid);
  assert.equal(recorded.head_matches_recorded, true);
  assert.equal(recorded.branch, null);
  await api.updateSubmodule(parent.repository_id, module.path);
  const latest = (await api.listSubmodules(parent.repository_id)).find((item) => item.path === module.path)!;
  assert.notEqual(latest.head_oid, recorded.head_oid);
  assert.equal(latest.recorded_oid, recorded.recorded_oid);
  assert.equal(latest.head_matches_recorded, false);
});

test("demo parent observes child commits and preserves staged submodule pointers", async () => {
  const { api, parent, modules } = await fixture();
  const module = modules.find((item) => item.initialized && item.head_matches_recorded && item.branch)!;
  const child = await api.openRepository(module.absolute_path);
  const parentHead = (await api.snapshot(parent.repository_id)).head;
  await api.createCommit(child.repository_id, commitOptions("A commit made in the child tab"));
  const changed = (await api.listSubmodules(parent.repository_id)).find((item) => item.path === module.path)!;
  assert.equal(changed.head_summary, "A commit made in the child tab");
  assert.notEqual(changed.head_oid, module.head_oid);
  assert.equal(changed.head_matches_recorded, false);
  assert.deepEqual((await api.snapshot(parent.repository_id)).head, parentHead);
  await assert.rejects(api.updateSubmodule(parent.repository_id, module.path), codeIs("invalid_request"));
  assert.equal((await api.listSubmodules(parent.repository_id)).find((item) => item.path === module.path)?.head_oid, changed.head_oid);

  await api.stagePaths(parent.repository_id, [module.path]);
  let staged = (await api.listSubmodules(parent.repository_id)).find((item) => item.path === module.path)!;
  assert.equal(staged.recorded_oid, changed.head_oid);
  assert.equal(staged.head_matches_recorded, true);
  assert.equal((await api.snapshot(parent.repository_id)).status.entries.find((entry) => entry.path === module.path)?.worktree, undefined);
  await api.unstagePaths(parent.repository_id, [module.path]);
  assert.equal((await api.listSubmodules(parent.repository_id)).find((item) => item.path === module.path)?.recorded_oid, module.recorded_oid);
  await api.stagePaths(parent.repository_id, [module.path]);
  await api.createCommit(parent.repository_id, commitOptions("Record the child revision"));
  staged = (await api.listSubmodules(parent.repository_id)).find((item) => item.path === module.path)!;
  assert.equal(staged.recorded_oid, changed.head_oid);
  assert.ok(!(await api.snapshot(parent.repository_id)).status.entries.some((entry) => entry.path === module.path));
});

test("demo sync supplies successful and actionable failed results for batch previews", async () => {
  const { api, parent, modules } = await fixture();
  const results = await Promise.allSettled(modules.map((module) => api.syncSubmodule(parent.repository_id, module.path, "push")));
  assert.ok(results.some((result) => result.status === "fulfilled"));
  const errors = results.filter((result) => result.status === "rejected").map((result) => (result.reason as ApiError).message);
  assert.ok(errors.some((message) => /detached HEAD/.test(message)));
  assert.ok(errors.some((message) => /Initialize/.test(message)));
});
