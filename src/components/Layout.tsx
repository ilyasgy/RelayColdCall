import { type ReactNode, useMemo, useState } from "react";
import { useCRM } from "../data/store";
import { useAppUpdates } from "../desktop/updates";
import { getQueue } from "../domain/engine";
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

const groupLabels = {
  work: "Work",
  data: "Data",
  insights: "Insights",
  system: "System",
};

export function Layout({ route, onNavigate, onStartCalling, onSearch, children }: LayoutProps) {
  const { state, persistence, canUndo, undo } = useCRM();
  const updates = useAppUpdates();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const now = Date.now();
  const queueCount = useMemo(() => getQueue(state, new Date(now)).length, [state, now]);

  const badges = useMemo<Record<string, number>>(() => {
    const overdueCallbacks = state.leads.filter((lead) => lead.status === "callback" && lead.callbackAt && new Date(lead.callbackAt).getTime() <= now).length;
    const followUpsDue = state.leads.filter((lead) => lead.status === "post_meeting_follow_up" && lead.nextAction && new Date(lead.nextAction.dueAt).getTime() <= now).length;
    const meetingsToday = state.meetings.filter((meeting) => meeting.status === "booked" && new Date(meeting.scheduledAt).toDateString() === new Date(now).toDateString()).length;
    return { queue: queueCount, callbacks: overdueCallbacks, "follow-ups": followUpsDue, meetings: meetingsToday };
  }, [now, queueCount, state.leads, state.meetings]);

  const navigate = (next: Route) => {
    onNavigate(next);
    setMobileOpen(false);
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const value = search.trim();
    if (!value) return;
    onSearch(value);
  };

  return (
    <div className="app-shell">
      <aside className={cn("sidebar", mobileOpen && "sidebar--open")} aria-label="Primary navigation">
        <div className="brand" onClick={() => navigate("dashboard")} role="button" tabIndex={0}>
          <span className="brand__mark"><Icon name="zap" size={20} /></span>
          <span className="brand__copy"><strong>Relay</strong><small>Lead operations</small></span>
        </div>
        <nav className="sidebar__nav">
          {(Object.keys(groupLabels) as Array<keyof typeof groupLabels>).map((group) => {
            const items = NAV_ITEMS.filter((item) => item.group === group);
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group}>
                <div className="nav-group__label">{groupLabels[group]}</div>
                {items.map((item) => (
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
              </div>
            );
          })}
        </nav>
        <div className="sidebar__footer">
          <div className="storage-indicator" title={`Persistence: ${persistence.source}`}>
            <span className={cn("storage-indicator__dot", persistence.source !== "memory" && "is-online")} />
            <span>{persistence.source === "indexeddb" ? "Autosaved locally" : persistence.source === "localstorage" ? "Backup storage active" : "Saving…"}</span>
          </div>
          <div className="sidebar__operator">
            <span className="avatar">OP</span>
            <span><strong>Operator</strong><small>Primary caller</small></span>
            <Icon name="more" size={18} />
          </div>
        </div>
      </aside>
      {mobileOpen ? <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> : null}

      <div className="app-main">
        <header className="topbar">
          <div className="topbar__left">
            <Button className="mobile-menu" variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Icon name="menu" size={21} />
            </Button>
            <form className="global-search" onSubmit={submitSearch} role="search">
              <Icon name="search" size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search clinic, person, phone…"
                aria-label="Search leads"
              />
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
            {canUndo ? (
              <Button variant="ghost" size="sm" onClick={undo} startIcon={<Icon name="undo" size={16} />}>Undo</Button>
            ) : null}
            <Button variant="ghost" size="icon" aria-label="Open callback notifications" title="Open callback notifications" onClick={() => navigate("callbacks")}><Icon name="bell" size={19} /></Button>
            {(route === "dashboard" || route === "queue") ? (
              <Button variant="primary" size="sm" onClick={onStartCalling} startIcon={<Icon name="play" size={15} />}>Start calling</Button>
            ) : null}
          </div>
        </header>
        <main className="page" id="main-content">{children}</main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.filter((item) => ["dashboard", "queue", "leads", "meetings", "settings"].includes(item.route)).map((item) => (
          <button key={item.route} className={cn(route === item.route && "is-active")} onClick={() => navigate(item.route)}>
            <Icon name={item.icon} size={19} /><span>{item.route === "settings" ? "More" : item.label.replace("All ", "")}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
