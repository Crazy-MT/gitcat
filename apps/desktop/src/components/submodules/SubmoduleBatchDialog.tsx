import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, Check, CheckCircle2, Circle, Clock3, FolderGit2, GitBranch, Layers, LoaderCircle, Minus, SquareArrowOutUpRight } from "lucide-react";
import { useState } from "react";

import { cx } from "../../lib/cx";
import type { SubmoduleInfo } from "../../lib/types";
import { Button } from "../ui/Button";
import { Modal, ModalSpacer } from "../ui/Modal";
import { SubmoduleError } from "./SubmoduleDialog";
import { commitAge, commitDate, shortOid, STATUS_COLOR, SUBMODULE_FOCUS, submoduleState } from "./presentation";
import { useDialogFocus } from "./useDialogFocus";

export type SubmoduleBatchAction = "pull" | "push";
export interface SubmoduleBatchItem {
  path: string;
  name: string;
  status: "pending" | "running" | "success" | "skipped" | "failed";
  message?: string;
}

export interface SubmoduleBatchDialogProps {
  submodules: SubmoduleInfo[];
  repositoryName: string;
  action: SubmoduleBatchAction | null;
  results: SubmoduleBatchItem[];
  running: boolean;
  busy?: boolean;
  error?: string | null;
  onRun: (action: SubmoduleBatchAction, includeParent: boolean) => void;
  onClose: () => void;
  onOpen?: (submodule: SubmoduleInfo) => void;
}

const RESULT_ICON = { pending: Clock3, running: LoaderCircle, success: Check, skipped: Minus, failed: AlertCircle };
const RESULT_COLOR = { pending: "text-muted", running: "text-accent", success: "text-success", skipped: "text-muted", failed: "text-danger" };
const RESULT_LABEL = { pending: "Waiting", running: "Running", success: "Done", skipped: "Skipped", failed: "Failed" };

export function SubmoduleBatchDialog({ submodules, repositoryName, action, results, running, busy, error, onRun, onClose, onOpen }: SubmoduleBatchDialogProps) {
  const [includeParent, setIncludeParent] = useState(false);
  const contentRef = useDialogFocus();
  const finished = results.filter((result) => result.status === "success" || result.status === "failed" || result.status === "skipped").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const needsAttention = failed > 0 || skipped > 0;
  const operation = action === "push" ? "Push" : "Pull";
  const hasResults = results.length > 0;
  const count = submodules.length + Number(includeParent);

  return (
    <Modal
      description={`Pull or push ${repositoryName}'s submodules together.`}
      footer={<><span className="text-[11px] text-muted">{running ? "Finishing current run…" : `${count} ${count === 1 ? "repository" : "repositories"} selected`}</span><ModalSpacer /><Button className={SUBMODULE_FOCUS} disabled={running} onClick={onClose}>Close</Button></>}
      onClose={() => { if (!running) onClose(); }}
      title="Manage repositories"
      width="large"
    >
      <div className="flex flex-col gap-4" ref={contentRef}>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/35 p-3">
          <div className="mr-auto min-w-0"><p className="flex items-center gap-2 text-[13px] font-semibold"><Layers className="text-accent" size={15} /> All submodules</p><p className="mt-1 text-[11px] text-muted">One run, individual results for every repository.</p></div>
          <Button className={SUBMODULE_FOCUS} data-initial-focus disabled={busy || running || !count} icon={<ArrowDownToLine size={14} />} onClick={() => onRun("pull", includeParent)}>Pull all</Button>
          <Button className={SUBMODULE_FOCUS} disabled={busy || running || !count} icon={<ArrowUpFromLine size={14} />} onClick={() => onRun("push", includeParent)} tone="accent">Push all</Button>
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 rounded px-0.5">
          <input checked={includeParent} className={cx("mt-0.5 size-3.5 accent-accent", SUBMODULE_FOCUS)} disabled={running} onChange={(event) => setIncludeParent(event.target.checked)} type="checkbox" />
          <span><span className="text-[12px]">Include parent repository <strong className="font-semibold">{repositoryName}</strong></span><span className="mt-0.5 block text-[11px] text-muted">Pull the parent first; push it after the submodules succeed.</span></span>
        </label>
        <p className="-mt-1 text-[11px] leading-4 text-muted">Pull uses fast-forward updates. Push never forces changes. Repositories that cannot proceed report a reason; the others continue. Changed submodule revisions still need a commit in the parent.</p>
        {error ? <SubmoduleError message={error} /> : null}

        {hasResults ? <section aria-label="Operation progress" aria-live="polite" className="rounded-md border border-border bg-background/30 p-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold">{running ? <LoaderCircle className="animate-orbit text-accent motion-reduce:animate-none" size={15} /> : needsAttention ? <AlertCircle className="text-warning" size={15} /> : <CheckCircle2 className="text-success" size={15} />}<span>{running ? `${operation} in progress` : needsAttention ? `${operation} finished with items to review` : `${operation} finished`}</span><span className="ml-auto text-[11px] font-normal tabular-nums text-muted">{finished} / {results.length}</span></div>
          <div aria-label={`${operation} progress`} aria-valuemax={results.length} aria-valuemin={0} aria-valuenow={finished} className="mt-2.5 h-1 overflow-hidden rounded-full bg-border/70" role="progressbar"><div className={cx("h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none", needsAttention ? "bg-warning" : "bg-accent")} style={{ width: `${finished / results.length * 100}%` }} /></div>
          {!running ? <p className="mt-2 text-[11px] text-muted">{results.filter((result) => result.status === "success").length} succeeded{skipped ? ` · ${skipped} skipped` : ""}{failed ? ` · ${failed} failed — review the details below` : ""}</p> : null}
        </section> : null}

        <div aria-label={hasResults ? "Repository results" : "Repositories"} className="overflow-hidden rounded-md border border-border">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-background/35 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted"><span>Repository</span><span>{hasResults ? "Result" : "Current revision"}</span></div>
          {hasResults ? results.map((result) => <BatchResultRow key={result.path} result={result} submodule={submodules.find((item) => item.path === result.path)} onOpen={onOpen} />) : <>
            {includeParent ? <div className="flex items-center gap-2.5 border-b border-border/60 px-3 py-3"><FolderGit2 className="text-accent" size={16} /><span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{repositoryName}</span><span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">Parent</span></div> : null}
            {submodules.map((submodule) => <RepositoryPreview key={submodule.path} onOpen={onOpen} submodule={submodule} />)}
            {!submodules.length ? <p className="p-4 text-[12px] text-muted">No submodules in this repository.</p> : null}
          </>}
        </div>
      </div>
    </Modal>
  );
}

function RepositoryPreview({ submodule, onOpen }: { submodule: SubmoduleInfo; onOpen?: (submodule: SubmoduleInfo) => void }) {
  const state = submoduleState(submodule);
  return <div className="flex items-start gap-2.5 border-b border-border/60 px-3 py-3 last:border-0">
    <Layers className="mt-0.5 shrink-0 text-muted" size={15} />
    <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-semibold" title={submodule.path}>{submodule.path}</p><p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted"><span className={cx("flex items-center gap-1", STATUS_COLOR[state.tone])}><Circle className="fill-current" size={5} />{state.label}</span>{submodule.branch ? <><span aria-hidden="true">·</span><GitBranch size={10} /><span>{submodule.branch}</span></> : submodule.initialized ? <span>· Detached HEAD</span> : null}</p>{submodule.head_summary ? <p className="mt-1 truncate text-[11px] text-muted" title={submodule.head_summary}>{submodule.head_summary}</p> : null}</div>
    <div className="shrink-0 text-right"><code className="text-[11px] text-foreground/85" title={submodule.head_oid ?? undefined}>{shortOid(submodule.head_oid)}</code>{submodule.head_committed_at !== null ? <time className="mt-1 block text-[10px] text-muted" dateTime={new Date(submodule.head_committed_at * 1_000).toISOString()} title={commitDate(submodule.head_committed_at)}>{commitAge(submodule.head_committed_at)}</time> : null}</div>
    {onOpen && submodule.initialized ? <button aria-label={`Open ${submodule.path} in a new tab`} className={cx("mt-0.25 cursor-pointer rounded p-0.5 text-muted hover:text-accent", SUBMODULE_FOCUS)} onClick={() => onOpen(submodule)} title="Open in new tab" type="button"><SquareArrowOutUpRight size={13} /></button> : null}
  </div>;
}

function BatchResultRow({ result, submodule, onOpen }: { result: SubmoduleBatchItem; submodule?: SubmoduleInfo; onOpen?: (submodule: SubmoduleInfo) => void }) {
  const Icon = RESULT_ICON[result.status];
  return <div className="flex items-start gap-2.5 border-b border-border/60 px-3 py-3 last:border-0">
    <Icon className={cx("mt-0.5 shrink-0", RESULT_COLOR[result.status], result.status === "running" && "animate-orbit motion-reduce:animate-none")} size={15} />
    <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-semibold" title={result.path}>{result.name}</p>{result.message ? <p className={cx("mt-1 whitespace-pre-wrap break-words text-[11px] leading-4", result.status === "failed" ? "text-danger" : "text-muted")}>{result.message}</p> : null}</div>
    <span className={cx("mt-0.25 text-[10px]", RESULT_COLOR[result.status])}>{RESULT_LABEL[result.status]}</span>
    {onOpen && submodule?.initialized ? <button aria-label={`Open ${submodule.path} in a new tab`} className={cx("mt-0.25 cursor-pointer rounded p-0.5 text-muted hover:text-accent", SUBMODULE_FOCUS)} onClick={() => onOpen(submodule)} title="Open in new tab" type="button"><SquareArrowOutUpRight size={13} /></button> : null}
  </div>;
}
