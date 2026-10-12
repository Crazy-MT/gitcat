import type { GitCatCommands } from "../lib/api";
import type { MutationResult, SubmoduleInfo, SubmoduleSyncAction } from "../lib/types";

export interface SubmoduleBatchItem {
    path: string;
    name: string;
    status: "pending" | "running" | "success" | "skipped" | "failed";
    message?: string;
}

type BatchApi = Pick<GitCatCommands, "listSubmodules" | "syncSubmodule" | "snapshot" | "pull" | "push">;

export function submoduleErrorMessage(error: unknown): string {
    if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
    return String(error);
}

function skipReason(module: SubmoduleInfo, action: SubmoduleSyncAction): string | null {
    if (module.conflicted) return "Resolve the submodule conflict in the parent repository first.";
    if (module.dirty) return "Commit or stash local changes in this submodule first.";
    if (action === "push" && !module.initialized) return "Initialize this submodule before pushing.";
    if (action === "push" && !module.branch) return "Check out a branch in this submodule before pushing (detached HEAD).";
    return null;
}

/** One explicit scope: this repository and its direct submodules, never unrelated tabs. */
export async function runSubmoduleBatch({
    api, repositoryId, repositoryName, action, includeParent, onProgress,
}: {
    api: BatchApi;
    repositoryId: string;
    repositoryName: string;
    action: SubmoduleSyncAction;
    includeParent: boolean;
    onProgress: (items: SubmoduleBatchItem[]) => void;
}): Promise<SubmoduleBatchItem[]> {
    let modules = await api.listSubmodules(repositoryId);
    const parent: SubmoduleBatchItem = { path: ".", name: repositoryName, status: "pending" };
    const row = (module: SubmoduleInfo): SubmoduleBatchItem => ({ path: module.path, name: module.path, status: "pending" });
    let results = modules.map(row);
    if (includeParent) results = action === "pull" ? [parent, ...results] : [...results, parent];
    const publish = () => onProgress(results.map((item) => ({ ...item })));
    const mark = (path: string, status: SubmoduleBatchItem["status"], message?: string) => {
        results = results.map((item) => item.path === path ? { ...item, status, message } : item);
        publish();
    };
    const execute = async (path: string, operation: () => Promise<MutationResult>): Promise<boolean> => {
        mark(path, "running");
        try {
            const result = await operation();
            if (result.needs_user_action || result.conflicts.length) {
                mark(path, "failed", result.notice ?? "Resolve the repository operation before continuing.");
                return false;
            }
            mark(path, "success", result.notice ?? (action === "pull" ? "Up to date with the remote." : "Push complete."));
            return true;
        } catch (error) {
            const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
            mark(path, code === "unsupported_operation" || code === "upstream_missing" ? "skipped" : "failed", submoduleErrorMessage(error));
            return false;
        }
    };
    const runParent = async (): Promise<boolean> => {
        const state = await api.snapshot(repositoryId);
        if (state.head.kind !== "branch" || state.operation_state !== "normal" || !state.status.clean) {
            mark(".", "skipped", "The parent needs a checked-out branch, a clean working tree, and no unfinished operation. Commit submodule pointers first.");
            return false;
        }
        return execute(".", () => action === "pull"
            ? api.pull(repositoryId, { remote: null, branch: null, mode: "fast_forward_only", prune: true, autostash: false, skip_submodules: true })
            : api.push(repositoryId, { remote: null, branch: null, set_upstream: false, skip_submodules: true }));
    };
    publish();
    if (includeParent && action === "pull") {
        let succeeded = false;
        try { succeeded = await runParent(); }
        catch (error) { mark(".", "failed", submoduleErrorMessage(error)); }
        if (!succeeded) {
            for (const module of modules) mark(module.path, "skipped", "Parent pull did not complete. Resolve it before pulling submodules.");
            return results;
        }
        // Pull can add/remove modules or change their URLs; never run the stale list.
        try {
            modules = await api.listSubmodules(repositoryId);
        } catch (error) {
            for (const module of modules) mark(module.path, "skipped", "The updated submodule list could not be loaded. Refresh before retrying.");
            throw error;
        }
        results = [results.find((item) => item.path === ".")!, ...modules.map(row)];
        publish();
    }
    for (const module of modules) {
        const reason = skipReason(module, action);
        if (reason) mark(module.path, "skipped", reason);
        else await execute(module.path, () => api.syncSubmodule(repositoryId, module.path, action));
    }
    if (includeParent && action === "push") {
        if (results.some((item) => item.path !== "." && item.status !== "success")) {
            mark(".", "skipped", "Push all submodules successfully before publishing the parent repository.");
        } else {
            try { await runParent(); }
            catch (error) { mark(".", "failed", submoduleErrorMessage(error)); }
        }
    }
    return results;
}
