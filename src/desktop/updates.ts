import { useEffect, useState } from "react";

export type UpdateStatus =
  | "unsupported"
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "up-to-date"
  | "error";

export interface AppUpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  message: string;
  isDesktop: boolean;
  isPackaged: boolean;
  platform: string;
  dataPath: string | null;
}

interface RelayDesktopBridge {
  getAppInfo: () => Promise<AppUpdateState>;
  getUpdateState: () => Promise<AppUpdateState>;
  checkForUpdates: () => Promise<AppUpdateState>;
  downloadUpdate: () => Promise<AppUpdateState>;
  installUpdate: () => Promise<boolean>;
  onUpdateState: (callback: (state: AppUpdateState) => void) => () => void;
}

declare global {
  interface Window {
    relayDesktop?: RelayDesktopBridge;
  }
}

const browserState: AppUpdateState = {
  status: "unsupported",
  currentVersion: __APP_VERSION__,
  availableVersion: null,
  progressPercent: null,
  message: "Update checks are available in the installed desktop app.",
  isDesktop: false,
  isPackaged: false,
  platform: "web",
  dataPath: null,
};

export function useAppUpdates() {
  const [state, setState] = useState<AppUpdateState>(browserState);

  useEffect(() => {
    const bridge = window.relayDesktop;
    if (!bridge) return undefined;
    let active = true;
    void bridge.getUpdateState().then((next) => { if (active) setState(next); });
    const unsubscribe = bridge.onUpdateState((next) => { if (active) setState(next); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return {
    ...state,
    checkForUpdates: () => window.relayDesktop?.checkForUpdates(),
    downloadUpdate: () => window.relayDesktop?.downloadUpdate(),
    installUpdate: () => window.relayDesktop?.installUpdate(),
  };
}
