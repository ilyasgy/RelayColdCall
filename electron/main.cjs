const { app, BrowserWindow, ipcMain, net, protocol, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ID = "com.relay.leadoperations";
const APP_PROTOCOL = "relay";
const DEV_SERVER_URL = "http://127.0.0.1:4183";
const isDevelopment = process.argv.includes("--dev");
const isSmokeTest = process.argv.includes("--smoke-test");

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

app.setAppUserModelId(APP_ID);
app.setPath(
  "userData",
  isSmokeTest
    ? path.join(process.cwd(), ".desktop-smoke-profile")
    : path.join(app.getPath("appData"), "Relay Lead Operations"),
);

let mainWindow = null;
let periodicUpdateTimer = null;
let smokeTestTimer = null;
let updateState = {
  status: "idle",
  currentVersion: app.getVersion(),
  availableVersion: null,
  progressPercent: null,
  message: "Ready to check for updates.",
};

function updateSnapshot() {
  return {
    ...updateState,
    currentVersion: app.getVersion(),
    isDesktop: true,
    isPackaged: app.isPackaged,
    platform: process.platform,
    dataPath: app.getPath("userData"),
  };
}

function publishUpdateState(status, patch = {}) {
  updateState = {
    ...updateState,
    ...patch,
    status,
    currentVersion: app.getVersion(),
  };
  const snapshot = updateSnapshot();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("updates:state", snapshot);
  }
  return snapshot;
}

function configureUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    publishUpdateState("checking", {
      progressPercent: null,
      message: "Checking GitHub Releases for a newer version…",
    });
  });

  autoUpdater.on("update-available", (info) => {
    publishUpdateState("available", {
      availableVersion: info.version,
      progressPercent: null,
      message: `Version ${info.version} is available.`,
    });
  });

  autoUpdater.on("update-not-available", () => {
    publishUpdateState("up-to-date", {
      availableVersion: null,
      progressPercent: null,
      message: `Version ${app.getVersion()} is the latest version.`,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    publishUpdateState("downloading", {
      progressPercent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      message: `Downloading update… ${Math.round(progress.percent)}%`,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    publishUpdateState("downloaded", {
      availableVersion: info.version,
      progressPercent: 100,
      message: `Version ${info.version} is ready to install.`,
    });
  });

  autoUpdater.on("error", (error) => {
    publishUpdateState("error", {
      progressPercent: null,
      message: error instanceof Error ? error.message : "The update check failed.",
    });
  });
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    return publishUpdateState("disabled", {
      message: "Update checks run only in an installed production build.",
    });
  }
  if (updateState.status === "checking" || updateState.status === "downloading") {
    return updateSnapshot();
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publishUpdateState("error", {
      message: error instanceof Error ? error.message : "The update check failed.",
    });
  }
  return updateSnapshot();
}

async function downloadUpdate() {
  if (!app.isPackaged || updateState.status !== "available") return updateSnapshot();
  publishUpdateState("downloading", {
    progressPercent: 0,
    message: "Starting update download…",
  });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    publishUpdateState("error", {
      progressPercent: null,
      message: error instanceof Error ? error.message : "The update download failed.",
    });
  }
  return updateSnapshot();
}

function installUpdate() {
  if (!app.isPackaged || updateState.status !== "downloaded") return false;
  publishUpdateState("installing", { message: "Installing update and restarting…" });
  setTimeout(() => autoUpdater.quitAndInstall(false, true), 800);
  return true;
}

function registerApplicationProtocol() {
  protocol.handle(APP_PROTOCOL, (request) => {
    const distributionRoot = path.resolve(app.getAppPath(), "dist");
    const requestUrl = new URL(request.url);
    const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "") || "index.html";
    const requestedFile = path.resolve(distributionRoot, relativePath);
    const insideDistribution = requestedFile === distributionRoot || requestedFile.startsWith(`${distributionRoot}${path.sep}`);
    if (!insideDistribution) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(requestedFile).toString());
  });
}

function isAllowedApplicationUrl(url) {
  return isDevelopment ? url.startsWith(DEV_SERVER_URL) : url.startsWith(`${APP_PROTOCOL}://app/`);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0b0f14",
    title: "Relay Lead Operations",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedApplicationUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.send("updates:state", updateSnapshot());
    if (isSmokeTest) {
      if (smokeTestTimer) clearTimeout(smokeTestTimer);
      setTimeout(() => app.exit(0), 400);
    }
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    if (!isSmokeTest) return;
    console.error(`Desktop smoke test failed (${errorCode}): ${errorDescription}`);
    app.exit(1);
  });

  if (isDevelopment) {
    void mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    void mainWindow.loadURL(`${APP_PROTOCOL}://app/index.html`);
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    registerApplicationProtocol();
    configureUpdater();
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    ipcMain.handle("app:get-info", () => updateSnapshot());
    ipcMain.handle("updates:get-state", () => updateSnapshot());
    ipcMain.handle("updates:check", () => checkForUpdates());
    ipcMain.handle("updates:download", () => downloadUpdate());
    ipcMain.handle("updates:install", () => installUpdate());

    createMainWindow();

    if (isSmokeTest) smokeTestTimer = setTimeout(() => app.exit(2), 15_000);

    if (app.isPackaged && !isSmokeTest) {
      setTimeout(() => { void checkForUpdates(); }, 10_000);
      periodicUpdateTimer = setInterval(() => { void checkForUpdates(); }, 6 * 60 * 60 * 1000);
      periodicUpdateTimer.unref?.();
    } else {
      publishUpdateState("disabled", {
        message: "Update checks run only in an installed production build.",
      });
    }
  });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (periodicUpdateTimer) clearInterval(periodicUpdateTimer);
  if (smokeTestTimer) clearTimeout(smokeTestTimer);
});
