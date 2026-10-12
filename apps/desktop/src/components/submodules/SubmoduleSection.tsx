import { AlertCircle, ArrowDownToLine, Check, Circle, GitCommitHorizontal, Layers, MoreHorizontal, Plus, Settings2, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { cx } from "../../lib/cx";
import type { SubmoduleInfo } from "../../lib/types";
import { ContextMenu } from "../ContextMenu";
import type { ContextAction } from "../ContextMenu";
import { RefSection, SidebarEmpty } from "../ref-sidebar/RefSection";
import { IconButton } from "../ui/IconButton";
import { commitAge, commitDate, shortOid, STATUS_COLOR, SUBMODULE_FOCUS, submoduleState } from "./presentation";

export interface SubmoduleSidebarProps {
  submodulesRepositoryId?: string;
  submodules?: SubmoduleInfo[];
  submodulesLoading?: boolean;
  submodulesError?: string | null;
  submodulesBusy?: boolean;
  onAddSubmodule?: () => void;
  onEditSubmodule?: (submodule: SubmoduleInfo) => void;
  onUpdateSubmodule?: (submodule: SubmoduleInfo) => void;
  onOpenSubmodule?: (submodule: SubmoduleInfo) => void;
  onDeleteSubmodule?: (submodule: SubmoduleInfo) => void;
  onManageSubmodules?: () => void;
  onRetrySubmodules?: () => void;
}

const EMPTY: SubmoduleInfo[] = [];

export function submoduleContextActions(submodule: SubmoduleInfo, {
  submodulesBusy, onUpdateSubmodule, onEditSubmodule, onOpenSubmodule, onDeleteSubmodule,
}: SubmoduleSidebarProps): ContextAction[] {
  return [
    { id: "update", label: `${submodule.initialized ? "Update" : "Initialize"} ${submodule.path}`, icon: <ArrowDownToLine size={14} />, disabled: submodulesBusy || !onUpdateSubmodule },
    { id: "edit", label: `Edit ${submodule.path}`, icon: <Settings2 size={14} />, separatorBefore: true, disabled: submodulesBusy || !onEditSubmodule },
    { id: "open", label: "Open this submodule", icon: <SquareArrowOutUpRight size={14} />, disabled: submodulesBusy || !submodule.initialized || !onOpenSubmodule },
    { id: "delete", label: "Delete this submodule", icon: <Trash2 size={14} />, danger: true, separatorBefore: true, disabled: submodulesBusy || !onDeleteSubmodule },
  ];
}

export function SubmoduleSection({
  submodules = EMPTY,
  submodulesLoading,
  submodulesError,
  submodulesBusy,
  onAddSubmodule,
  onEditSubmodule,
  onUpdateSubmodule,
  onOpenSubmodule,
  onDeleteSubmodule,
  onManageSubmodules,
  onRetrySubmodules,
  filter,
  open,
  onToggle,
}: SubmoduleSidebarProps & { filter: string; open: boolean; onToggle: () => void }) {
  const [menu, setMenu] = useState<{ submodule: SubmoduleInfo; x: number; y: number } | null>(null);
  const filtered = useMemo(() => submodules.filter((item) => `${item.path} ${item.name} ${item.url}`.toLocaleLowerCase().includes(filter)), [submodules, filter]);
  const changed = submodules.filter((item) => item.conflicted || item.dirty || (item.initialized && !item.head_matches_recorded)).length;
  const actions = menu ? submoduleContextActions(menu.submodule, { submodulesBusy, onUpdateSubmodule, onEditSubmodule, onOpenSubmodule, onDeleteSubmodule }) : [];

  return (
    <RefSection
      count={filtered.length}
      icon={<Layers size={14} />}
      label="SUBMODULES"
      onToggle={onToggle}
      open={open}
      trailing={onAddSubmodule ? (
        <IconButton aria-label="Add submodule" className={SUBMODULE_FOCUS} disabled={submodulesBusy} onClick={onAddSubmodule} title="Add submodule">
          <Plus size={14} />
        </IconButton>
      ) : undefined}
    >
      {submodulesError ? (
        <div className="mx-1.5 mb-2 rounded border border-danger/25 bg-danger/5 px-2.5 py-2 text-[11px]">
          <p className="flex items-center gap-1.5 text-danger"><AlertCircle size={13} /> Could not load submodules</p>
          <p className="mt-1 break-words text-muted">{submodulesError}</p>
          {onRetrySubmodules ? <button className={cx("mt-1.5 cursor-pointer rounded text-accent hover:underline", SUBMODULE_FOCUS)} disabled={submodulesLoading} onClick={onRetrySubmodules} type="button">Retry</button> : null}
        </div>
      ) : null}
      {filtered.map((submodule) => {
        const state = submoduleState(submodule);
        const StatusIcon = state.tone === "success" ? Check : state.tone === "muted" ? Circle : AlertCircle;
        const tooltip = `${submodule.path}\n${submodule.url}\n${state.label}\n${submodule.head_oid ?? "Not checked out"}${submodule.head_committed_at !== null ? ` · ${commitDate(submodule.head_committed_at)}` : ""}${submodule.head_summary ? `\n${submodule.head_summary}` : ""}`;
        return (
          <div
            className="group relative flex min-w-0 items-center rounded hover:bg-foreground/5 focus-within:bg-foreground/5"
            key={submodule.path}
            onContextMenu={(event) => { event.preventDefault(); setMenu({ submodule, x: event.clientX, y: event.clientY }); }}
          >
            <button
              aria-label={`${submodule.path}, ${state.label}${submodule.head_oid ? `, commit ${shortOid(submodule.head_oid)}, ${commitAge(submodule.head_committed_at)}` : ""}`}
              className={cx("flex min-w-0 flex-1 cursor-pointer items-start gap-1.5 rounded py-2 pl-1.5 pr-1 text-left", SUBMODULE_FOCUS)}
              onClick={() => onEditSubmodule?.(submodule)}
              onKeyDown={(event) => {
                if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                setMenu({ submodule, x: bounds.left + 12, y: bounds.bottom });
              }}
              title={tooltip}
              type="button"
            >
              <StatusIcon aria-hidden="true" className={cx("mt-0.75 shrink-0", STATUS_COLOR[state.tone])} size={12} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4"><Layers aria-hidden="true" className="shrink-0 text-muted" size={12} /><span className="truncate">{submodule.path}</span></span>
                <span className="mt-1 flex min-w-0 items-center gap-1.25 text-[10px] leading-3 text-muted">
                  {submodule.head_oid ? <><GitCommitHorizontal aria-hidden="true" className="shrink-0" size={11} /><span className="font-mono text-foreground/70">{shortOid(submodule.head_oid)}</span><span aria-hidden="true">·</span><time className="truncate" dateTime={submodule.head_committed_at !== null ? new Date(submodule.head_committed_at * 1_000).toISOString() : undefined} title={commitDate(submodule.head_committed_at)}>{commitAge(submodule.head_committed_at)}</time></> : <span>{state.label}</span>}
                </span>
              </span>
            </button>
            <IconButton
              aria-label={`Actions for ${submodule.path}`}
              aria-haspopup="menu"
              className={cx("mr-0.5 size-6! shrink-0 opacity-40 group-hover:opacity-100 focus:opacity-100", SUBMODULE_FOCUS)}
              onClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setMenu({ submodule, x: bounds.right, y: bounds.bottom }); }}
              title={`Actions for ${submodule.path}`}
            ><MoreHorizontal size={14} /></IconButton>
          </div>
        );
      })}
      {submodulesLoading && !submodules.length ? <SidebarEmpty>Loading submodules…</SidebarEmpty> : !filtered.length && !submodulesError ? (
        filter ? <SidebarEmpty>No matching submodules</SidebarEmpty> : <div className="mx-2.5 mb-2 text-[11px] leading-5 text-muted">Keep related repositories together.{onAddSubmodule ? <button className={cx("block cursor-pointer rounded text-accent hover:underline", SUBMODULE_FOCUS)} disabled={submodulesBusy} onClick={onAddSubmodule} type="button">Add your first submodule</button> : null}</div>
      ) : null}
      {submodules.length && onManageSubmodules ? (
        <button className={cx("mt-1.5 flex w-full cursor-pointer items-center gap-1.5 rounded border border-border/65 px-2 py-1.75 text-[10px] text-muted hover:border-border-strong hover:bg-foreground/4 hover:text-foreground", SUBMODULE_FOCUS)} onClick={onManageSubmodules} title="Pull or push repositories together" type="button">
          <Settings2 size={12} /><span>Manage repositories</span>{changed ? <span className="ml-auto rounded bg-warning/10 px-1.25 text-warning" title={`${changed} submodules need attention`}>{changed}</span> : null}
        </button>
      ) : null}
      {menu ? createPortal(<ContextMenu actions={actions} onAction={(id) => { const item = menu.submodule; setMenu(null); if (id === "update") onUpdateSubmodule?.(item); else if (id === "edit") onEditSubmodule?.(item); else if (id === "open") onOpenSubmodule?.(item); else if (id === "delete") onDeleteSubmodule?.(item); }} onClose={() => setMenu(null)} x={menu.x} y={menu.y} />, document.body) : null}
    </RefSection>
  );
}
