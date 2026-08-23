# Relay Cold Call CRM

Relay is a local-first lead operations CRM built around one question: **who should I call next?** It manages cold-call attempts, automatic retry and recycle timing, callbacks, meetings, five-touch post-meeting follow-up, analytics, imports, exports, and backups.

## Run locally

```powershell
npm install
npm run dev
```

Open the URL printed by Vite (normally `http://127.0.0.1:4173`). The first launch includes a sample workspace so the complete calling journey can be explored immediately.

To run the same React application inside its Electron desktop shell:

```powershell
npm run desktop:dev
```

## Quality checks

```powershell
npm test
npm run build
```

## Data storage

Operational data is saved automatically to IndexedDB after every state change, with localStorage and in-memory fallbacks. Refreshing or restarting the browser preserves the workspace. Use **Settings → Data** to request durable browser storage, export CSV/XLSX files, and download or restore a versioned JSON backup.

Browser data can still be lost if site storage is manually cleared or the device is lost, so periodic JSON backups are recommended.

The installed Windows app uses the stable `relay://app` origin and stores its Chromium profile under `%APPDATA%\Relay Lead Operations`. The NSIS installer and every update replace packaged application files only; this profile is outside the installation directory.

## Calling workflow

1. Import CSV/XLSX leads or use the sample data.
2. Select **Start Calling**.
3. Read the lead context, place the call in your separate calling platform, and choose an outcome.
4. Relay records the attempt, computes the next action, and immediately advances to the next eligible lead.
5. Review the Dashboard, Analytics, Callbacks, Meetings, and Follow-Ups views at any time.

Cold-call attempts and post-meeting follow-up touches are deliberately stored and displayed as separate counters.

## Desktop releases and updates

The Windows desktop build uses Electron, Electron Builder's per-user NSIS installer, `electron-updater`, and GitHub Releases. The app checks after startup and every six hours, and Settings → About & updates includes the version and manual update controls.

See [DISTRIBUTION.md](./DISTRIBUTION.md) for the one-time GitHub setup, semantic version commands, release workflow, private-repository options, code signing, and data-safety details.
