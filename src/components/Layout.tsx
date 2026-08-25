import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useCRM } from "../data/store";
import { useAppUpdates } from "../desktop/updates";
import { NAV_ITEMS, type Route } from "../lib/constants";
import { cn, formatDateTime } from "../lib/format";
import { Icon } from "./Icon";
import { Button } from "./UI";

interface LayoutProps {
  route: Route;
  onNavigate: (route: Route) => void;
  onStartCalling: () => void;
  onSearch: (query: string) => void;
  children: ReactNode;
}

function isDueByEndOfToday(value: string | null | undefined, now: number) {
  if (!value) return false;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return new Date(value).getTime() <= end.getTime();
}

export function Layout({ route, onNavigate, onStartCalling, onSearch, children }: LayoutProps) {
  const { state, persistence, canUndo, undo } = useCRM();
  const updates = useAppUpdates();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = new Date(clock).toDateString();

  const badges = useMemo<Record<string, number>>(() => ({
    dashboard: state.leads.filter((lead) => lead.nextAction?.queueEligible && isDueByEndOfToday(lead.nextAction.dueAt, clock)).length,
    meetings: state.meetings.filter((meeting) => meeting.status === "booked" && new Date(meeting.scheduledAt).toDateString() === today).length,
    "follow-ups": state.leads.filter((lead) => lead.pipelineStage === "post_meeting" && isDueByEndOfToday(lead.nextAction?.dueAt, clock)).length,
  }), [clock, state.leads, state.meetings, today]);

  const navigate = (next: Route) => {
    onNavigate(next);
    setMobileOpen(false);
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const value = search.trim();
    if (value) onSearch(value);
  };

  return (
    <div className="app-shell app-shell--simple">
      <aside className={cn("sidebar sidebar--simple", mobileOpen && "sidebar--open")} aria-label="Primary navigation">
        <button className="brand brand--button" onClick={() => navigate("dashboard")} aria-label="Relay Today">
          <span className="brand__mark"><Icon name="zap" size={20} /></span>
          <span className="brand__copy"><strong>Relay</strong><small>Lead organizer</small></span>
        </button>

        <nav className="sidebar__nav sidebar__nav--simple">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.route}
              className={cn("nav-item", route === item.route && "nav-item--active")}
              onClick={() => navigate(item.route)}
              aria-current={route === item.route ? "page" : undefined}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {badges[item.route] ? <span className="nav-item__badge">{badges[item.route]}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar__footer">
          <button className={cn("nav-item", route === "settings" && "nav-item--active")} onClick={() => navigate("settings")}>
            <Icon name="settings" size={18} /><span>Settings</span>
          </button>
          <div className="storage-indicator" title={`Persistence: ${persistence.source}`}>
            <span className={cn("storage-indicator__dot", persistence.source !== "memory" && "is-online")} />
            <span>{persistence.source === "indexeddb" ? "Autosaved on this device" : persistence.source === "localstorage" ? "Local backup storage" : "Saving locally…"}</span>
          </div>
        </div>
      </aside>
      {mobileOpen ? <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> : null}

      <div className="app-main">
        <header className="topbar topbar--simple">
          <div className="topbar__left">
            <Button className="mobile-menu" variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Icon name="menu" size={21} />
            </Button>
            <form className="global-search" onSubmit={submitSearch} role="search">
              <Icon name="search" size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search leads…" aria-label="Search leads" />
              <kbd>/</kbd>
            </form>
          </div>
          <div className="topbar__right">
            {updates.status === "available" || updates.status === "downloading" || updates.status === "downloaded" ? (
              <Button
                className="topbar-update"
                variant="primary"
                size="sm"
                disabled={updates.status === "downloading"}
                onClick={() => updates.status === "downloaded" ? void updates.installUpdate() : void updates.downloadUpdate()}
                startIcon={<Icon name={updates.status === "downloaded" ? "refresh" : "download"} size={15} />}
                title={updates.message}
              >
                <span className="topbar-update__label">{updates.status === "downloaded" ? "Restart to update" : updates.status === "downloading" ? `Downloading ${updates.progressPercent ?? 0}%` : `Update ${updates.availableVersion ?? "available"}`}</span>
              </Button>
            ) : null}
            <span className="topbar__date">{formatDateTime(new Date(), { weekday: "short", month: "short", day: "numeric" })}</span>
            {canUndo ? <Button variant="ghost" size="sm" onClick={undo} startIcon={<Icon name="undo" size={16} />}>Undo</Button> : null}
            <Button variant="ghost" size="icon" aria-label="Open Settings" title="Settings" onClick={() => navigate("settings")}><Icon name="settings" size={19} /></Button>
            {route === "dashboard" ? <Button variant="primary" size="sm" onClick={onStartCalling} startIcon={<Icon name="play" size={15} />}>Start calling</Button> : null}
          </div>
        </header>
        <main className="page" id="main-content">{children}</main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.map((item) => (
          <button key={item.route} className={cn(route === item.route && "is-active")} onClick={() => navigate(item.route)}>
            <Icon name={item.icon} size={19} /><span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
