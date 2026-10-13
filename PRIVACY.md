# GitCat privacy notice

Last updated: 2026-10-13.

GitCat is a desktop Git client maintained in the [catninth/gitcat repository](https://github.com/catninth/gitcat). Repository contents and application preferences are processed on your computer. GitCat has no built-in usage analytics, advertising, or automatic crash-report upload service. It does contact Git remotes, hosting services, avatar providers, and GitHub for the features described below.

## Data on your computer

GitCat reads the repositories you open, including paths, file contents, differences, commit messages, author names and email addresses, branches, and remote URLs. Git operations can change those repositories. Files and commits reach a remote through Git operations such as push, using the remote and credentials you have configured; they are not uploaded to a separate GitCat service.

GitCat stores these application files in its data directory:

- `state.json`: preferences, recent repositories, repository tabs and aliases, layout, and hosting-service settings.
- `window.json`: window placement and display state.
- `token-hosts.json`: hostnames with a connected credential, without the tokens themselves.
- `avatars/`: author email-to-avatar mappings, lookup timestamps, and cached image data.

The normal data directory is `%APPDATA%\com.gitcat.desktop` on Windows and `$XDG_DATA_HOME/com.gitcat.desktop` on Linux, falling back to `~/.local/share/com.gitcat.desktop`. The system webview may also retain its own cache and runtime data. Settings exports and saved patches are written to the locations you select. GitCat does not upload diagnostic output automatically; error messages, Git output, or screenshots you choose to share may contain repository details.

Connected access tokens and OAuth refresh tokens are stored in Windows Credential Manager or the Linux Secret Service, under the `gitcat` service. OAuth account and expiry details accompany the token. They are excluded from settings exports. GitCat also supports system Git credential helpers and SSH agents, whose storage is managed separately. Older `tokens.json` files, if present, are migrated to the OS credential store and removed after successful migration; a failed migration can leave that plaintext file in place.

## Network activity

The Windows installer can download Microsoft's WebView2 bootstrapper from `go.microsoft.com` when the required runtime is missing. The bootstrapper then installs the Microsoft runtime, which has its own network activity and data handling.

### Git remotes and hosting accounts

Clone, fetch, pull, push, and remote submodule operations contact the relevant configured servers. They disclose the information needed by the Git protocol, including authentication and repository/commit identifiers; pushes transfer the selected Git objects, including file contents and commit metadata. Your Git configuration, hooks, filters, credential helpers, and SSH setup may cause additional activity outside GitCat's own implementation.

Auto-fetch is enabled by default. It fetches the active repository when opened and subsequently every minute. In Preferences, set **Auto-fetch interval** to `0` to disable it; manual Git operations remain available.

GitHub integrations use `api.github.com`; configured GitHub Enterprise hosts use their `/api/v3` API. Repository-location lookups run when GitHub remotes are displayed. Pull-request and check decorations are enabled by default and refresh as repository snapshots and remote tips change, with short-lived caching. Requests include the repository owner/name and, when needed, commit IDs. Public API requests can run without signing in; connected credentials are sent to the corresponding hosting service.

Signing in starts GitHub's device authorization flow, contacts its `/login/device/code` and `/login/oauth/access_token` endpoints, and asks you to authorize access in your browser. The requested scopes are `repo read:org read:user workflow`. Account lookups and token renewal contact that service. Selecting a hosted repository lists the repositories your account can access; creating one sends its name, optional description, and visibility to the selected host. These features use your chosen account, not a GitCat cloud-storage account.

### Pictures and Gravatar

**Show author pictures from the repository's hosting service** is enabled by default. GitCat resolves GitHub alias addresses to account images or requests a page of the repository's commits and matches author emails locally. The commit-list request sends the repository identity and optional visible commit ID, including a local commit ID that might not have been pushed; it does not send a list of raw author emails. Images are downloaded from the returned avatar URLs, commonly `github.com` and `avatars.githubusercontent.com`, and cached locally. Public lookups do not require a connected account.

**Also ask Gravatar for authors the hosting service does not know** is off by default. When enabled with author pictures, the fallback sends a SHA-256 hash of the trimmed, lowercase author email address to `gravatar.com`. A hash is still an identifier and may be associated with an email address; it is not a promise of anonymity.

Remote-owner pictures and connected-account pictures can load separately in the webview. The author-picture preference does not disable these images or repository-location lookups.

### Application updates

GitCat checks `https://api.github.com/repos/catninth/gitcat/releases/latest` about four seconds after startup and every six hours while running. Manual checks use the same service. These requests use the updater library's user-agent and do not include your repository contents or hosting-account token. GitCat has no in-app switch to disable update checks.

Downloading and installing an update requires your action. Installation requests `https://github.com/catninth/gitcat/releases/download/<tag>/latest.json` for the selected release, then the platform package referenced there. GitHub may redirect asset downloads to its delivery hosts. The updater verifies the package signature before installation; see the [code signing policy](CODE_SIGNING.md).

## Controls and retention

You can disable auto-fetch, author pictures, Gravatar fallback, pull-request decorations, and check decorations in Preferences. These controls do not constitute an offline mode: update checks, repository-location requests, and separately displayed account/owner images remain possible. Operating-system network controls can restrict all connections, which also prevents online features from working.

**Disconnect** under Preferences → Integrations removes GitCat's locally stored credential. It does not revoke the authorization at the provider or remove credentials managed separately by Git. Revoke OAuth access or personal access tokens through the provider's account settings when you want to invalidate them there.

Application state and avatar files remain until removed or replaced. Avatar identity results become eligible for refresh after 30 days (successful lookups) or 7 days (misses); these are freshness limits, not automatic file-deletion deadlines. To remove stored application data, disconnect accounts first, close GitCat, and remove its data directory. This resets preferences and recent history without deleting repositories stored elsewhere. OS credential entries, webview data, exported files, and copies in backups may require separate removal; uninstalling the application is not a guarantee that every copy is erased.

Remote services receive connection information such as your IP address and request metadata and manage their own retention. See the [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement), [Automattic's privacy policy for Gravatar](https://automattic.com/privacy/), and the policies of your chosen Git hosts. Your operating system and webview have their own data-handling behavior.

## Questions and changes

For questions about GitCat's behavior or corrections to this notice, use the [project issue tracker](https://github.com/catninth/gitcat/issues). Issues are public: do not include credentials, private repository contents, or personal data you do not want published. This notice is maintained with the source; older releases may behave differently.
