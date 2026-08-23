import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { LeadDrawer } from "../components/LeadDrawer";
import { Badge, Button, EmptyState, MetricCard, PageHeader } from "../components/UI";
import { useCRM } from "../data/store";
import { reopenLead } from "../domain/engine";
import { downloadExport } from "../domain/files";
import { formatDate, formatDateTime, relativeTime } from "../lib/format";
import type { Lead } from "../types";
import { LeadTable } from "./LeadsPage";

type CollectionKind = "recycle" | "won" | "lost";

const copy = {
  recycle: { eyebrow: "Recovery system", title: "Recycle", description: "Unanswered leads wait here until the configured recycle window opens. Nothing is deleted.", icon: "recycle" },
  won: { eyebrow: "Client book", title: "Won Clients", description: "Every converted client with the complete journey that led to the sale.", icon: "won" },
  lost: { eyebrow: "Closed pipeline", title: "Lost / Closed", description: "Final rejections, protected Do Not Call records, and dormant opportunities with history retained.", icon: "lost" },
};

export function LeadCollectionPage({ kind }: { kind: CollectionKind }) {
  const { state, commit, notify } = useCRM();
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const all = useMemo(() => {
    if (kind === "recycle") return state.leads.filter((lead) => ["recycle_later", "extended_retry", "dormant_unreachable"].includes(lead.status));
    if (kind === "won") return state.leads.filter((lead) => lead.status === "won");
    return state.leads.filter((lead) => ["lost", "do_not_call", "dormant_unreachable", "dormant_post_meeting_no_response"].includes(lead.status));
  }, [kind, state.leads]);
  const leads = all.filter((lead) => {
    const query = search.toLowerCase();
    const matches = !query || `${lead.clinicName} ${lead.decisionMakerName} ${lead.city} ${lead.state} ${lead.lostReason}`.toLowerCase().includes(query);
    if (!matches || tab === "all") return matches;
    if (kind === "recycle") return tab === "ready" ? !!lead.nextAction && new Date(lead.nextAction.dueAt).getTime() <= Date.now() : lead.status === tab;
    if (kind === "lost") return tab === "lost" ? lead.status === "lost" : tab === "dnc" ? lead.status === "do_not_call" : lead.status.startsWith("dormant");
    return true;
  });
  const config = copy[kind];

  const tabs = kind === "recycle"
    ? [{ id: "all", label: "All" }, { id: "recycle_later", label: "Waiting" }, { id: "ready", label: "Ready now" }, { id: "dormant_unreachable", label: "Dormant" }]
    : kind === "lost"
      ? [{ id: "all", label: "All closed" }, { id: "lost", label: "Lost" }, { id: "dnc", label: "Do Not Call" }, { id: "dormant", label: "Dormant" }]
      : [{ id: "all", label: "All clients" }];

  return <>
    <PageHeader eyebrow={config.eyebrow} title={config.title} description={config.description} actions={<Button variant="secondary" onClick={() => void downloadExport({ kind: kind === "won" ? "won" : kind === "lost" ? "lost" : "all-leads", format: "csv", state }).then((fileName) => notify(`${fileName} downloaded`, "success")).catch(() => notify("Export failed", "danger"))} startIcon={<Icon name="download" size={16} />}>Export {kind === "won" ? "clients" : kind}</Button>} />
    {kind === "recycle" ? <section className="metric-grid metric-grid--four"><MetricCard label="Waiting" value={all.filter((lead) => lead.status === "recycle_later" && lead.nextAction && new Date(lead.nextAction.dueAt).getTime() > Date.now()).length} icon={<Icon name="clock" size={18} />} /><MetricCard label="Ready now" value={all.filter((lead) => lead.nextAction && new Date(lead.nextAction.dueAt).getTime() <= Date.now()).length} icon={<Icon name="phone" size={18} />} tone="accent" /><MetricCard label="Extended retry" value={all.filter((lead) => lead.status === "extended_retry").length} icon={<Icon name="spark" size={18} />} /><MetricCard label="Dormant" value={all.filter((lead) => lead.status === "dormant_unreachable").length} icon={<Icon name="history" size={18} />} /></section> : null}
    {kind === "won" ? <section className="metric-grid metric-grid--three"><MetricCard label="Total clients" value={all.length} icon={<Icon name="won" size={18} />} tone="success" /><MetricCard label="Won this month" value={all.filter((lead) => { const date = new Date(lead.updatedAt); const now = new Date(); return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(); }).length} icon={<Icon name="calendar" size={18} />} /><MetricCard label="Lead → client" value={`${state.leads.length ? (all.length / state.leads.length * 100).toFixed(1) : "0.0"}%`} icon={<Icon name="analytics" size={18} />} /></section> : null}
    <section className="panel data-panel">
      <div className="collection-toolbar"><div className="tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>{item.label}{item.id === "all" ? <span>{all.length}</span> : null}</button>)}</div><label className="search-field search-field--sm"><Icon name="search" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search records…" /></label></div>
      {kind === "recycle" ? <RecycleList leads={leads} initialMax={state.settings.calling.maximumInitialAttempts} onOpen={setDrawerLeadId} onReopen={(lead) => commit("Lead reopened", (current) => reopenLead(current, lead.id), "Lead returned to the queue")} /> : leads.length ? <LeadTable leads={leads} onOpen={setDrawerLeadId} /> : <EmptyState icon={<Icon name={config.icon} size={27} />} title={`No ${kind === "won" ? "clients won" : "closed leads"} yet`} description={kind === "won" ? "Won opportunities appear here automatically with their full journey." : "Records matching this view will remain permanently available."} />}
    </section>
    {kind === "lost" && all.length ? <LostReasons leads={all} /> : null}
    <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
  </>;
}

function RecycleList({ leads, initialMax, onOpen, onReopen }: { leads: Lead[]; initialMax: number; onOpen: (id: string) => void; onReopen: (lead: Lead) => void }) {
  if (!leads.length) return <EmptyState icon={<Icon name="recycle" size={27} />} title="Recycle is clear" description="Leads enter automatically after the configured initial no-answer cycle." />;
  return <div className="recycle-list">{leads.sort((a, b) => (a.nextAction?.dueAt ?? "9999").localeCompare(b.nextAction?.dueAt ?? "9999")).map((lead) => {
    const ready = !!lead.nextAction && new Date(lead.nextAction.dueAt).getTime() <= Date.now();
    return <article className="recycle-card" key={lead.id}><div className="lead-cell"><span className="lead-avatar">{lead.clinicName.slice(0, 2).toUpperCase()}</span><span><strong>{lead.clinicName}</strong><small>{lead.decisionMakerName} · {lead.city}, {lead.state}</small></span></div><div><small>Initial attempts</small><strong>{lead.coldAttemptCount} / {initialMax}</strong></div><div><small>Eligible</small><strong className={ready ? "text-success" : ""}>{lead.nextAction ? relativeTime(lead.nextAction.dueAt) : "Dormant"}</strong><small>{formatDateTime(lead.nextAction?.dueAt)}</small></div><Badge tone={ready ? "success" : lead.status === "dormant_unreachable" ? "neutral" : "warning"} dot>{ready ? "Ready now" : lead.status === "dormant_unreachable" ? "Dormant" : "Waiting"}</Badge><div className="recycle-card__actions">{lead.status === "dormant_unreachable" ? <Button variant="secondary" size="sm" onClick={() => onReopen(lead)}>Reopen</Button> : null}<Button variant="ghost" size="icon" onClick={() => onOpen(lead.id)} aria-label={`Open ${lead.clinicName}`}><Icon name="chevronRight" size={17} /></Button></div></article>;
  })}</div>;
}

function LostReasons({ leads }: { leads: Lead[] }) {
  const rows = Object.entries(leads.reduce<Record<string, number>>((counts, lead) => { const reason = lead.status === "do_not_call" ? "Do Not Call" : lead.status.startsWith("dormant") ? "No Response / Dormant" : lead.lostReason || "No reason recorded"; counts[reason] = (counts[reason] ?? 0) + 1; return counts; }, {})).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, count]) => count));
  return <section className="panel lost-reasons"><div className="panel__header"><div><span className="eyebrow">Loss intelligence</span><h2>Why leads close</h2></div><small>Based on {leads.length} retained records</small></div><div className="horizontal-bars">{rows.map(([reason, count]) => <div key={reason}><span>{reason}</span><div><i style={{ width: `${count / max * 100}%` }} /></div><strong>{count}</strong></div>)}</div></section>;
}
