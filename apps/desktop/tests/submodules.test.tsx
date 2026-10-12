import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RefPanel } from "../src/components/ref-sidebar/RefPanel";
import { SubmoduleBatchDialog } from "../src/components/submodules/SubmoduleBatchDialog";
import { SubmoduleDeleteDialog } from "../src/components/submodules/SubmoduleDeleteDialog";
import { SubmoduleDialog } from "../src/components/submodules/SubmoduleDialog";
import { SubmoduleSection, submoduleContextActions } from "../src/components/submodules/SubmoduleSection";
import { commitAge, submoduleState } from "../src/components/submodules/presentation";
import type { SubmoduleInfo } from "../src/lib/types";

const noop = () => undefined;

test("commit age reports elapsed hours rather than calling yesterday's commit today", () => {
  const twelveHoursAgo = Math.floor(Date.now() / 1_000) - 12 * 3_600;
  assert.equal(commitAge(twelveHoursAgo), "12h ago");
  assert.equal(commitAge(null), "date unavailable");
});
const callbacks = {
  onAddSubmodule: noop, onEditSubmodule: noop, onUpdateSubmodule: noop,
  onOpenSubmodule: noop, onDeleteSubmodule: noop, onManageSubmodules: noop,
};
const module = (overrides: Partial<SubmoduleInfo> = {}): SubmoduleInfo => ({
  name: "shared", path: "libraries/shared", url: "https://example.com/team/shared.git",
  absolute_path: "/workspace/libraries/shared", initialized: true,
  head_oid: "abcd1234" + "a".repeat(32), recorded_oid: "abcd1234" + "a".repeat(32),
  head_summary: "Fix shared configuration", head_committed_at: 1_700_000_000,
  branch: "main", dirty: false, conflicted: false, head_matches_recorded: true,
  ...overrides,
});

function button(markup: string, label: string): string {
  const found = [...markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map(([match]) => match)
    .find((match) => match.replace(/<[^>]*>/g, "").trim() === label);
  assert.ok(found, `Expected button '${label}'`);
  return found;
}

function details(submodule: SubmoduleInfo, busy = false) {
  return renderToStaticMarkup(<SubmoduleDialog submodule={submodule} repositoryName="Parent" busy={busy} onClose={noop} onSubmit={noop} onOpen={noop} onUpdate={noop} onDelete={noop} />);
}

test("submodule status never hides conflicts or local changes behind a matching revision", () => {
  assert.equal(submoduleState(module()).label, "In sync");
  assert.equal(submoduleState(module({ dirty: true })).label, "Local changes");
  assert.equal(submoduleState(module({ dirty: true, conflicted: true })).label, "Conflicted");
  assert.equal(submoduleState(module({ head_matches_recorded: false })).label, "Revision changed");
  assert.equal(submoduleState(module({ head_oid: null })).label, "No commit");
  assert.equal(submoduleState(module({ initialized: false, head_oid: null })).label, "Not initialized");
});

test("expanded reference panel exposes submodules, commit identity, date, and add/manage entry points", () => {
  const markup = renderToStaticMarkup(<RefPanel collapsed={false} localBranches={[]} remoteBranches={[]} tags={[]} toggleKeybind="Ctrl+B" onCollapse={noop} onExpand={noop} onCheckout={noop} onCreateBranch={noop} onCheckoutRemote={noop} onBranchContextMenu={noop} submodules={[module()]} {...callbacks} />);
  assert.match(markup, /SUBMODULES/);
  assert.match(markup, /aria-label="Add submodule"/);
  assert.match(markup, /aria-label="Actions for libraries\/shared"/);
  assert.match(markup, /aria-haspopup="menu"/);
  assert.match(markup, /abcd1234/);
  assert.match(markup, /dateTime="2023-11-14T22:13:20\.000Z"/);
  assert.match(markup, /Fix shared configuration/);
  assert.match(markup, /Manage repositories/);
});

test("collapsed reference rail keeps submodules discoverable with their count", () => {
  const markup = renderToStaticMarkup(<RefPanel collapsed localBranches={[]} remoteBranches={[]} tags={[]} toggleKeybind="Ctrl+B" onCollapse={noop} onExpand={noop} onCheckout={noop} onCreateBranch={noop} onCheckoutRemote={noop} onBranchContextMenu={noop} submodules={[module(), module({ path: "plugins/api" })]} {...callbacks} />);
  assert.match(markup, /aria-label="Submodules \(2\)"/);
  assert.doesNotMatch(markup, /libraries\/shared/);
});

test("sidebar distinguishes first-use, loading, filter miss, and load failure", () => {
  const render = (props = {}) => renderToStaticMarkup(<SubmoduleSection filter="" open onToggle={noop} {...callbacks} {...props} />);
  assert.match(render(), /Add your first submodule/);
  assert.match(render({ submodulesLoading: true }), /Loading submodules/);
  assert.doesNotMatch(render({ submodulesLoading: true }), /Add your first submodule/);
  assert.match(render({ submodules: [module()], filter: "missing" }), /No matching submodules/);
  const failure = render({ submodulesError: "Cannot read .gitmodules", onRetrySubmodules: noop });
  assert.match(failure, /Cannot read \.gitmodules/);
  assert.ok(button(failure, "Retry"));
  assert.doesNotMatch(failure, /Add your first submodule/);
  assert.match(render({ submodules: [module()], filter: "example.com/team" }), /libraries\/shared/);
});

test("context actions distinguish initialization and block unavailable or busy operations", () => {
  const ready = submoduleContextActions(module(), callbacks);
  assert.deepEqual(ready.map(({ id }) => id), ["update", "edit", "open", "delete"]);
  assert.equal(ready[0].label, "Update libraries/shared");
  assert.equal(ready[2].label, "Open this submodule");
  assert.equal(ready[3].danger, true);
  assert.ok(ready.every(({ disabled }) => !disabled));
  const uninitialized = submoduleContextActions(module({ initialized: false }), callbacks);
  assert.equal(uninitialized[0].label, "Initialize libraries/shared");
  assert.equal(uninitialized[0].disabled, false);
  assert.equal(uninitialized[2].disabled, true);
  assert.ok(submoduleContextActions(module(), { ...callbacks, submodulesBusy: true }).every(({ disabled }) => disabled));
  assert.ok(submoduleContextActions(module(), {}).every(({ disabled }) => disabled));
});

test("details show checked-out and parent revisions separately with an exact machine-readable commit date", () => {
  const markup = details(module({ recorded_oid: "def56789" + "b".repeat(32), head_matches_recorded: false, branch: null }));
  assert.match(markup, /Revision changed/);
  assert.match(markup, /Detached HEAD/);
  assert.match(markup, /Recorded in parent index/);
  assert.match(markup, /abcd1234/);
  assert.match(markup, /def56789/);
  assert.match(markup, /Fix shared configuration/);
  assert.match(markup, /dateTime="2023-11-14T22:13:20\.000Z"/);
  assert.match(markup, /readOnly=""[^>]*value="libraries\/shared"/);
  assert.doesNotMatch(button(markup, "Open in new tab"), /disabled=/);
  assert.match(button(markup, "Save remote URL"), /disabled=/, "unchanged URL must not submit another mutation");
});

test("uninitialized and conflicted details explain the next step without enabling unsafe actions", () => {
  const empty = details(module({ initialized: false, head_oid: null, head_summary: null, head_committed_at: null, branch: null }));
  assert.match(empty, /Not checked out yet/);
  assert.match(button(empty, "Open in new tab"), /disabled=/);
  assert.doesNotMatch(button(empty, "Initialize submodule"), /disabled=/);
  assert.doesNotMatch(empty, /Invalid Date/);
  assert.match(button(details(module({ conflicted: true })), "Update submodule"), /disabled=/);
  const busy = details(module(), true);
  for (const label of ["Open in new tab", "Update submodule", "Delete submodule"]) assert.match(button(busy, label), /disabled=/);
});

test("deletion confirmation preserves its safeguards for dirty and conflicted repositories", () => {
  const render = (overrides: Partial<SubmoduleInfo>) => renderToStaticMarkup(<SubmoduleDeleteDialog submodule={module(overrides)} busy={false} onClose={noop} onConfirm={noop} />);
  const clean = render({});
  assert.match(clean, /working folder and registration/);
  assert.match(clean, /removal is staged/);
  assert.match(clean, /Cached Git history stays/);
  assert.doesNotMatch(button(clean, "Delete submodule"), /disabled=/);
  assert.match(button(render({ dirty: true }), "Delete submodule"), /disabled=/);
  assert.match(render({ dirty: true }), /Commit or stash/);
  assert.match(button(render({ conflicted: true }), "Delete submodule"), /disabled=/);
  assert.match(render({ conflicted: true }), /Resolve this submodule/);
});

test("partial batch completion requests attention even when nothing failed", () => {
  const markup = renderToStaticMarkup(<SubmoduleBatchDialog submodules={[module()]} repositoryName="Parent" action="push" results={[
    { path: "libraries/shared", name: "libraries/shared", status: "success", message: "Push complete." },
    { path: "plugins/api", name: "plugins/api", status: "skipped", message: "Check out a branch before pushing." },
  ]} running={false} onRun={noop} onClose={noop} />);
  assert.match(markup, /Push finished with items to review/);
  assert.match(markup, /1 succeeded · 1 skipped/);
  assert.match(markup, /Check out a branch before pushing/);
  assert.match(markup, /aria-valuenow="2"/);
  assert.match(markup, /aria-valuemax="2"/);
  assert.doesNotMatch(button(markup, "Close"), /disabled=/);
});

test("active batch prevents another run and exposes progress without claiming completion", () => {
  const markup = renderToStaticMarkup(<SubmoduleBatchDialog submodules={[module()]} repositoryName="Parent" action="pull" results={[
    { path: "libraries/shared", name: "libraries/shared", status: "running" },
  ]} running onRun={noop} onClose={noop} />);
  for (const label of ["Pull all", "Push all", "Close"]) assert.match(button(markup, label), /disabled=/);
  assert.match(markup, /Pull in progress/);
  assert.match(markup, /aria-valuenow="0"/);
  assert.doesNotMatch(markup, /Pull finished/);
});
