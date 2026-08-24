import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, PageHeader } from "../components/UI";
import { Icon } from "../components/Icon";
import { LeadDrawer } from "../components/LeadDrawer";
import { useCRM } from "../data/store";
import { reopenLead } from "../domain/engine";
import { downloadExport } from "../domain/files";
import { STATUS_LABELS, STATUS_TONES } from "../lib/constants";
import { formatDateTime } from "../lib/format";
import type { Lead, WorkflowStatus } from "../types";

type FinishedFilter = "all" | "won" | "lost" | "unreachable" | "not_interested" | "disqualified" | "wrong_number" | "do_not_call" | "archived";

const finishedStatuses = new Set<WorkflowStatus>([
  "won", "lost", "not_interested", "disqualified", "wrong_number", "do_not_call",
  "dormant_unreachable", "dormant_post_meeting_no_response", "archived",
]);

function matchesFilter(lead: Lead, filter: FinishedFilter) {
  if (filter === "all") return true;
  if (filter === "unreachable") return lead.status === "dormant_unreachable" || lead.status === "dormant_post_meeting_no_response";
  return lead.status === filter;
}

export function FinishedPage() {
  const { state, commit, notify } = useCRM();
  const [filter, setFilter] = useState<FinishedFilter>("all");
  const [query, setQuery] = useState("");
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const all = useMemo(() => state.leads.filter((lead) => finishedStatuses.has(lead.status)), [state.leads]);
  const leads = all.filter((lead) => {
    const needle = query.trim().toLowerCase();
    return matchesFilter(lead, filter) && (!needle || `${lead.clinicName} ${lead.decisionMakerName} ${lead.directPhone} ${lead.lostReason}`.toLowerCase().includes(needle));
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const filters: Array<{ id: FinishedFilter; label: string }> = [
    { id: "all", label: "All" }, { id: "won", label: "Won" }, { id: "lost", label: "Lost" },
    { id: "not_interested", label: "Not interested" }, { id: "unreachable", label: "Unreachable" },
    { id: "disqualified", label: "Disqualified" }, { id: "wrong_number", label: "Wrong number" },
    { id: "do_not_call", label: "Do not contact" }, { id: "archived", label: "Archived" },
  ];

  return <>
    <PageHeader eyebrow="Retained outcomes" title="Finished" description="Every completed or closed lead remains searchable with its full history." actions={<Button variant="secondary" onClick={() => void downloadExport({ kind: "all-leads", format: "csv", state }).then((name) => notify(`${name} downloaded`, "success")).catch(() => notify("Export failed", "danger"))} startIcon={<Icon name="download" size={16} />}>Export records</Button>} />
    <section className="panel data-panel">
      <div className="finished-toolbar">
        <label className="search-field"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search finished leads…" /><span>{leads.length} results</span></label>
        <div className="filter-chips">{filters.map((item) => <button key={item.id} className={filter === item.id ? "is-active" : ""} onClick={() => setFilter(item.id)}>{item.label}<span>{all.filter((lead) => matchesFilter(lead, item.id)).length}</span></button>)}</div>
      </div>
      {leads.length ? <div className="table-wrap"><table className="data-table finished-table"><thead><tr><th>Clinic</th><th>Contact</th><th>Outcome</th><th>Reason</th><th>Cold attempts</th><th>Follow-up touches</th><th>Finished</th><th>Actions</th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}>
        <td><button className="table-primary-link" onClick={() => setDrawerLeadId(lead.id)}>{lead.clinicName}</button><small>{[lead.city, lead.state].filter(Boolean).join(", ") || "No location"}</small></td>
        <td><strong>{lead.decisionMakerName || "Not recorded"}</strong><small>{lead.decisionMakerRole || lead.directPhone}</small></td>
        <td><Badge tone={STATUS_TONES[lead.status] as "info"} dot>{STATUS_LABELS[lead.status]}</Badge></td>
        <td>{lead.lostReason || lead.lastOutcome.replaceAll("_", " ") || "—"}</td>
        <td><strong>{lead.coldAttemptCount}</strong></td><td><strong>{lead.postMeetingTouchCount}</strong></td>
        <td>{formatDateTime(lead.updatedAt)}</td>
        <td><div className="row-actions"><Button variant="ghost" size="sm" onClick={() => setDrawerLeadId(lead.id)}>View history</Button>{lead.status !== "do_not_call" && lead.status !== "won" ? <Button variant="secondary" size="sm" onClick={() => commit("Lead reopened", (current) => reopenLead(current, lead.id), "Lead reopened and queued")}>Reopen</Button> : null}</div></td>
      </tr>)}</tbody></table></div> : <EmptyState icon={<Icon name="checkCircle" size={26} />} title="No finished leads match" description="Closed outcomes will appear here automatically and remain available." />}
    </section>
    <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
  </>;
}
