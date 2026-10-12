import type { SubmoduleInfo } from "../../lib/types";

export const SUBMODULE_FOCUS = "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70";

export function submoduleState(submodule: SubmoduleInfo): {
  label: string;
  description: string;
  tone: "success" | "warning" | "danger" | "muted";
} {
  if (submodule.conflicted) return { label: "Conflicted", description: "Resolve the submodule conflict in the parent repository.", tone: "danger" };
  if (!submodule.initialized) return { label: "Not initialized", description: "Initialize to clone this submodule and check out its recorded commit.", tone: "muted" };
  if (submodule.dirty) return { label: "Local changes", description: "This submodule has uncommitted changes. Open it to review them.", tone: "warning" };
  if (!submodule.head_oid) return { label: "No commit", description: "This submodule has no checked-out commit.", tone: "muted" };
  if (!submodule.head_matches_recorded) return { label: "Revision changed", description: "The checked-out commit differs from the commit recorded in the parent index.", tone: "warning" };
  return { label: "In sync", description: "The checked-out commit matches the commit recorded in the parent index.", tone: "success" };
}

export const STATUS_COLOR = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted",
} as const;

export function shortOid(oid: string | null): string {
  return oid?.slice(0, 8) ?? "—";
}

export function commitDate(seconds: number | null): string {
  return seconds === null ? "Commit date unavailable" : new Date(seconds * 1_000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function commitAge(seconds: number | null): string {
  if (seconds === null) return "date unavailable";
  const elapsed = Math.max(0, Date.now() / 1_000 - seconds);
  if (elapsed < 60) return "just now";
  if (elapsed < 3_600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86_400) return `${Math.floor(elapsed / 3_600)}h ago`;
  const days = Math.floor(elapsed / 86_400);
  if (days < 30) return `${days}d ago`;
  return new Date(seconds * 1_000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}
