import { AlertTriangle, Layers, ShieldCheck, Trash2 } from "lucide-react";

import type { SubmoduleInfo } from "../../lib/types";
import { Button } from "../ui/Button";
import { Modal, ModalSpacer } from "../ui/Modal";
import { SubmoduleError } from "./SubmoduleDialog";
import { SUBMODULE_FOCUS } from "./presentation";
import { useDialogFocus } from "./useDialogFocus";

export function SubmoduleDeleteDialog({ submodule, busy, error, onConfirm, onClose }: {
  submodule: SubmoduleInfo;
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const contentRef = useDialogFocus();
  const blocked = submodule.dirty || submodule.conflicted;
  const close = () => { if (!busy) onClose(); };
  return (
    <Modal
      description="Review what will be removed before continuing."
      footer={<><ModalSpacer /><Button className={SUBMODULE_FOCUS} data-initial-focus disabled={busy} onClick={close}>Cancel</Button><Button className={SUBMODULE_FOCUS} disabled={busy || blocked} icon={<Trash2 size={14} />} onClick={onConfirm} tone="danger">{busy ? "Deleting…" : "Delete submodule"}</Button></>}
      onClose={close}
      title="Delete submodule?"
    >
      <div className="flex flex-col gap-4" ref={contentRef}>
        <div className="flex items-start gap-2.5 rounded-md border border-border bg-background/45 p-3"><Layers className="mt-0.5 shrink-0 text-muted" size={16} /><div className="min-w-0"><p className="break-words font-semibold">{submodule.path}</p><p className="mt-1 break-all text-[11px] text-muted">{submodule.url}</p></div></div>
        <p className="text-[12px] leading-5">This removes the submodule's working folder and registration from this repository. The removal is staged for your next commit.</p>
        <div className="flex items-start gap-2 text-[11px] leading-5 text-muted"><ShieldCheck className="mt-0.5 shrink-0 text-success" size={15} /><p>The remote repository is unchanged. Cached Git history stays in <code>.git/modules</code>. GitCat refuses removal when local files or existing <code>.gitmodules</code> changes need to be preserved.</p></div>
        {blocked ? <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/7 p-3 text-[12px] leading-5 text-warning"><AlertTriangle className="mt-0.5 shrink-0" size={15} /><p>{submodule.conflicted ? "Resolve this submodule's conflict before deleting it." : "Commit or stash this submodule's local changes before deleting it."}</p></div> : null}
        {error ? <SubmoduleError message={error} /> : null}
      </div>
    </Modal>
  );
}
