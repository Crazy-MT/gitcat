export type RefSectionKey = "local" | "remote" | "tags" | "submodules";

export type RefSectionState = Record<RefSectionKey, boolean>;
