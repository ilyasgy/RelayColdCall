import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, PageHeader, Progress } from "../components/UI";
import { Icon } from "../components/Icon";
import { LeadDrawer } from "../components/LeadDrawer";
import { useCRM } from "../data/store";
import { reopenLead } from "../domain/engine";
import { cn, formatDateTime } from "../lib/format";

type FollowUpView = "due" | "overdue" | "upcoming" | "dormant";

export function FollowUpsPage({ onStartCalling }: { onStartCalling: () => void }) {
  const { state, commit } = useCRM();
  const [view, setView] = useState<FollowUpView>("due");
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const through = new Date(); through.setHours(23, 59, 59, 999);

  const groups = useMemo(() => {
    const active = state.leads.filter((lead) => lead.pipelineStage === "post_meeting" && lead.nextAction?.type === "post_meeting_follow_up");
    return {
      due: active.filter((lead) => { const at = new Date(lead.nextAction!.dueAt).getTime(); return at >= from.getTime() && at <= through.getTime(); }),
      overdue: active.filter((lead) => new Date(lead.nextAction!.dueAt).getTime() < from.getTime()),
      upcoming: active.filter((lead) => new Date(lead.nextAction!.dueAt).getTime() > through.getTime()),
      dormant: state.leads.filter((lead) => lead.status === "dormant_post_meeting_no_response"),
    };
  }, [from, state.leads, through]);
  const leads = [...groups[view]].sort((left, right) => (left.nextAction?.dueAt ?? "9999").localeCompare(right.nextAction?.dueAt ?? "9999"));
  const tabs: Array<{ id: FollowUpView; label: string }> = [{ id: "due", label: "Due Today" }, { id: "overdue", label: "Overdue" }, { id: "upcoming", label: "Upcoming" }, { id: "dormant", label: "Finished — No Response" }];

  return <>
    <PageHeader eyebrow="Post-meeting opportunities" title="Follow-Ups" description="Every meeting without a final decision stays here through a separate five-touch sequence." actions={<Button variant="primary" onClick={onStartCalling} disabled={!groups.due.length && !groups.overdue.length} startIcon={<Icon name="play" size={16} />}>Work due follow-ups</Button>} />
    <section className="panel followups-panel followups-panel--simple">
      <div className="collection-toolbar"><div className="filter-chips">{tabs.map((tab) => <button key={tab.id} className={view === tab.id ? "is-active" : ""} onClick={() => setView(tab.id)}>{tab.label}<span>{groups[tab.id].length}</span></button>)}</div></div>
      {leads.length ? <div className="followup-list">{leads.map((lead) => {
        const meeting = [...state.meetings].filter((item) => item.leadId === lead.id && item.status === "completed" && !item.voidedAt).sort((left, right) => right.completedAt!.localeCompare(left.completedAt!))[0];
        const lastTouch = [...state.postMeetingTouches].filter((touch) => touch.leadId === lead.id && !touch.voidedAt).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
        const overdue = !!lead.nextAction && new Date(lead.nextAction.dueAt).getTime() < from.getTime();
        const dormant = lead.status === "dormant_post_meeting_no_response";
        return <article className={cn("followup-row", overdue && "is-overdue", dormant && "is-dormant")} key={lead.id}>
          <div className="followup-row__identity"><button className="table-primary-link" onClick={() => setDrawerLeadId(lead.id)}>{lead.clinicName}</button><small>{lead.decisionMakerName || "Decision maker not recorded"} · {lead.decisionMakerRole || "Role not recorded"}</small><Badge tone="purple" size="sm">Meeting held {meeting ? formatDateTime(meeting.scheduledAt, { month: "short", day: "numeric" }) : ""}</Badge></div>
          <div><small>What interested them</small><strong>{meeting?.interestSummary || "Not recorded"}</strong></div>
          <div><small>Main objection</small><strong>{meeting?.mainObjection || "Not recorded"}</strong></div>
          <div><small>Last follow-up</small><strong>{lastTouch ? `${lastTouch.type} · ${lastTouch.outcome.replaceAll("_", " ")}` : "No touches yet"}</strong><span>{lastTouch ? formatDateTime(lastTouch.completedAt) : "—"}</span></div>
          <div className="followup-row__progress"><div><span>Touches</span><strong>{lead.postMeetingTouchCount} / {state.settings.followUp.maximumPostMeetingTouches}</strong></div><Progress value={lead.postMeetingTouchCount} max={state.settings.followUp.maximumPostMeetingTouches} size="sm" tone={dormant ? "warning" : "accent"} /></div>
          <div><small>Next action</small><strong className={cn(overdue && "text-danger")}>{lead.nextAction ? formatDateTime(lead.nextAction.dueAt) : "Sequence finished"}</strong><span>{lead.nextAction?.reason || "History retained"}</span></div>
          <div className="row-actions"><Button variant="ghost" size="sm" onClick={() => setDrawerLeadId(lead.id)}>Open</Button>{dormant ? <Button variant="secondary" size="sm" onClick={() => commit("Follow-up reopened", (current) => reopenLead(current, lead.id, new Date(), "post_meeting"), "Opportunity reopened")}>Extend manually</Button> : <Button variant="primary" size="sm" onClick={() => setDrawerLeadId(lead.id)}>Record touch</Button>}</div>
        </article>;
      })}</div> : <EmptyState icon={<Icon name="followUp" size={27} />} title={view === "due" ? "No follow-ups due today" : `No ${tabs.find((tab) => tab.id === view)?.label.toLowerCase()} follow-ups`} description="Completed meetings enter this sequence only when you choose Start Follow-Up Sequence." />}
    </section>
    <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
  </>;
}
