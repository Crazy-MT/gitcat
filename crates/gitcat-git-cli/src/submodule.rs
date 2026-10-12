use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
};

use gitcat_contracts::*;
use gitcat_core::GitBackend;
use tokio_util::sync::CancellationToken;

use crate::{
    backend::{GitCliBackend, download_args},
    runner::os_args,
    validate::{validate_relative_path, validate_remote_url},
};

impl GitCliBackend {
    pub(crate) async fn submodules(&self, root: &Path) -> ApiResult<Vec<SubmoduleInfo>> {
        let modules_file = root.join(".gitmodules");
        if std::fs::symlink_metadata(&modules_file)
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err(ApiError::new(
                ErrorCode::InvalidPath,
                ".gitmodules must not be a symbolic link",
            ));
        }
        if !modules_file.exists() {
            return Ok(Vec::new());
        }
        let config = self
            .read_allow_failure(
                Some(root),
                os_args(&[
                    "config",
                    "--null",
                    "--file",
                    ".gitmodules",
                    "--get-regexp",
                    r"^submodule\..*\.path$",
                ]),
            )
            .await?;
        if !config.success() && config.status.code() != Some(1) {
            return Err(self.runner.failure_error(&config));
        }
        let index = self
            .read(Some(root), os_args(&["ls-files", "--stage", "-z"]))
            .await?;
        let mut gitlinks: HashMap<String, (Option<String>, bool)> = HashMap::new();
        for record in index
            .stdout
            .split(|byte| *byte == 0)
            .filter(|record| !record.is_empty())
        {
            let record = String::from_utf8_lossy(record);
            let Some((metadata, path)) = record.split_once('\t') else {
                continue;
            };
            let fields: Vec<_> = metadata.split_whitespace().collect();
            if fields.len() != 3 || fields[0] != "160000" {
                continue;
            }
            let entry = gitlinks.entry(path.to_owned()).or_default();
            if fields[2] == "0" {
                entry.0 = Some(fields[1].to_owned());
            } else {
                entry.1 = true;
            }
        }
        let mut result = Vec::new();
        for record in config
            .stdout
            .split(|byte| *byte == 0)
            .filter(|record| !record.is_empty())
        {
            let record = String::from_utf8_lossy(record);
            let Some((key, relative)) = record.split_once('\n') else {
                continue;
            };
            let Some(name) = key
                .strip_prefix("submodule.")
                .and_then(|key| key.strip_suffix(".path"))
            else {
                continue;
            };
            let target = checked_submodule_path(root, relative)?;
            let url = self
                .submodule_config(root, &format!("submodule.{name}.url"), true)
                .await?
                .unwrap_or_default();
            let (recorded_oid, index_conflict) =
                gitlinks.get(relative).cloned().unwrap_or_default();
            // Without a .git marker Git would discover the *parent* repository.
            let initialized = if target.join(".git").exists() {
                let output = self
                    .read_allow_failure(Some(&target), os_args(&["rev-parse", "--show-toplevel"]))
                    .await?;
                output.success()
                    && dunce::canonicalize(output.stdout_lossy().trim())
                        .ok()
                        .zip(dunce::canonicalize(&target).ok())
                        .is_some_and(|(actual, expected)| actual == expected)
            } else {
                false
            };
            let mut entry = SubmoduleInfo {
                name: name.to_owned(),
                path: relative.to_owned(),
                url,
                absolute_path: target.to_string_lossy().into_owned(),
                initialized,
                head_oid: None,
                recorded_oid,
                head_summary: None,
                head_committed_at: None,
                branch: None,
                dirty: false,
                conflicted: index_conflict,
                head_matches_recorded: false,
            };
            if initialized {
                let log = self
                    .read_allow_failure(
                        Some(&target),
                        os_args(&["log", "-1", "--format=%H%x00%ct%x00%s", "HEAD", "--"]),
                    )
                    .await?;
                if log.success() {
                    let text = log.stdout_lossy();
                    let fields: Vec<_> = text
                        .trim_end_matches(['\n', '\r'])
                        .splitn(3, '\0')
                        .collect();
                    if fields.len() == 3 {
                        entry.head_oid = Some(fields[0].to_owned());
                        entry.head_committed_at = fields[1].parse().ok();
                        entry.head_summary = Some(fields[2].to_owned());
                    }
                }
                entry.branch = self.submodule_branch(&target).await?;
                let status = self.submodule_status(&target, false).await?;
                entry.dirty = !status.is_empty();
                entry.conflicted |= status.split(|byte| *byte == 0).any(|record| {
                    record.len() > 2
                        && matches!(
                            &record[..2],
                            b"DD" | b"AU" | b"UD" | b"UA" | b"DU" | b"AA" | b"UU"
                        )
                });
                entry.head_matches_recorded =
                    entry.head_oid.is_some() && entry.head_oid == entry.recorded_oid;
            }
            result.push(entry);
        }
        result.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(result)
    }

    async fn submodule_config(
        &self,
        root: &Path,
        key: &str,
        modules: bool,
    ) -> ApiResult<Option<String>> {
        let mut args = os_args(&["config"]);
        if modules {
            args.extend(os_args(&["--file", ".gitmodules"]));
        }
        args.extend(os_args(&["--get", key]));
        let output = self.read_allow_failure(Some(root), args).await?;
        if output.success() {
            Ok(Some(
                output
                    .stdout_lossy()
                    .trim_end_matches(['\n', '\r'])
                    .to_owned(),
            ))
        } else if output.status.code() == Some(1) {
            Ok(None)
        } else {
            Err(self.runner.failure_error(&output))
        }
    }

    async fn submodule_branch(&self, path: &Path) -> ApiResult<Option<String>> {
        let output = self
            .read_allow_failure(
                Some(path),
                os_args(&["symbolic-ref", "--quiet", "--short", "HEAD"]),
            )
            .await?;
        Ok(output
            .success()
            .then(|| output.stdout_lossy().trim().to_owned()))
    }

    async fn submodule_status(&self, path: &Path, include_ignored: bool) -> ApiResult<Vec<u8>> {
        let mut args = os_args(&[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=none",
        ]);
        if include_ignored {
            args.push("--ignored".into());
        }
        Ok(self.read(Some(path), args).await?.stdout)
    }

    async fn selected_submodule(&self, root: &Path, relative: &str) -> ApiResult<SubmoduleInfo> {
        checked_submodule_path(root, relative)?;
        self.submodules(root)
            .await?
            .into_iter()
            .find(|entry| entry.path == relative)
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::InvalidRequest,
                    "The selected path is not a registered submodule",
                )
            })
    }

    async fn ensure_submodule_operation(&self, root: &Path) -> ApiResult<()> {
        if self.operation_state(root).await? != RepositoryOperationState::Normal {
            return Err(ApiError::new(
                ErrorCode::OperationInProgress,
                "Finish the current Git operation before changing submodules",
            ));
        }
        Ok(())
    }

    async fn ensure_clean_submodule(&self, entry: &SubmoduleInfo) -> ApiResult<()> {
        if entry.conflicted {
            return Err(ApiError::new(
                ErrorCode::ConflictsPresent,
                "Resolve submodule conflicts first",
            ));
        }
        if entry.initialized {
            self.ensure_submodule_operation(Path::new(&entry.absolute_path))
                .await?;
            if entry.dirty {
                return Err(ApiError::new(
                    ErrorCode::DirtyWorktree,
                    "Commit or stash changes in the submodule first",
                ));
            }
        }
        Ok(())
    }

    async fn fetch_submodule(&self, path: &Path, remote: &str) -> ApiResult<()> {
        let remotes = self.validate_remote_selection(path, Some(remote)).await?;
        let options = self.network_options(&remotes, Some(remote), false).await;
        let mut args = download_args("fetch");
        args.extend(os_args(&[
            "--no-recurse-submodules",
            "--prune",
            "--",
            remote,
        ]));
        self.mutate_network(path, args, CancellationToken::new(), options)
            .await?;
        Ok(())
    }

    async fn fast_forward_submodule(&self, path: &Path, destination: &str) -> ApiResult<()> {
        self.mutate(
            path,
            os_args(&[
                "-c",
                "submodule.recurse=false",
                "merge",
                "--ff-only",
                "--no-autostash",
                "--no-overwrite-ignore",
                destination,
            ]),
            None,
            CancellationToken::new(),
            false,
        )
        .await?;
        Ok(())
    }

    pub(crate) async fn add_submodule_inner(
        &self,
        root: &Path,
        url: &str,
        relative: &str,
    ) -> ApiResult<MutationResult> {
        self.ensure_submodule_operation(root).await?;
        let target = checked_submodule_path(root, relative)?;
        validate_remote_url(url)?;
        if target.exists() {
            return Err(ApiError::new(
                ErrorCode::InvalidPath,
                "Choose a new, empty submodule path",
            ));
        }
        if self
            .submodules(root)
            .await?
            .iter()
            .any(|entry| entry.path == relative)
        {
            return Err(ApiError::new(
                ErrorCode::InvalidPath,
                "A submodule already uses this path",
            ));
        }
        self.ensure_clean_gitmodules(root).await?;
        let options = self.clone_options(url).await;
        self.mutate_network(
            root,
            os_args(&[
                "-c",
                "submodule.recurse=false",
                "-c",
                "fetch.recurseSubmodules=false",
                "submodule",
                "add",
                "--",
                url,
                relative,
            ]),
            CancellationToken::new(),
            options,
        )
        .await
    }

    pub(crate) async fn set_submodule_url_inner(
        &self,
        root: &Path,
        relative: &str,
        url: &str,
    ) -> ApiResult<MutationResult> {
        self.ensure_submodule_operation(root).await?;
        validate_remote_url(url)?;
        let entry = self.selected_submodule(root, relative).await?;
        if entry.conflicted {
            return Err(ApiError::new(
                ErrorCode::ConflictsPresent,
                "Resolve the submodule conflict before editing its URL",
            ));
        }
        self.mutate(
            root,
            os_args(&["submodule", "set-url", "--", relative, url]),
            None,
            CancellationToken::new(),
            false,
        )
        .await
    }

    // Git add/rm stage .gitmodules. Do not accidentally stage existing edits.
    async fn ensure_clean_gitmodules(&self, root: &Path) -> ApiResult<()> {
        let output = self
            .read(
                Some(root),
                os_args(&["status", "--porcelain=v1", "-z", "--", ".gitmodules"]),
            )
            .await?;
        if output.stdout.split(|byte| *byte == 0).any(|record| {
            record.len() > 2
                && (record[1] != b' '
                    || matches!(
                        &record[..2],
                        b"DD" | b"AU" | b"UD" | b"UA" | b"DU" | b"AA" | b"UU"
                    ))
        }) {
            return Err(ApiError::new(
                ErrorCode::DirtyWorktree,
                "Stage or stash existing .gitmodules edits before adding or removing a submodule",
            ));
        }
        Ok(())
    }

    pub(crate) async fn remove_submodule_inner(
        &self,
        root: &Path,
        relative: &str,
        confirmed: bool,
    ) -> ApiResult<MutationResult> {
        if !confirmed {
            return Err(ApiError::new(
                ErrorCode::ProtectedOperation,
                "Confirm submodule removal first",
            ));
        }
        self.ensure_submodule_operation(root).await?;
        let entry = self.selected_submodule(root, relative).await?;
        self.ensure_clean_submodule(&entry).await?;
        self.ensure_clean_gitmodules(root).await?;
        if !entry.initialized {
            ensure_empty_submodule_directory(Path::new(&entry.absolute_path))?;
        }
        let mut pending = if entry.initialized {
            vec![PathBuf::from(&entry.absolute_path)]
        } else {
            Vec::new()
        };
        while let Some(target) = pending.pop() {
            if !self.submodule_status(&target, true).await?.is_empty() {
                return Err(ApiError::new(
                    ErrorCode::DirtyWorktree,
                    "The submodule contains local or ignored files; move or commit them before removal",
                ));
            }
            for nested in self.submodules(&target).await? {
                if nested.initialized {
                    pending.push(PathBuf::from(nested.absolute_path));
                } else {
                    ensure_empty_submodule_directory(Path::new(&nested.absolute_path))?;
                }
            }
        }
        // No force, deinit, or filesystem deletion. Git checks the index and
        // preserves the submodule object database in .git/modules for recovery.
        self.mutate(
            root,
            os_args(&["rm", "--", relative]),
            None,
            CancellationToken::new(),
            false,
        )
        .await
    }

    pub(crate) async fn sync_submodule_inner(
        &self,
        root: &Path,
        relative: &str,
        action: SubmoduleSyncAction,
    ) -> ApiResult<MutationResult> {
        self.ensure_submodule_operation(root).await?;
        let entry = self.selected_submodule(root, relative).await?;
        self.ensure_clean_submodule(&entry).await?;
        let before = self.head_oid(root).await?;
        if !entry.initialized {
            if action == SubmoduleSyncAction::Push {
                return Err(ApiError::new(
                    ErrorCode::UnsupportedOperation,
                    "Initialize this submodule before pushing",
                ));
            }
            ensure_empty_submodule_directory(Path::new(&entry.absolute_path))?;
            validate_remote_url(&entry.url)?;
            // Explicit checkout overrides executable update strategies from config.
            // Never recurse into unreviewed nested module URLs.
            let options = self.clone_options(&entry.url).await;
            self.mutate_network(
                root,
                os_args(&[
                    "-c",
                    "submodule.recurse=false",
                    "-c",
                    "fetch.recurseSubmodules=false",
                    "submodule",
                    "update",
                    "--init",
                    "--checkout",
                    "--",
                    relative,
                ]),
                CancellationToken::new(),
                options,
            )
            .await?;
            // Initialization reproduces the parent's recorded revision. A
            // later explicit update can advance it to the remote branch.
            let mut result = self.mutation_result(root, before).await?;
            result.notice =
                Some("Initialized at the commit recorded by the parent repository.".to_owned());
            return Ok(result);
        }
        let target = Path::new(&entry.absolute_path);
        match action {
            SubmoduleSyncAction::Push => {
                if entry.branch.is_none() {
                    return Err(ApiError::new(
                        ErrorCode::UnsupportedOperation,
                        "Detached HEAD: open this submodule and check out a branch before pushing",
                    ));
                }
                self.push(
                    target,
                    &PushOptions {
                        skip_submodules: true,
                        remote: None,
                        branch: None,
                        set_upstream: false,
                        force: PushForce::None,
                    },
                    CancellationToken::new(),
                )
                .await?;
            }
            SubmoduleSyncAction::Pull if entry.branch.is_some() => {
                let branch = entry.branch.as_deref().unwrap_or_default();
                let remote = self
                    .submodule_config(target, &format!("branch.{branch}.remote"), false)
                    .await?
                    .ok_or_else(|| {
                        ApiError::new(
                            ErrorCode::UpstreamMissing,
                            "The submodule branch has no upstream configured",
                        )
                    })?;
                if remote != "." {
                    self.fetch_submodule(target, &remote).await?;
                }
                let destination = self
                    .rev_parse_commit(target, "@{upstream}")
                    .await?
                    .ok_or_else(|| {
                        ApiError::new(
                            ErrorCode::UpstreamMissing,
                            "The submodule branch has no upstream configured",
                        )
                    })?;
                self.fast_forward_submodule(target, &destination).await?;
            }
            SubmoduleSyncAction::Pull => {
                // A normal submodule checkout is detached. Fast-forward it to
                // the configured remote branch, preserving detached state.
                self.fetch_submodule(target, "origin").await?;
                let configured = self
                    .submodule_config(root, &format!("submodule.{}.branch", entry.name), false)
                    .await?
                    .or(self
                        .submodule_config(root, &format!("submodule.{}.branch", entry.name), true)
                        .await?);
                let reference = match configured.as_deref() {
                    Some(".") => {
                        let branch = self.submodule_branch(root).await?.ok_or_else(|| {
                            ApiError::new(
                                ErrorCode::UpstreamMissing,
                                "The parent needs a branch for this submodule's branch setting",
                            )
                        })?;
                        format!("refs/remotes/origin/{branch}")
                    }
                    Some(branch) => {
                        self.validate_branch_name(branch).await?;
                        format!("refs/remotes/origin/{branch}")
                    }
                    None => "refs/remotes/origin/HEAD".to_owned(),
                };
                let destination = self.rev_parse_commit(target, &reference).await?.ok_or_else(|| ApiError::new(ErrorCode::UpstreamMissing, "The submodule's remote branch is unavailable; open it and configure a tracking branch"))?;
                let ancestor = self
                    .read_allow_failure(
                        Some(target),
                        os_args(&["merge-base", "--is-ancestor", "HEAD", &destination]),
                    )
                    .await?;
                if !ancestor.success() {
                    return Err(ApiError::new(
                        ErrorCode::NonFastForward,
                        "The submodule contains commits outside its remote branch; open it and reconcile them before updating",
                    ));
                }
                self.fast_forward_submodule(target, &destination).await?;
            }
        }
        self.mutation_result(root, before).await
    }
}

fn ensure_empty_submodule_directory(target: &Path) -> ApiResult<()> {
    if target.exists() {
        let mut entries = std::fs::read_dir(target).map_err(|error| {
            ApiError::new(
                ErrorCode::InvalidPath,
                "The uninitialized submodule path is not an empty directory",
            )
            .with_details(error.to_string())
        })?;
        if entries.next().is_some() {
            return Err(ApiError::new(
                ErrorCode::DirtyWorktree,
                "The uninitialized submodule folder contains local files; move them before initializing or removing it",
            ));
        }
    }
    Ok(())
}

fn checked_submodule_path(root: &Path, relative: &str) -> ApiResult<PathBuf> {
    validate_relative_path(relative)?;
    if relative.contains(char::is_control)
        || relative.contains('\\')
        || relative.starts_with('-')
        || relative.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || part.eq_ignore_ascii_case(".git")
                || part.contains(':')
                || part.ends_with(['.', ' '])
        })
        || Path::new(relative)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(ApiError::new(
            ErrorCode::InvalidPath,
            "Use a repository-relative submodule path without traversal or .git components",
        ));
    }
    let canonical_root = dunce::canonicalize(root).map_err(|error| {
        ApiError::new(ErrorCode::InvalidPath, "Repository root is unavailable")
            .with_details(error.to_string())
    })?;
    let mut target = canonical_root.clone();
    for part in Path::new(relative).components() {
        target.push(part);
        // Check the link itself, including dangling links whose target does not
        // exist yet. Otherwise a future clone could create files outside root.
        if std::fs::symlink_metadata(&target)
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err(ApiError::new(
                ErrorCode::InvalidPath,
                "Submodule paths must not contain symbolic links",
            ));
        }
        if target.exists() {
            let resolved = dunce::canonicalize(&target).map_err(|error| {
                ApiError::new(ErrorCode::InvalidPath, "Submodule path is unavailable")
                    .with_details(error.to_string())
            })?;
            if !resolved.starts_with(&canonical_root) || resolved == canonical_root {
                return Err(ApiError::new(
                    ErrorCode::InvalidPath,
                    "Submodule path must stay inside its parent repository",
                ));
            }
        }
    }
    Ok(target)
}
