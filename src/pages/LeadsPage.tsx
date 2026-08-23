import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { LeadDrawer } from "../components/LeadDrawer";
import { Badge, Button, EmptyState, PageHeader } from "../components/UI";
import { useCRM } from "../data/store";
import { downloadExport } from "../domain/files";
import { CONTACT_TYPE_LABELS, PRIORITY_LABELS, STATUS_LABELS, STATUS_TONES } from "../lib/constants";
import { cn, formatDateTime, formatLocalTime, relativeTime } from "../lib/format";
import type { Lead } from "../types";

interface LeadsPageProps {
  initialSearch?: string;
  onImport?: () => void;
}

export function LeadsPage({ initialSearch = "", onImport }: LeadsPageProps) {
  const { state, notify } = useCRM();
  const [query, setQuery] = useState(initialSearch);
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [pixel, setPixel] = useState("all");
  const [strength, setStrength] = useState("all");
  const [contactType, setContactType] = useState("all");
  const [batch, setBatch] = useState("all");
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);

  useEffect(() => setQuery(initialSearch), [initialSearch]);

  const leads = useMemo(() => state.leads.filter((lead) => {
    const needle = query.trim().toLowerCase();
    const matchesSearch = !needle || [lead.clinicName, lead.websiteUrl, lead.websiteDomain, lead.decisionMakerName, lead.directPhone, lead.mobilePhone, lead.email, lead.city, lead.state].some((value) => value.toLowerCase().includes(needle));
    return matchesSearch
      && (status === "all" || lead.status === status)
      && (priority === "all" || lead.priority === priority)
      && (pixel === "all" || lead.pixelPresent === pixel)
      && (strength === "all" || lead.findingStrength === strength)
      && (contactType === "all" || lead.contactType === contactType)
      && (batch === "all" || lead.batchId === batch);
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [batch, contactType, pixel, priority, query, state.leads, status, strength]);
  const activeFilters = [status, priority, pixel, strength, contactType, batch].filter((value) => value !== "all").length;

  const clearFilters = () => {
    setStatus("all"); setPriority("all"); setPixel("all"); setStrength("all"); setContactType("all"); setBatch("all"); setQuery("");
  };

  return (
    <>
      <PageHeader
        eyebrow="Lead database"
        title="All Leads"
        description={`${state.leads.length.toLocaleString()} retained records. Every active lead has an explicit next action.`}
        actions={<><Button variant="secondary" onClick={() => void downloadExport({ kind: "all-leads", format: "csv", state }).then((fileName) => notify(`${fileName} downloaded`, "success")).catch(() => notify("Lead export failed", "danger"))} startIcon={<Icon name="download" size={16} />}>Export all leads</Button><Button variant="primary" onClick={onImport} startIcon={<Icon name="plus" size={16} />}>Import leads</Button></>}
      />
      <section className="panel data-panel">
        <div className="filter-toolbar">
          <label className="search-field"><Icon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clinic, contact, phone, email…" /><span>{leads.length} results</span></label>
          <div className="filter-selects">
            <label><span className="sr-only">Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span className="sr-only">Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">All priorities</option>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span className="sr-only">Pixel</span><select value={pixel} onChange={(event) => setPixel(event.target.value)}><option value="all">Any pixel</option><option value="yes">Pixel: Yes</option><option value="no">Pixel: No</option><option value="unknown">Pixel: Unknown</option></select></label>
            <label><span className="sr-only">Finding strength</span><select value={strength} onChange={(event) => setStrength(event.target.value)}><option value="all">Any finding</option><option value="A">Finding A</option><option value="B">Finding B</option><option value="C">Finding C</option><option value="unknown">Unknown</option></select></label>
            <label><span className="sr-only">Contact type</span><select value={contactType} onChange={(event) => setContactType(event.target.value)}><option value="all">Any contact</option>{Object.entries(CONTACT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span className="sr-only">Batch</span><select value={batch} onChange={(event) => setBatch(event.target.value)}><option value="all">All batches</option>{state.batches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </div>
          {activeFilters || query ? <Button variant="ghost" size="sm" onClick={clearFilters} startIcon={<Icon name="close" size={14} />}>Clear {activeFilters ? `${activeFilters} filters` : "search"}</Button> : null}
        </div>
        {leads.length ? <LeadTable leads={leads} onOpen={setDrawerLeadId} /> : <EmptyState icon={<Icon name="search" size={25} />} title="No leads match" description="Clear a filter or search for a different clinic, person, phone, or email." action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />}
      </section>
      <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
    </>
  );
}

export function LeadTable({ leads, onOpen }: { leads: Lead[]; onOpen: (leadId: string) => void }) {
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Clinic / contact</th><th>Status</th><th>Next action</th><th>Attempts</th><th>Local time</th><th>Finding</th><th>Priority</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id} onClick={() => onOpen(lead.id)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpen(lead.id)}><td data-label="Clinic"><div className="lead-cell"><span className="lead-avatar">{lead.clinicName.slice(0, 2).toUpperCase()}</span><span><strong>{lead.clinicName}</strong><small>{lead.decisionMakerName || "Contact needed"} · {lead.city}, {lead.state}</small></span></div></td><td data-label="Status"><Badge tone={STATUS_TONES[lead.status] as "info"} size="sm" dot>{STATUS_LABELS[lead.status]}</Badge></td><td data-label="Next action"><div className="next-action-cell"><strong>{lead.nextAction?.reason ?? "No future action"}</strong><small className={cn(lead.nextAction && new Date(lead.nextAction.dueAt).getTime() < Date.now() && "is-overdue")}>{lead.nextAction ? `${relativeTime(lead.nextAction.dueAt)} · ${formatDateTime(lead.nextAction.dueAt)}` : "History retained"}</small></div></td><td data-label="Attempts"><div className="attempt-cell"><span><strong>{lead.coldAttemptCount}</strong> cold</span>{(lead.pipelineStage === "post_meeting" || lead.postMeetingTouchCount > 0) && <span><strong>{lead.postMeetingTouchCount}</strong> / 5 warm</span>}</div></td><td data-label="Local time"><span className="local-time-cell">{formatLocalTime(lead.timeZone)}</span></td><td data-label="Finding"><div className="finding-cell"><span className={`finding-letter is-${lead.findingStrength.toLowerCase()}`}>{lead.findingStrength}</span><span><strong>{lead.findingCategory || "Uncategorized"}</strong><small>Pixel: {lead.pixelPresent}</small></span></div></td><td data-label="Priority"><Badge tone={lead.priority === "critical" ? "danger" : lead.priority === "high" ? "warning" : "neutral"} size="sm">{PRIORITY_LABELS[lead.priority]}</Badge></td><td><Button variant="ghost" size="icon" aria-label={`Open ${lead.clinicName}`}><Icon name="chevronRight" size={16} /></Button></td></tr>)}</tbody></table></div>;
}
