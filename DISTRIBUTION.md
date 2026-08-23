# Relay desktop distribution and updates

## What is implemented

- The existing Vite + React CRM remains the product UI and development workflow.
- Electron provides the installed Windows application without requiring Node.js, Git, Codex, or an editor on the user's computer.
- Electron Builder creates a per-user NSIS installer named `Relay-Setup-<version>-x64.exe`.
- `electron-updater` reads `latest.yml` and the installer block map from GitHub Releases.
- The app checks for updates ten seconds after startup and every six hours. The user can also use **Settings → About & updates → Check for updates**.
- Downloads are user-approved. When ready, **Install and restart** closes Relay, replaces the application package, and reopens the new version.
- The application is packed into ASAR; the React bundle is minified and source maps are disabled. ASAR is packaging, not encryption, but raw TypeScript source files are not distributed.

## One-time GitHub setup

This directory does not currently have a Git repository or remote. Create the repository on GitHub, then initialize and push this project.

### Simplest option: public source repository

Use a public GitHub repository. The workflow automatically publishes releases back to that repository using GitHub's built-in Actions token. No client token or Personal Access Token is needed.

```powershell
git init
git add .
git commit -m "Initial Relay desktop release"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
git tag v1.0.2
git push origin v1.0.2
```

The tag must exactly match `v` plus the version in `package.json`.

### Recommended private-source option

Keep the source repository private and create a second, public repository that contains only release artifacts. For example, keep `relay-source` private and create an empty public `relay-releases` repository.

In the private source repository, open **Settings → Secrets and variables → Actions** and add:

- Repository variable `RELEASE_GITHUB_OWNER`: the account or organization that owns the public release repository.
- Repository variable `RELEASE_GITHUB_REPO`: the public release repository name.
- Repository secret `RELEASE_GH_TOKEN`: a fine-grained GitHub token with **Contents: Read and write** permission for only the public release repository.

That token exists only inside GitHub Actions while publishing. It is never compiled into Relay or sent to the user.

A private update repository is not recommended for this friend-install workflow. GitHub requires authentication to download private release assets, which would mean provisioning a token on the user's machine. A separate public binary repository keeps the source private without putting credentials in the application.

## Optional Windows code signing

Unsigned installers work, but Windows SmartScreen may warn on first installation. For a signed installer, add these Actions secrets to the source repository:

- `WIN_CSC_LINK`: the Windows signing certificate (`.pfx`) encoded as base64 or otherwise supported by Electron Builder.
- `WIN_CSC_KEY_PASSWORD`: the certificate password.

The workflow passes them only to the build job. Leave them absent until a certificate is available.

## Initial release for the friend

1. Complete one of the GitHub setups above.
2. Push tag `v1.0.2` while `package.json` says `1.0.2`.
3. Open the GitHub repository's **Actions** tab and wait for **Build and publish Windows release** to succeed.
4. Open **Releases → v1.0.2**.
5. Download `Relay-Setup-1.0.2-x64.exe` and send that single file to the friend.
6. Keep `latest.yml` and the `.blockmap` attached to the GitHub Release; the updater uses them, but the friend does not open them.

The friend runs the installer, accepts the per-user installation, and launches **Relay Lead Operations** from the desktop or Start menu.

## Publishing later versions

After Codex changes and tests the application, choose the appropriate semantic version command:

```powershell
npm version patch
```

Examples:

- `1.0.2` → `1.0.3` for a bug fix.
- `1.0.2` → `1.1.0` with `npm version minor` for a backward-compatible feature.
- `1.1.0` → `2.0.0` with `npm version major` for a breaking product/data-contract change.

`npm version` updates `package.json` and `package-lock.json`, creates a version commit, and creates the matching `v<version>` Git tag. Publish it with:

```powershell
git push origin main --follow-tags
```

The tag starts the GitHub Actions workflow. It installs dependencies, verifies the tag/version/release destination, runs all tests, builds the Vite app, builds the Windows installer, and uploads the installer, `latest.yml`, and block map to the GitHub Release.

Do not reuse a version number. Update detection depends on the new semantic version being greater than the installed version.

## What the friend experiences

1. Relay checks GitHub quietly after startup and periodically while open.
2. When a higher version exists, an **Update x.x.x** button appears in the top bar and Settings shows **Download x.x.x**.
3. The friend starts the download. Progress is shown in the app.
4. When complete, Relay shows **Restart to update** / **Install and restart**.
5. Relay closes, the NSIS updater replaces packaged application files, and the new version starts.

No development tools are needed on the friend's computer.

## Data safety

The stable application profile is:

```text
%APPDATA%\Relay Lead Operations
```

Important contents include Chromium's `IndexedDB` directory, the `Local Storage` fallback, and other profile metadata. CRM leads, attempts, notes, meetings, queues, analytics inputs, settings, and batches are stored through IndexedDB under the stable `relay://app` origin.

The program is normally installed separately under a path similar to:

```text
%LOCALAPPDATA%\Programs\Relay Lead Operations
```

Updates replace the packaged program/ASAR and installer-managed application files in the installation location. They do not write to or remove `%APPDATA%\Relay Lead Operations`. The installer also explicitly sets `deleteAppDataOnUninstall: false`.

For defense in depth, continue downloading versioned JSON backups from **Settings → Data**. A deliberate in-app reset, manual deletion of the profile directory, Windows account loss, or disk loss can still remove local data; an application update cannot.

## Useful local commands

```powershell
npm run dev           # Existing browser development workflow
npm run desktop:dev   # React/Vite inside the Electron shell
npm test              # Domain and import/export tests
npm run build         # TypeScript and production Vite build
npm run desktop:pack  # Unpacked local desktop build; updater disabled
```

To create a local update-enabled installer, set `RELEASE_GITHUB_OWNER` and `RELEASE_GITHUB_REPO`, then run `npm run desktop:dist`. The normal release path is the tag-triggered GitHub Actions workflow.
