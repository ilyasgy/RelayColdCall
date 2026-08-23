import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Activity, CRMState, PersistenceStatus } from "../types";
import { createSampleState } from "../domain/engine";
import { loadState, requestPersistentStorage, saveState } from "./db";

type StateRecipe = (state: CRMState) => CRMState;

interface ToastState {
  id: number;
  message: string;
  tone?: "default" | "success" | "warning" | "danger";
  undo?: boolean;
}

interface CRMContextValue {
  state: CRMState;
  ready: boolean;
  persistence: PersistenceStatus;
  toast: ToastState | null;
  commit: (label: string, recipe: StateRecipe, message?: string) => void;
  replaceState: (state: CRMState, message?: string) => void;
  undo: () => void;
  canUndo: boolean;
  notify: (message: string, tone?: ToastState["tone"]) => void;
  dismissToast: () => void;
  refreshPersistence: () => Promise<void>;
}

const CRMContext = createContext<CRMContextValue | null>(null);

function cloneState(state: CRMState): CRMState {
  return structuredClone(state);
}

function undoActivity(state: CRMState, label: string): CRMState {
  const now = new Date().toISOString();
  const activity: Activity = {
    id: `activity-undo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    leadId: null,
    type: "action_undone",
    occurredAt: now,
    title: `Undid ${label}`,
    note: "The previous operational state was restored.",
    metadata: { label },
    voidedAt: null,
  };
  return {
    ...state,
    revision: state.revision + 1,
    updatedAt: now,
    activities: [...state.activities, activity],
  };
}

export function CRMProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<CRMState>(() => createSampleState());
  const [ready, setReady] = useState(false);
  const [persistence, setPersistence] = useState<PersistenceStatus>({
    supported: typeof indexedDB !== "undefined",
    persisted: false,
    source: "memory",
  });
  const [toast, setToast] = useState<ToastState | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef<Array<{ label: string; state: CRMState }>>([]);
  const toastSequence = useRef(0);
  const skipFirstSave = useRef(true);
  const broadcast = useRef<BroadcastChannel | null>(null);

  const showToast = useCallback((message: string, tone: ToastState["tone"] = "default", undo = false) => {
    toastSequence.current += 1;
    setToast({ id: toastSequence.current, message, tone, undo });
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const loaded = await loadState();
      if (!active) return;
      if (loaded.state) setState(loaded.state);
      setPersistence(loaded.status);
      setReady(true);
      skipFirstSave.current = true;
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      void saveState(state).then((status) => setPersistence(status));
      return;
    }
    const timer = window.setTimeout(() => {
      void saveState(state).then((status) => {
        setPersistence(status);
        broadcast.current?.postMessage({ type: "state-saved", revision: state.revision });
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [ready, state]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("relay-crm-sync");
    broadcast.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.type !== "state-saved") return;
      if (event.data.revision <= state.revision) return;
      void loadState().then((loaded) => {
        if (loaded.state && loaded.state.revision > state.revision) setState(loaded.state);
      });
    };
    return () => {
      channel.close();
      broadcast.current = null;
    };
  }, [state.revision]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.interface.theme;
    document.documentElement.dataset.density = state.settings.interface.density;
    document.documentElement.style.colorScheme = state.settings.interface.theme;
  }, [state.settings.interface.density, state.settings.interface.theme]);

  const commit = useCallback((label: string, recipe: StateRecipe, message?: string) => {
    setState((current) => {
      const next = recipe(current);
      if (next === current) return current;
      history.current = [...history.current.slice(-19), { label, state: cloneState(current) }];
      setHistoryVersion((version) => version + 1);
      return next;
    });
    showToast(message ?? label, "success", true);
  }, [showToast]);

  const replaceState = useCallback((nextState: CRMState, message = "Data restored") => {
    setState((current) => {
      history.current = [...history.current.slice(-19), { label: "data restore", state: cloneState(current) }];
      setHistoryVersion((version) => version + 1);
      return nextState;
    });
    showToast(message, "success", true);
  }, [showToast]);

  const undo = useCallback(() => {
    const entry = history.current.at(-1);
    if (!entry) return;
    history.current = history.current.slice(0, -1);
    setHistoryVersion((version) => version + 1);
    setState(undoActivity(entry.state, entry.label));
    showToast(`${entry.label} undone`, "default", false);
  }, [showToast]);

  const refreshPersistence = useCallback(async () => {
    const status = await requestPersistentStorage();
    setPersistence(status);
    setState((current) => ({
      ...current,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
      settings: {
        ...current.settings,
        data: { ...current.settings.data, persistentStorageGranted: status.persisted },
      },
    }));
    showToast(status.persisted ? "Durable browser storage enabled" : "Browser storage is active; keep backups enabled", status.persisted ? "success" : "warning");
  }, [showToast]);

  const value = useMemo<CRMContextValue>(() => ({
    state,
    ready,
    persistence,
    toast,
    commit,
    replaceState,
    undo,
    canUndo: history.current.length > 0,
    notify: (message, tone) => showToast(message, tone, false),
    dismissToast: () => setToast(null),
    refreshPersistence,
  }), [
    commit,
    historyVersion,
    persistence,
    ready,
    refreshPersistence,
    replaceState,
    showToast,
    state,
    toast,
    undo,
  ]);

  return <CRMContext.Provider value={value}>{children}</CRMContext.Provider>;
}

export function useCRM() {
  const context = useContext(CRMContext);
  if (!context) throw new Error("useCRM must be used inside CRMProvider");
  return context;
}
