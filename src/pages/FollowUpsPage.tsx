import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { LeadDrawer } from "../components/LeadDrawer";
import { Badge, Button, EmptyState, MetricCard, PageHeader, Progress } from "../components/UI";
import { useCRM } from "../data/store";
import { reopenLead } from "../domain/engine";
import { formatDateTime, phoneHref, relativeTime } from "../lib/format";

type FollowUpTab = "due" | "overdue" | "upcoming" | "dormant" | "interested";

export function FollowUpsPage({ onStartCalling }: { onStartCalling: () => void }) {
  const { state, commit } = useCRM();
  const [tab, setTab] = useState<FollowUpTab>("due");
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const groups = useMemo(() => {
    const warm = state.leads.filter((lead) => lead.pipelineStage === "post_meeting" && !["won", "lost", "do_not_call"].includes(lead.status));
    return {
      due: warm.filter((lead) => lead.nextAction?.type === "post_meeting_follow_up" && new Date(lead.nextAction.dueAt).getTime() >= todayStart.getTime() && new Date(lead.nextAction.dueAt).getTime() <= todayEnd.getTime()),
      overdue: warm.filter((lead) => lead.nextAction?.type === "post_meeting_follow_up" && new Date(lead.nextAction.dueAt).getTime() < todayStart.getTime()),
      upcoming: warm.filter((lead) => lead.nextAction?.type === "post_meeting_follow_up" && new Date(lead.nextAction.dueAt).getTime() > todayEnd.getTime()),
      dormant: state.leads.filter((lead) => lead.status === "dormant_post_meeting_no_response"),
      interested: state.leads.filter((lead) => ["interested", "conversation_follow_up"].includes(lead.status)),
    };
  }, [state.leads, todayEnd, todayStart]);
  const leads = groups[tab].sort((a, b) => (a.nextAction?.dueAt ?? "9999").localeCompare(b.nextAction?.dueAt ?? "9999"));
  const latestMeeting = (leadId: string) => [...state.meetings].filter((meeting) => meeting.leadId === leadId && meeting.status === "completed" && !meeting.voidedAt).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
  const latestTouch = (leadId: string) => [...state.postMeetingTouches].filter((touch) => touch.leadId === leadId && !touch.voidedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];

  return <>
    <PageHeader eyebrow="Warm opportunity desk" title="Follow-Ups" description="Meeting held + no decision stays active. Due post-meeting work outranks cold retries and new leads." actions={<Button variant="primary" onClick={onStartCalling} disabled={!groups.due.length && !groups.overdue.length} startIcon={<Icon name="phone" size={16} />}>Start due follow-ups</Button>} />
    <section className="metric-grid metric-grid--four"><MetricCard label="Due today" value={groups.due.length} icon={<Icon name="followUp" size={18} />} tone="accent" /><MetricCard label="Overdue" value={groups.overdue.length} icon={<Icon name="warning" size={18} />} tone={groups.overdue.length ? "danger" : "neutral"} /><MetricCard label="Upcoming" value={groups.upcoming.length} icon={<Icon name="calendarClock" size={18} />} /><MetricCard label="Dormant / no response" value={groups.dormant.length} icon={<Icon name="history" size={18} />} /></section>
    <section className="panel followups-panel">
      <div className="collection-toolbar"><div className="tabs tabs--wrap">{(["due", "overdue", "upcoming", "interested", "dormant"] as FollowUpTab[]).map((item) => <button key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item === "due" ? "Due today" : item === "interested" ? "Pre-meeting interested" : item[0].toUpperCase() + item.slice(1)} <span>{groups[item].length}</span></button>)}</div></div>
      {leads.length ? <div className="followup-card-list">{leads.map((lead) => {
        const meeting = latestMeeting(lead.id);
        const touch = latestTouch(lead.id);
        const overdue = lead.nextAction && new Date(lead.nextAction.dueAt).getTime() < now;
        const dormant = lead.status === "dormant_post_meeting_no_response";
        return <article className={dormant ? "followup-card is-dormant" : overdue ? "followup-card is-overdue" : "followup-card"} key={lead.id}>
          <header><div className="lead-cell"><span className="lead-avatar">{lead.clinicName.slice(0, 2).toUpperCase()}</span><span><div><Badge tone={dormant ? "neutral" : "purple"} dot>{dormant ? "Dormant opportunity" : lead.pipelineStage === "post_meeting" ? "Warm opportunity" : "Interested prospect"}</Badge></div><strong>{lead.clinicName}</strong><small>{lead.decisionMakerName} · {lead.decisionMakerRole}</small></span></div><div className="followup-card__due"><small>Next action</small><strong className={overdue ? "text-danger" : ""}>{lead.nextAction ? relativeTime(lead.nextAction.dueAt) : "Manually reopen"}</strong><span>{formatDateTime(lead.nextAction?.dueAt)}</span></div></header>
          <div className="followup-card__body"><div className="followup-context-grid"><div><small>Meeting date</small><strong>{formatDateTime(meeting?.scheduledAt)}</strong></div><div><small>Primary finding</small><strong>{lead.primaryFinding || "Not recorded"}</strong></div><div><small>What interested them</small><strong>{meeting?.interestSummary || "Not recorded"}</strong></div><div><small>Main objection</small><strong>{meeting?.mainObjection || "Not recorded"}</strong></div><div><small>Decision status</small><strong>{meeting?.decisionStatus || lead.status.replaceAll("_", " ")}</strong></div><div><small>Last follow-up</small><strong>{touch ? `${touch.type} · ${touch.outcome.replaceAll("_", " ")}` : "No touches yet"}</strong></div></div>{meeting?.notes ? <blockquote>“{meeting.notes}”</blockquote> : null}</div>
          <footer><div className="touch-progress"><div><span>Post-meeting touches</span><strong>{lead.postMeetingTouchCount} / {state.settings.followUp.maximumPostMeetingTouches}</strong></div><Progress value={lead.postMeetingTouchCount} max={state.settings.followUp.maximumPostMeetingTouches} size="sm" tone={lead.postMeetingTouchCount >= state.settings.followUp.maximumPostMeetingTouches ? "warning" : "accent"} /></div><div><a className="phone-link" href={phoneHref(lead.directPhone || lead.mobilePhone)}><Icon name="phone" size={14} /> {lead.directPhone || lead.mobilePhone}</a><Button variant="ghost" size="sm" onClick={() => setDrawerLeadId(lead.id)}>View journey</Button>{dormant ? <Button variant="secondary" size="sm" onClick={() => commit("Opportunity reopened", (current) => reopenLead(current, lead.id), "Warm opportunity reopened")}>Reopen</Button> : overdue || tab === "due" ? <Button variant="primary" size="sm" onClick={onStartCalling}>Call now</Button> : null}</div></footer>
        </article>;
      })}</div> : <EmptyState icon={<Icon name={tab === "dormant" ? "history" : "followUp"} size={28} />} title={`No ${tab === "due" ? "follow-ups due today" : tab.replace("_", " ")} work`} description="Post-meeting opportunities move here automatically and remain visible through all five touches." />}
    </section>
    <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
  </>;
}
