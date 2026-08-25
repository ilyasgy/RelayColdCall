import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { LeadDrawer } from "../components/LeadDrawer";
import { Badge, Button, EmptyState, Modal, PageHeader } from "../components/UI";
import { useCRM } from "../data/store";
import { applyBulkLeadAction, deleteLeadsPermanently } from "../domain/engine";
import { downloadExport } from "../domain/files";
import { STATUS_LABELS, STATUS_TONES } from "../lib/constants";
import { cn, formatDateTime, toLocalInputValue } from "../lib/format";
import type { Lead } from "../types";

interface LeadsPageProps {
  initialSearch?: string;
  onImport?: () => void;
}

type LeadColumn = "clinic" | "firstName" | "lastName" | "role" | "directPhone" | "personalPhone" | "extension" | "city" | "state" | "tracking" | "website" | "stage" | "attempt" | "next";
type BulkDialog = "schedule" | "status" | "delete" | null;
type TrackingFilter = "all" | "found" | "meta" | "gtm" | "analytics" | "not_found";

const columnLabels: Record<LeadColumn, string> = {
  clinic: "Clinic", firstName: "First Name", lastName: "Last Name", role: "Role",
  directPhone: "Direct Phone", personalPhone: "Personal Phone", extension: "Extension",
  city: "City", state: "State", tracking: "Tracking Technology", website: "Website",
  stage: "Call Status", attempt: "Attempts", next: "Next Action",
};

const defaultColumns: LeadColumn[] = ["clinic", "firstName", "lastName", "role", "directPhone", "personalPhone", "extension", "city", "state", "tracking", "website", "stage", "attempt", "next"];

const trackingFilters: Array<{ value: TrackingFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "found", label: "Tracking Found" },
  { value: "meta", label: "Meta Pixel" },
  { value: "gtm", label: "GTM" },
  { value: "analytics", label: "Google Analytics" },
  { value: "not_found", label: "Not Found" },
];

function matchesTracking(value: string, filter: TrackingFilter) {
  const normalized = value.trim().toLowerCase();
  if (filter === "all") return true;
  if (filter === "found") return Boolean(normalized && normalized !== "not found");
  if (filter === "meta") return normalized.includes("meta pixel");
  if (filter === "gtm") return normalized.includes("gtm");
  if (filter === "analytics") return normalized.includes("google analytics");
  return normalized === "not found";
}

function websiteHref(value: string) {
  if (!value.trim()) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function stageMatches(lead: Lead, value: string) {
  if (value === "all") return true;
  if (value === "new") return lead.status === "new";
  if (value === "calling") return ["cold", "engaged"].includes(lead.pipelineStage) && !["new", "callback"].includes(lead.status);
  if (value === "callback") return lead.status === "callback";
  if (value === "meeting") return lead.pipelineStage === "meeting";
  if (value === "follow_up") return lead.pipelineStage === "post_meeting";
  if (value === "won") return lead.status === "won";
  if (value === "lost") return ["lost", "not_interested", "disqualified"].includes(lead.status);
  if (value === "unreachable") return ["dormant_unreachable", "dormant_post_meeting_no_response"].includes(lead.status);
  return true;
}

function lifecycleLabel(lead: Lead) {
  if (lead.status === "won") return "Won";
  if (["lost", "not_interested", "disqualified", "wrong_number", "do_not_call", "archived", "dormant_unreachable", "dormant_post_meeting_no_response"].includes(lead.status)) return "Finished";
  if (lead.pipelineStage === "meeting") return "Meeting";
  if (lead.pipelineStage === "post_meeting") return "Follow-Up";
  if (lead.status === "new") return "New";
  return "Calling";
}

export function LeadsPage({ initialSearch = "", onImport }: LeadsPageProps) {
  const { state, commit, notify } = useCRM();
  const [query, setQuery] = useState(initialSearch);
  const [stage, setStage] = useState("all");
  const [tracking, setTracking] = useState<TrackingFilter>("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [attempt, setAttempt] = useState("all");
  const [due, setDue] = useState("all");
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [columns, setColumns] = useState<Set<LeadColumn>>(new Set(defaultColumns));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [bulkDialog, setBulkDialog] = useState<BulkDialog>(null);
  const [bulkDate, setBulkDate] = useState(() => toLocalInputValue(new Date()));
  const [bulkStatus, setBulkStatus] = useState<"new" | "not_interested" | "disqualified" | "won" | "lost" | "do_not_call">("new");

  useEffect(() => setQuery(initialSearch), [initialSearch]);

  const stateOptions = useMemo(() => [...new Set(state.leads.map((lead) => lead.state.trim()).filter(Boolean))].sort(), [state.leads]);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

  const leads = useMemo(() => state.leads.filter((lead) => {
    const needle = query.trim().toLowerCase();
    const searchable = `${lead.clinicName} ${lead.websiteUrl} ${lead.decisionMakerFirstName} ${lead.decisionMakerLastName} ${lead.decisionMakerRole} ${lead.directPhone} ${lead.mobilePhone} ${lead.extension} ${lead.email} ${lead.personLinkedinUrl} ${lead.city} ${lead.state} ${lead.trackingTechnologyFound} ${Object.values(lead.customFields).join(" ")}`.toLowerCase();
    const actionAt = lead.nextAction ? new Date(lead.nextAction.dueAt).getTime() : null;
    const dueMatch = due === "all"
      || (due === "overdue" && actionAt !== null && actionAt < todayStart.getTime())
      || (due === "today" && actionAt !== null && actionAt >= todayStart.getTime() && actionAt <= todayEnd.getTime())
      || (due === "future" && actionAt !== null && actionAt > todayEnd.getTime());
    return (!needle || searchable.includes(needle))
      && stageMatches(lead, stage)
      && matchesTracking(lead.trackingTechnologyFound, tracking)
      && (stateFilter === "all" || lead.state === stateFilter)
      && (attempt === "all" || lead.coldNoAnswerCount === Number(attempt))
      && dueMatch;
  }).sort((left, right) => left.importedAt.localeCompare(right.importedAt) || left.id.localeCompare(right.id)), [attempt, due, query, stage, state.leads, stateFilter, todayEnd, todayStart, tracking]);

  const activeFilters = [stage, tracking, stateFilter, attempt, due].filter((value) => value !== "all").length;
  const selectedIds = [...selected];
  const selectVisible = (checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    leads.forEach((lead) => checked ? next.add(lead.id) : next.delete(lead.id));
    return next;
  });
  const clearFilters = () => { setStage("all"); setTracking("all"); setStateFilter("all"); setAttempt("all"); setDue("all"); setQuery(""); };

  const runBulk = (label: string, recipe: Parameters<typeof commit>[1], message: string) => {
    commit(label, recipe, message);
    setSelected(new Set());
    setBulkDialog(null);
  };

  return <>
    <PageHeader eyebrow="Master database" title="Leads" description={`${state.leads.length.toLocaleString()} retained lead${state.leads.length === 1 ? "" : "s"}. Search, filter, and update records without losing history.`} actions={<><Button variant="secondary" onClick={() => void downloadExport({ kind: "all-leads", format: "csv", state }).then((name) => notify(`${name} downloaded`, "success")).catch(() => notify("Export failed", "danger"))} startIcon={<Icon name="download" size={16} />}>Export</Button><Button variant="primary" onClick={onImport} startIcon={<Icon name="upload" size={16} />}>Import leads</Button></>} />

    <section className="panel data-panel leads-master-panel">
      <div className="leads-toolbar">
        <label className="search-field"><Icon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clinic, contact, phone, website…" /><span>{leads.length} results</span></label>
        <div className="columns-control"><Button variant="secondary" size="sm" onClick={() => setColumnsOpen((open) => !open)} startIcon={<Icon name="table" size={15} />}>Columns</Button>{columnsOpen ? <div className="columns-menu">{(Object.keys(columnLabels) as LeadColumn[]).map((column) => <label key={column}><input type="checkbox" checked={columns.has(column)} onChange={(event) => setColumns((current) => { const next = new Set(current); event.target.checked ? next.add(column) : next.delete(column); return next; })} />{columnLabels[column]}</label>)}</div> : null}</div>
      </div>
      <div className="tracking-filter-row" role="group" aria-label="Tracking technology filters">
        {trackingFilters.map((filter) => <button key={filter.value} className={cn("tracking-filter", tracking === filter.value && "is-active")} aria-pressed={tracking === filter.value} onClick={() => setTracking(filter.value)}>{filter.label}</button>)}
      </div>
      <div className="filter-row">
        <select value={stage} onChange={(event) => setStage(event.target.value)} aria-label="Stage"><option value="all">All stages</option><option value="new">New</option><option value="calling">Calling</option><option value="callback">Callback</option><option value="meeting">Meeting</option><option value="follow_up">Follow-Up</option><option value="won">Won</option><option value="lost">Lost / closed</option><option value="unreachable">Unreachable</option></select>
        <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="State"><option value="all">All states</option>{stateOptions.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={attempt} onChange={(event) => setAttempt(event.target.value)} aria-label="Attempt"><option value="all">Any attempt</option><option value="0">Attempt 0</option><option value="1">Attempt 1</option><option value="2">Attempt 2</option><option value="3">Attempt 3</option></select>
        <select value={due} onChange={(event) => setDue(event.target.value)} aria-label="Due"><option value="all">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="future">Future</option></select>
        {activeFilters || query ? <Button variant="ghost" size="sm" onClick={clearFilters} startIcon={<Icon name="close" size={14} />}>Clear {activeFilters ? `${activeFilters} filters` : "search"}</Button> : null}
      </div>

      {selected.size ? <div className="bulk-bar"><strong>{selected.size} selected</strong><Button size="sm" variant="primary" onClick={() => runBulk("Added to Today", (current) => applyBulkLeadAction(current, selectedIds, { type: "add_today" }), `${selected.size} lead${selected.size === 1 ? "" : "s"} added to Today`)}>Add to Today</Button><Button size="sm" variant="secondary" onClick={() => setBulkDialog("schedule")}>Schedule</Button><Button size="sm" variant="secondary" onClick={() => setBulkDialog("status")}>Change status</Button><Button size="sm" variant="secondary" onClick={() => runBulk("Attempts reset", (current) => applyBulkLeadAction(current, selectedIds, { type: "reset_attempts" }), "Attempts reset")}>Reset attempts</Button><Button size="sm" variant="secondary" onClick={() => runBulk("Leads archived", (current) => applyBulkLeadAction(current, selectedIds, { type: "archive" }), "Selected leads archived")}>Archive</Button><Button size="sm" variant="secondary" onClick={() => { const chosen = new Set(selectedIds); const exportState = { ...state, leads: state.leads.filter((lead) => chosen.has(lead.id)) }; void downloadExport({ kind: "all-leads", format: "csv", state: exportState }).then((name) => notify(`${name} downloaded`, "success")).catch(() => notify("Export failed", "danger")); }}>Export</Button><Button size="sm" variant="danger" onClick={() => setBulkDialog("delete")}>Delete</Button><Button size="icon" variant="ghost" onClick={() => setSelected(new Set())} aria-label="Clear selection"><Icon name="close" size={15} /></Button></div> : null}

      {leads.length ? <LeadTable leads={leads} onOpen={setDrawerLeadId} selectable selected={selected} onSelect={setSelected} onSelectVisible={selectVisible} visibleColumns={columns} /> : state.leads.length ? <EmptyState icon={<Icon name="search" size={25} />} title="No leads match" description="Clear a filter or search for a different clinic, person, phone, or location." action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} /> : <EmptyState icon={<Icon name="leads" size={25} />} title="No leads yet" description="Import a CSV or XLSX file to build your lead database." action={<Button variant="primary" onClick={onImport}>Import leads</Button>} />}
    </section>

    <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
    <Modal open={bulkDialog === "schedule"} onClose={() => setBulkDialog(null)} title="Schedule next call" description={`Assign one date and time to ${selected.size} selected lead${selected.size === 1 ? "" : "s"}.`} size="sm" footer={<><Button variant="ghost" onClick={() => setBulkDialog(null)}>Cancel</Button><Button variant="primary" disabled={!bulkDate} onClick={() => runBulk("Calls scheduled", (current) => applyBulkLeadAction(current, selectedIds, { type: "schedule", dueAt: new Date(bulkDate).toISOString() }), "Next calls scheduled")}>Schedule</Button></>}><label className="field"><span>Date and time</span><input type="datetime-local" value={bulkDate} onChange={(event) => setBulkDate(event.target.value)} /></label></Modal>
    <Modal open={bulkDialog === "status"} onClose={() => setBulkDialog(null)} title="Change lead status" description="Only lifecycle-safe statuses are available for bulk changes." size="sm" footer={<><Button variant="ghost" onClick={() => setBulkDialog(null)}>Cancel</Button><Button variant="primary" onClick={() => runBulk("Status changed", (current) => applyBulkLeadAction(current, selectedIds, { type: "set_status", status: bulkStatus }), "Selected statuses updated")}>Apply status</Button></>}><label className="field"><span>Status</span><select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as typeof bulkStatus)}><option value="new">New</option><option value="not_interested">Not interested</option><option value="disqualified">Disqualified</option><option value="won">Won</option><option value="lost">Lost</option><option value="do_not_call">Do not contact</option></select></label></Modal>
    <Modal open={bulkDialog === "delete"} onClose={() => setBulkDialog(null)} title={`Permanently delete ${selected.size} lead${selected.size === 1 ? "" : "s"}?`} description="This removes the selected leads and their call, meeting, note, and follow-up history from this device. This cannot be undone after the undo window closes." size="sm" footer={<><Button variant="ghost" onClick={() => setBulkDialog(null)}>Cancel</Button><Button variant="danger" onClick={() => runBulk("Leads permanently deleted", (current) => deleteLeadsPermanently(current, selectedIds), `${selected.size} lead${selected.size === 1 ? "" : "s"} deleted`)}>Delete permanently</Button></>}><div className="danger-callout"><Icon name="warning" size={20} /><div><strong>History will also be deleted</strong><p>Use Archive if you want the records hidden but preserved.</p></div></div></Modal>
  </>;
}

export function LeadTable({ leads, onOpen, selectable = false, selected = new Set(), onSelect, onSelectVisible, visibleColumns = new Set(defaultColumns) }: { leads: Lead[]; onOpen: (leadId: string) => void; selectable?: boolean; selected?: Set<string>; onSelect?: (next: Set<string>) => void; onSelectVisible?: (checked: boolean) => void; visibleColumns?: Set<LeadColumn> }) {
  const toggle = (id: string, checked: boolean) => { if (!onSelect) return; const next = new Set(selected); checked ? next.add(id) : next.delete(id); onSelect(next); };
  const allVisibleSelected = leads.length > 0 && leads.every((lead) => selected.has(lead.id));
  return <div className="table-wrap"><table className="data-table leads-table"><thead><tr>{selectable ? <th className="select-column"><input type="checkbox" checked={allVisibleSelected} onChange={(event) => onSelectVisible?.(event.target.checked)} aria-label="Select visible leads" /></th> : null}{(Object.keys(columnLabels) as LeadColumn[]).filter((column) => visibleColumns.has(column)).map((column) => <th key={column}>{columnLabels[column]}</th>)}<th><span className="sr-only">Open</span></th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id} className={cn(selected.has(lead.id) && "is-selected")} onDoubleClick={() => onOpen(lead.id)}>{selectable ? <td className="select-column"><input type="checkbox" checked={selected.has(lead.id)} onChange={(event) => toggle(lead.id, event.target.checked)} aria-label={`Select ${lead.clinicName}`} /></td> : null}
    {visibleColumns.has("clinic") ? <td className="lead-clinic-cell"><button className="table-primary-link" title={lead.clinicName} onClick={() => onOpen(lead.id)}>{lead.clinicName}</button>{lead.websiteDomain ? <a href={websiteHref(lead.websiteUrl || lead.websiteDomain)} target="_blank" rel="noreferrer" title={lead.websiteUrl || lead.websiteDomain}>{lead.websiteDomain}</a> : <small>—</small>}</td> : null}
    {visibleColumns.has("firstName") ? <td>{lead.decisionMakerFirstName || "—"}</td> : null}
    {visibleColumns.has("lastName") ? <td>{lead.decisionMakerLastName || "—"}</td> : null}
    {visibleColumns.has("role") ? <td>{lead.decisionMakerRole || "—"}</td> : null}
    {visibleColumns.has("directPhone") ? <td>{lead.directPhone || "—"}</td> : null}
    {visibleColumns.has("personalPhone") ? <td>{lead.mobilePhone || "—"}</td> : null}
    {visibleColumns.has("extension") ? <td>{lead.extension || "—"}</td> : null}
    {visibleColumns.has("city") ? <td>{lead.city || "—"}</td> : null}
    {visibleColumns.has("state") ? <td>{lead.state || "—"}</td> : null}
    {visibleColumns.has("tracking") ? <td className="tracking-value" title={lead.trackingTechnologyFound || "Unknown"}>{lead.trackingTechnologyFound || "Unknown"}</td> : null}
    {visibleColumns.has("website") ? <td>{lead.websiteUrl ? <a className="table-website-link" href={websiteHref(lead.websiteUrl)} target="_blank" rel="noreferrer" title={lead.websiteUrl}>Open website <Icon name="externalLink" size={13} /></a> : "—"}</td> : null}
    {visibleColumns.has("stage") ? <td><Badge tone={STATUS_TONES[lead.status] as "info"} size="sm">{lifecycleLabel(lead)}</Badge><small>{STATUS_LABELS[lead.status]}</small></td> : null}
    {visibleColumns.has("attempt") ? <td>{lead.pipelineStage === "post_meeting" ? <strong>{lead.postMeetingTouchCount} / 5 touches</strong> : <strong>{lead.coldNoAnswerCount} / 3</strong>}</td> : null}
    {visibleColumns.has("next") ? <td className={cn(lead.nextAction?.type === "cold_retry" && "retry-action-cell")}>{lead.nextAction?.type === "cold_retry" ? <Badge tone="info" size="sm">Retry</Badge> : null}<strong>{lead.nextAction?.reason ?? "No future action"}</strong><small className={cn(lead.nextAction && new Date(lead.nextAction.dueAt).getTime() < Date.now() && "text-danger")}>{lead.nextAction ? formatDateTime(lead.nextAction.dueAt) : "History retained"}</small></td> : null}
    <td><Button variant="ghost" size="icon" onClick={() => onOpen(lead.id)} aria-label={`Open ${lead.clinicName}`}><Icon name="chevronRight" size={16} /></Button></td>
  </tr>)}</tbody></table></div>;
}
