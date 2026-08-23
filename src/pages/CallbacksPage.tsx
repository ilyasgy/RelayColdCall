import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { LeadDrawer } from "../components/LeadDrawer";
import { Badge, Button, EmptyState, MetricCard, PageHeader } from "../components/UI";
import { useCRM } from "../data/store";
import { formatDateTime, formatLocalTime, phoneHref, relativeTime } from "../lib/format";

type CallbackTab = "due" | "overdue" | "today" | "upcoming";

export function CallbacksPage({ onStartCalling }: { onStartCalling: () => void }) {
  const { state } = useCRM();
  const [tab, setTab] = useState<CallbackTab>("due");
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const now = new Date();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const callbacks = useMemo(() => state.leads.filter((lead) => lead.status === "callback" && lead.callbackAt && lead.nextAction).sort((a, b) => (a.callbackAt ?? "").localeCompare(b.callbackAt ?? "")), [state.leads]);
  const groups = {
    overdue: callbacks.filter((lead) => new Date(lead.callbackAt!).getTime() < now.getTime() - 15 * 60_000),
    due: callbacks.filter((lead) => Math.abs(new Date(lead.callbackAt!).getTime() - now.getTime()) <= 15 * 60_000),
    today: callbacks.filter((lead) => new Date(lead.callbackAt!).getTime() >= todayStart.getTime() && new Date(lead.callbackAt!).getTime() <= todayEnd.getTime()),
    upcoming: callbacks.filter((lead) => new Date(lead.callbackAt!).getTime() > todayEnd.getTime()),
  };
  const visible = groups[tab];

  return <>
    <PageHeader eyebrow="Exact commitments" title="Callbacks" description="Requested callback times are protected from the normal retry cadence and enter the queue at highest priority." actions={<Button variant="primary" onClick={onStartCalling} disabled={!groups.due.length && !groups.overdue.length} startIcon={<Icon name="phone" size={16} />}>Call due callbacks</Button>} />
    <section className="metric-grid metric-grid--four"><MetricCard label="Due now" value={groups.due.length} icon={<Icon name="phoneIncoming" size={18} />} tone="accent" /><MetricCard label="Overdue" value={groups.overdue.length} icon={<Icon name="warning" size={18} />} tone={groups.overdue.length ? "danger" : "neutral"} /><MetricCard label="Today" value={groups.today.length} icon={<Icon name="calendar" size={18} />} /><MetricCard label="Upcoming" value={groups.upcoming.length} icon={<Icon name="calendarClock" size={18} />} /></section>
    <section className="panel callback-panel">
      <div className="collection-toolbar"><div className="tabs">{(["due", "overdue", "today", "upcoming"] as CallbackTab[]).map((item) => <button key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item === "due" ? "Due now" : item[0].toUpperCase() + item.slice(1)} <span>{groups[item].length}</span></button>)}</div></div>
      {visible.length ? <div className="callback-list">{visible.map((lead) => {
        const overdue = new Date(lead.callbackAt!).getTime() < Date.now();
        return <article className={overdue ? "is-overdue" : ""} key={lead.id}><div className="callback-time"><strong>{formatDateTime(lead.callbackAt, { hour: "numeric", minute: "2-digit" })}</strong><small>{relativeTime(lead.callbackAt)}</small><i /></div><div className="lead-cell"><span className="lead-avatar">{lead.clinicName.slice(0, 2).toUpperCase()}</span><span><strong>{lead.clinicName}</strong><small>{lead.decisionMakerName} · {lead.decisionMakerRole}</small></span></div><div className="callback-context"><small>Callback note</small><strong>{lead.lastConversationNotes || "Prospect requested a callback"}</strong><span>{formatLocalTime(lead.timeZone)}</span></div><a className="phone-link" href={phoneHref(lead.directPhone || lead.mobilePhone)}><Icon name="phone" size={15} /> {lead.directPhone || lead.mobilePhone}</a><div className="callback-actions"><Badge tone={overdue ? "danger" : "warning"} dot>{overdue ? "Overdue" : "Scheduled"}</Badge>{overdue || Math.abs(new Date(lead.callbackAt!).getTime() - Date.now()) < 15 * 60_000 ? <Button variant="primary" size="sm" onClick={onStartCalling}>Call now</Button> : null}<Button variant="ghost" size="icon" onClick={() => setDrawerLeadId(lead.id)} aria-label={`Open ${lead.clinicName}`}><Icon name="chevronRight" size={17} /></Button></div></article>;
      })}</div> : <EmptyState icon={<Icon name="callback" size={27} />} title={`No ${tab === "due" ? "callbacks due now" : tab + " callbacks"}`} description="Requested callbacks will appear here and enter the main queue automatically." />}
    </section>
    <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
  </>;
}
