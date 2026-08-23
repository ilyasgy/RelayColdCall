import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./components/Icon";
import { Layout } from "./components/Layout";
import { Badge, Button, Modal, Toast, UndoBar } from "./components/UI";
import { useCRM } from "./data/store";
import { ROUTES, type Route } from "./lib/constants";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { CallbacksPage } from "./pages/CallbacksPage";
import { DashboardPage } from "./pages/DashboardPage";
import { FocusMode } from "./pages/FocusMode";
import { FollowUpsPage } from "./pages/FollowUpsPage";
import { ImportPage } from "./pages/ImportPage";
import { LeadCollectionPage } from "./pages/LeadCollectionPage";
import { LeadsPage } from "./pages/LeadsPage";
import { MeetingsPage } from "./pages/MeetingsPage";
import { QueuePage } from "./pages/QueuePage";
import { SettingsPage } from "./pages/SettingsPage";

type AppLocation = Route | "focus";

const routeSet = new Set<string>(ROUTES);

function parseHash(hash: string): AppLocation | null {
  let value = hash.replace(/^#/, "").replace(/^\/+/, "").split(/[?&]/, 1)[0].replace(/\/+$/, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!value) return "dashboard";
  if (value === "focus" || value === "calling") return "focus";
  return routeSet.has(value) ? value as Route : null;
}

function initialLocation(): AppLocation {
  if (typeof window === "undefined") return "dashboard";
  return parseHash(window.location.hash) ?? "dashboard";
}

function hashFor(location: AppLocation) {
  return `#/${location}`;
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.matches("input, textarea, select, [contenteditable='true']") || target.isContentEditable);
}

const pageTitles: Record<AppLocation, string> = {
  dashboard: "Dashboard",
  queue: "Call Queue",
  leads: "All Leads",
  callbacks: "Callbacks",
  meetings: "Meetings",
  "follow-ups": "Follow-Ups",
  recycle: "Recycle",
  won: "Won Clients",
  lost: "Lost / Closed",
  analytics: "Analytics",
  import: "Import",
  settings: "Settings",
  focus: "Live Calling",
};

export function App() {
  const { ready, state, toast, canUndo, undo, dismissToast } = useCRM();
  const [location, setLocation] = useState<AppLocation>(initialLocation);
  const [leadSearch, setLeadSearch] = useState("");
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const lastPage = useRef<Route>(location === "focus" ? "queue" : location);

  const syncFromHash = useCallback(() => {
    const next = parseHash(window.location.hash);
    if (!next) {
      lastPage.current = "dashboard";
      setLocation("dashboard");
      window.history.replaceState(null, "", hashFor("dashboard"));
      return;
    }
    if (next !== "focus") lastPage.current = next;
    setLocation(next);
    const canonical = hashFor(next);
    if (window.location.hash !== canonical) window.history.replaceState(null, "", canonical);
  }, []);

  useEffect(() => {
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    window.addEventListener("popstate", syncFromHash);
    return () => {
      window.removeEventListener("hashchange", syncFromHash);
      window.removeEventListener("popstate", syncFromHash);
    };
  }, [syncFromHash]);

  const navigate = useCallback((next: Route) => {
    lastPage.current = next;
    setLocation(next);
    const hash = hashFor(next);
    if (window.location.hash !== hash) window.location.hash = `/${next}`;
  }, []);

  const startCalling = useCallback(() => {
    if (location !== "focus") lastPage.current = location;
    setLocation("focus");
    if (window.location.hash !== hashFor("focus")) window.location.hash = "/focus";
  }, [location]);

  const exitFocusMode = useCallback(() => {
    navigate(lastPage.current);
  }, [navigate]);

  const handleGlobalSearch = useCallback((query: string) => {
    setLeadSearch(query);
    navigate("leads");
  }, [navigate]);

  useEffect(() => {
    document.title = `${pageTitles[location]} · Relay`;
  }, [location]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(dismissToast, toast.undo ? 9_000 : 6_000);
    return () => window.clearTimeout(timer);
  }, [dismissToast, toast]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const typing = isTypingTarget(event.target);

      if (event.key === "?" && !typing) {
        event.preventDefault();
        setShortcutHelpOpen((open) => !open);
        return;
      }

      if (shortcutHelpOpen || location === "focus") return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (!typing && canUndo) {
          event.preventDefault();
          undo();
        }
        return;
      }

      if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const search = document.querySelector<HTMLInputElement>(".global-search input");
        if (search) {
          event.preventDefault();
          search.focus();
          search.select();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, location, shortcutHelpOpen, undo]);

  if (!ready) {
    return (
      <main className="empty-state" style={{ minHeight: "100vh" }} role="status" aria-live="polite" aria-label="Loading Relay CRM">
        <div className="empty-state__icon" aria-hidden="true"><Icon name="database" size={25} /></div>
        <h1 className="empty-state__title">Loading your lead operation</h1>
        <p className="empty-state__description">Restoring leads, queue state, call history, meetings, and settings.</p>
        <span className="spinner" style={{ marginTop: 18 }} aria-hidden="true" />
      </main>
    );
  }

  const toastLayer = toast ? (
    <div className="toast-stack">
      {toast.undo && canUndo ? (
        <UndoBar
          key={toast.id}
          message={toast.message}
          onUndo={undo}
          onDismiss={dismissToast}
        />
      ) : (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone === "default" ? "neutral" : toast.tone}
          onDismiss={dismissToast}
        />
      )}
    </div>
  ) : null;

  return (
    <>
      {location === "focus" ? (
        <FocusMode onExit={exitFocusMode} />
      ) : (
        <Layout
          route={location}
          onNavigate={navigate}
          onStartCalling={startCalling}
          onSearch={handleGlobalSearch}
        >
          <RoutePage
            route={location}
            leadSearch={leadSearch}
            navigate={navigate}
            startCalling={startCalling}
          />
        </Layout>
      )}

      {toastLayer}

      <ShortcutHelpModal
        open={shortcutHelpOpen}
        onClose={() => setShortcutHelpOpen(false)}
        enabled={state.settings.interface.keyboardShortcutsEnabled}
      />
    </>
  );
}

function RoutePage({
  route,
  leadSearch,
  navigate,
  startCalling,
}: {
  route: Route;
  leadSearch: string;
  navigate: (route: Route) => void;
  startCalling: () => void;
}) {
  switch (route) {
    case "dashboard":
      return <DashboardPage onNavigate={navigate} onStartCalling={startCalling} />;
    case "queue":
      return <QueuePage onStartCalling={startCalling} />;
    case "leads":
      return <LeadsPage initialSearch={leadSearch} onImport={() => navigate("import")} />;
    case "callbacks":
      return <CallbacksPage onStartCalling={startCalling} />;
    case "meetings":
      return <MeetingsPage />;
    case "follow-ups":
      return <FollowUpsPage onStartCalling={startCalling} />;
    case "recycle":
      return <LeadCollectionPage kind="recycle" />;
    case "won":
      return <LeadCollectionPage kind="won" />;
    case "lost":
      return <LeadCollectionPage kind="lost" />;
    case "analytics":
      return <AnalyticsPage />;
    case "import":
      return <ImportPage onViewLeads={() => navigate("leads")} />;
    case "settings":
      return <SettingsPage />;
    default:
      return <DashboardPage onNavigate={navigate} onStartCalling={startCalling} />;
  }
}

function ShortcutHelpModal({ open, onClose, enabled }: { open: boolean; onClose: () => void; enabled: boolean }) {
  const callingShortcuts = [
    ["N", "No answer"],
    ["C", "Schedule callback"],
    ["M", "Book meeting"],
    ["I / F", "Interested / follow-up"],
    ["L", "Lost / not interested"],
    ["B", "Bad number"],
    ["W", "Wrong person"],
    ["D", "Open Do Not Call confirmation"],
    ["Space", "Focus quick notes"],
    ["Enter", "Confirm the active outcome form"],
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Keyboard shortcuts"
      description="Keep your hands on the keyboard without risking actions while typing in a field."
      dismissible={false}
    >
      <div
        className="stack"
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" || event.key === "?") {
            event.preventDefault();
            onClose();
          }
          if (event.key !== "Tab") event.stopPropagation();
        }}
      >
        <div className="cluster cluster--between">
          <span className="secondary">Shortcut status</span>
          <Badge tone={enabled ? "success" : "warning"} dot>{enabled ? "Enabled" : "Disabled in Settings"}</Badge>
        </div>

        <section aria-labelledby="global-shortcuts-heading">
          <h3 id="global-shortcuts-heading" className="detail-section__title">Anywhere in the CRM</h3>
          <div className="shortcut-list">
            <ShortcutRow keys="/" label="Focus global search" />
            <ShortcutRow keys="?" label="Open or close this shortcut guide" />
            <ShortcutRow keys="Ctrl / Cmd + Z" label="Undo the last operational action" />
            <ShortcutRow keys="Esc" label="Close the active dialog" />
          </div>
        </section>

        <section aria-labelledby="calling-shortcuts-heading">
          <h3 id="calling-shortcuts-heading" className="detail-section__title">Live calling mode</h3>
          <div className="shortcut-list">
            {callingShortcuts.map(([keys, label]) => <ShortcutRow key={keys} keys={keys} label={label} />)}
          </div>
        </section>

        <p className="form-hint">Single-key actions are ignored while an input, select, note field, or dialog is active.</p>
        <div className="cluster" style={{ justifyContent: "flex-end" }}>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="shortcut-row">
      <span className="shortcut-row__label">{label}</span>
      <kbd>{keys}</kbd>
    </div>
  );
}
