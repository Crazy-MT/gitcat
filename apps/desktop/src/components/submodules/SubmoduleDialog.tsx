import { AlertCircle, ArrowDownToLine, CheckCircle2, Clock3, GitBranch, GitCommitHorizontal, Layers, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { cx } from "../../lib/cx";
import { repositoryNameFromUrl } from "../../lib/paths";
import { FIELD_INPUT } from "../../lib/styles";
import type { SubmoduleInfo } from "../../lib/types";
import { Button } from "../ui/Button";
import { Modal, ModalSpacer } from "../ui/Modal";
import { Input } from "../ui/TextField";
import { commitDate, shortOid, STATUS_COLOR, SUBMODULE_FOCUS, submoduleState } from "./presentation";
import { useDialogFocus } from "./useDialogFocus";

export interface SubmoduleFormValues { url: string; path: string }

export interface SubmoduleDialogProps {
  submodule?: SubmoduleInfo | null;
  repositoryName: string;
  busy: boolean;
  error?: string | null;
  onSubmit: (values: SubmoduleFormValues) => void;
  onClose: () => void;
  onOpen?: (submodule: SubmoduleInfo) => void;
  onUpdate?: (submodule: SubmoduleInfo) => void;
  onDelete?: (submodule: SubmoduleInfo) => void;
}

function pathError(path: string): string | null {
  if (!path) return null;
  if (/^[\\/]|^[a-z]:/i.test(path)) return "Use a path inside this repository, such as libraries/shared.";
  if (path.startsWith("-") || /[\x00-\x1f]/.test(path)) return "Choose a relative folder name without control characters or a leading dash.";
  if (path.split(/[\\/]/).some((part) => part === ".." || part === "." || part.toLowerCase() === ".git")) return "The path cannot contain '.', '..', or a .git folder.";
  return null;
}

export function SubmoduleDialog({ submodule, repositoryName, busy, error, onSubmit, onClose, onOpen, onUpdate, onDelete }: SubmoduleDialogProps) {
  const id = useId();
  const contentRef = useDialogFocus();
  const [url, setUrl] = useState(submodule?.url ?? "");
  const [path, setPath] = useState(submodule?.path ?? "");
  const [pathEdited, setPathEdited] = useState(Boolean(submodule));
  const normalizedPath = path.trim().replace(/\\/g, "/");
  const validation = pathError(normalizedPath);
  const canSubmit = !busy && Boolean(url.trim() && normalizedPath) && !validation && (!submodule || url.trim() !== submodule.url);
  const submit = () => { if (canSubmit) onSubmit({ url: url.trim(), path: normalizedPath }); };
  const close = () => { if (!busy) onClose(); };

  return (
    <Modal
      description={submodule ? `${repositoryName} / ${submodule.path}` : `Add a repository inside ${repositoryName}.`}
      footer={<><ModalSpacer /><Button className={SUBMODULE_FOCUS} disabled={busy} onClick={close}>{submodule ? "Done" : "Cancel"}</Button><Button className={SUBMODULE_FOCUS} disabled={!canSubmit} onClick={submit} tone="accent">{busy ? "Working…" : submodule ? "Save remote URL" : "Add submodule"}</Button></>}
      onClose={close}
      title={submodule ? "Edit submodule" : "Add submodule"}
      width="medium"
    >
      <div className="flex flex-col gap-4" ref={contentRef}>
        <form className="flex flex-col gap-3.5" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-muted" htmlFor={`${id}-url`}>Remote URL</label>
            <Input
              className={FIELD_INPUT}
              data-initial-focus
              disabled={busy}
              id={`${id}-url`}
              onChange={(event) => { setUrl(event.target.value); if (!pathEdited) setPath(repositoryNameFromUrl(event.target.value)); }}
              placeholder="https://github.com/team/shared.git"
              spellCheck={false}
              value={url}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-muted" htmlFor={`${id}-path`}>Name / path</label>
            <Input
              aria-describedby={`${id}-path-hint`}
              aria-invalid={Boolean(validation)}
              className={cx(FIELD_INPUT, "font-mono text-[12px]", submodule && "text-muted")}
              disabled={busy}
              id={`${id}-path`}
              onChange={(event) => { setPathEdited(true); setPath(event.target.value); }}
              placeholder="libraries/shared"
              readOnly={Boolean(submodule)}
              spellCheck={false}
              value={path}
            />
            <p className={cx("mt-1.5 text-[11px] leading-4", validation ? "text-danger" : "text-muted")} id={`${id}-path-hint`}>{validation ?? (submodule ? "The location stays fixed when editing the remote URL." : "Folder relative to this repository. Nested paths are welcome.")}</p>
          </div>
          <button className="hidden" disabled={!canSubmit} tabIndex={-1} type="submit" />
        </form>

        {error ? <SubmoduleError message={error} /> : null}

        {submodule ? <>
          <SubmoduleRevision submodule={submodule} />
          <div className="grid grid-cols-2 gap-2">
            {onOpen ? <Button className={cx("text-[12px]", SUBMODULE_FOCUS)} disabled={!submodule.initialized || busy} icon={<SquareArrowOutUpRight size={14} />} onClick={() => onOpen(submodule)}>Open in new tab</Button> : null}
            {onUpdate ? <Button className={cx("text-[12px]", SUBMODULE_FOCUS)} disabled={busy || submodule.conflicted} icon={<ArrowDownToLine size={14} />} onClick={() => onUpdate(submodule)}>{submodule.initialized ? "Update submodule" : "Initialize submodule"}</Button> : null}
          </div>
          <p className="-mt-2 text-[11px] leading-4 text-muted">{submodule.initialized ? "Update fast-forwards the tracked branch when possible. Review and commit changed submodule revisions in the parent repository." : "Initialization checks out the commit recorded by the parent repository."}</p>
          {onDelete ? <div className="flex items-center justify-between gap-3 border-t border-border pt-3"><span className="text-[11px] text-muted">Remove from {repositoryName}</span><Button className={SUBMODULE_FOCUS} compact disabled={busy} icon={<Trash2 size={13} />} onClick={() => onDelete(submodule)} tone="danger">Delete submodule</Button></div> : null}
        </> : <div className="flex items-start gap-2.5 rounded-md border border-border bg-background/45 p-3 text-[11px] leading-5 text-muted"><Layers className="mt-0.5 shrink-0 text-accent" size={16} /><p>Clone the repository into this folder and register it in <code className="text-foreground">.gitmodules</code>. Review and commit the new submodule in the parent repository.</p></div>}
      </div>
    </Modal>
  );
}

export function SubmoduleError({ message }: { message: string }) {
  return <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/7 px-3 py-2.5 text-[12px] leading-5 text-danger" role="alert"><AlertCircle className="mt-0.5 shrink-0" size={15} /><p className="min-w-0 whitespace-pre-wrap break-words">{message}</p></div>;
}

function SubmoduleRevision({ submodule }: { submodule: SubmoduleInfo }) {
  const state = submoduleState(submodule);
  return (
    <section aria-label="Submodule revision" className="overflow-hidden rounded-md border border-border bg-background/40">
      <div className="flex items-center gap-2 border-b border-border/75 px-3 py-2.5">
        {state.tone === "success" ? <CheckCircle2 className="text-success" size={15} /> : <AlertCircle className={STATUS_COLOR[state.tone]} size={15} />}
        <span className={cx("text-[12px] font-semibold", STATUS_COLOR[state.tone])}>{state.label}</span>
        {submodule.initialized ? <span className="ml-auto flex min-w-0 items-center gap-1.25 text-[11px] text-muted"><GitBranch className="shrink-0" size={12} /><span className="truncate">{submodule.branch ?? "Detached HEAD"}</span></span> : null}
      </div>
      <div className="p-3">
        <p className="mb-3 text-[11px] leading-4 text-muted">{state.description}</p>
        <div className="grid grid-cols-[14px_1fr] gap-x-2.5 gap-y-1">
          <GitCommitHorizontal aria-hidden="true" className="mt-0.75 text-accent" size={14} />
          <div className="min-w-0"><div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1"><span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted">Checked out</span><code className="text-[12px] text-accent" title={submodule.head_oid ?? undefined}>{shortOid(submodule.head_oid)}</code></div><p className="mt-1 break-words text-[13px] font-medium leading-5">{submodule.head_summary ?? (submodule.initialized ? "Commit information unavailable" : "Not checked out yet")}</p>{submodule.head_committed_at !== null ? <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted"><Clock3 aria-hidden="true" size={11} /><time dateTime={new Date(submodule.head_committed_at * 1_000).toISOString()}>{commitDate(submodule.head_committed_at)}</time></p> : null}</div>
          <span aria-hidden="true" className="mx-auto my-0.5 min-h-3 border-l border-dashed border-border-strong" /><div />
          <GitCommitHorizontal aria-hidden="true" className="mt-0.25 text-muted" size={14} /><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-[11px] text-muted">Recorded in parent index</span><code className={cx("text-[12px]", submodule.head_matches_recorded ? "text-muted" : "text-warning")} title={submodule.recorded_oid ?? undefined}>{shortOid(submodule.recorded_oid)}</code></div>
        </div>
      </div>
    </section>
  );
}
