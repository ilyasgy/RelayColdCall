import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, PageHeader, Progress } from "../components/UI";
import { Icon } from "../components/Icon";
import { LeadDrawer } from "../components/LeadDrawer";
import { useCRM } from "../data/store";
import { startSession } from "../domain/engine";
import { STATUS_LABELS, STATUS_TONES, type Route } from "../lib/constants";
import { cn, formatDateTime } from "../lib/format";
import type { Lead, QueueClass } from "../types";

interface DashboardPageProps {
  onNavigate: (route: Route) => void;
  onStartCalling: () => void;
}

type TodayCategory = "follow_up" | "callback" | "retry" | "new";

interface TodayItem {
  lead: Lead;
  category: TodayCategory;
  priority: 2 | 3 | 4 | 5;
}

function startOfToday(now: number) {
  const value = new Date(now);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfToday(now: number) {
  const value = new Date(now);
  value.setHours(23, 59, 59, 999);
  return value;
}

function categoryFor(queueClass: QueueClass): TodayCategory {
  if (queueClass === "post_meeting_follow_up") return "follow_up";
  if (queueClass === "exact_callback" || queueClass === "interested_follow_up") return "callback";
  if (queueClass === "cold_retry" || queueClass === "recycled") return "retry";
  return "new";
}

function stageFor(lead: Lead) {
  if (lead.status === "won") return "Won";
  if (["meeting_booked", "second_meeting_booked"].includes(lead.status)) return "Meeting";
  if (lead.pipelineStage === "post_meeting") return "Follow-Up";
  if (lead.status === "new") return "New";
  return "Calling";
}

function priorityFor(category: TodayCategory): 2 | 3 | 4 | 5 {
  return category === "follow_up" ? 2 : category === "callback" ? 3 : category === "retry" ? 4 : 5;
}

function priorityWeight(lead: Lead) {
  const manual = { critical: 4, high: 3, normal: 2, low: 1 }[lead.priority];
  const finding = { A: 3, B: 2, C: 1, unknown: 0 }[lead.findingStrength];
  return manual * 100 + finding * 10 + (lead.pixelPresent === "yes" ? 3 : 0) + (lead.contactType === "owner" ? 2 : 0);
}

export function DashboardPage({ onNavigate, onStartCalling }: DashboardPageProps) {
  const { state, commit, notify } = useCRM();
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const from = startOfToday(clock).getTime();
  const through = endOfToday(clock).getTime();

  const todayCalls = state.callAttempts.filter((attempt) => !attempt.voidedAt && new Date(attempt.occurredAt).getTime() >= from);
  const completed = todayCalls.length;
  const target = Math.max(1, state.settings.calling.dailyCallGoal);
  const remaining = Math.max(0, target - completed);
  const meetings = state.meetings
    .filter((meeting) => !meeting.voidedAt && meeting.status === "booked" && new Date(meeting.scheduledAt).getTime() >= from && new Date(meeting.scheduledAt).getTime() <= through)
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));

  const plan = useMemo(() => {
    const due = state.leads.flatMap<TodayItem>((lead) => {
      const action = lead.nextAction;
      if (!action?.queueEligible || action.queueClass === "non_call" || new Date(action.dueAt).getTime() > through || action.queueClass === "new_cold") return [];
      const category = categoryFor(action.queueClass);
      return [{ lead, category, priority: priorityFor(category) }];
    }).sort((left, right) => {
      const priority = left.priority - right.priority;
      if (priority) return priority;
      const time = (left.lead.nextAction?.dueAt ?? "").localeCompare(right.lead.nextAction?.dueAt ?? "");
      return time || priorityWeight(right.lead) - priorityWeight(left.lead);
    });

    const freshNeeded = Math.max(0, target - completed - due.length);
    const fresh = state.leads
      .filter((lead) => lead.status === "new" && lead.nextAction?.queueEligible && lead.nextAction.queueClass === "new_cold")
      .sort((left, right) => priorityWeight(right) - priorityWeight(left) || left.importedAt.localeCompare(right.importedAt))
      .slice(0, freshNeeded)
      .map<TodayItem>((lead) => ({ lead, category: "new", priority: 5 }));
    return [...due, ...fresh];
  }, [completed, state.leads, target, through]);

  const counts = {
    followUps: plan.filter((item) => item.category === "follow_up").length,
    callbacks: plan.filter((item) => item.category === "callback").length,
    retries: plan.filter((item) => item.category === "retry").length,
    newCalls: plan.filter((item) => item.category === "new").length,
  };
  const activeSession = [...state.sessions].reverse().find((session) => !session.endedAt);
  const firstWorkableLeadId = plan.find(({ lead, category }) =>
    category === "new" || new Date(lead.nextAction?.dueAt ?? 0).getTime() <= clock,
  )?.lead.id;

  const start = () => {
    if (!activeSession) commit("Session started", (current) => startSession(current), "Calling session started");
    onStartCalling();
  };

  const copy = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copied`, "success");
    } catch {
      notify(`Could not copy ${label.toLowerCase()}`, "danger");
    }
  };

  if (!state.leads.length) {
    return <>
      <PageHeader eyebrow="Your daily workspace" title="Today" description="Import your lead list once. Relay will keep every lead organized from the first call through the final outcome." />
      <section className="panel today-empty">
        <EmptyState icon={<Icon name="leads" size={28} />} title="Import your first lead list" description="CSV and XLSX files stay on this computer. After import, Today will build the exact work queue for you." action={<Button variant="primary" onClick={() => onNavigate("import")} startIcon={<Icon name="upload" size={16} />}>Import leads</Button>} secondaryAction={<Button variant="secondary" onClick={() => onNavigate("settings")}>Set daily target</Button>} />
      </section>
    </>;
  }

  return <>
    <PageHeader
      eyebrow={formatDateTime(new Date(), { weekday: "long", month: "long", day: "numeric" })}
      title="Today"
      description="Everything needing attention today, in the order it should happen."
      actions={<Button variant="primary" size="lg" onClick={start} disabled={!plan.length} startIcon={<Icon name="play" size={17} />}>{activeSession ? "Resume calling" : "Start calling"}</Button>}
    />

    <section className="today-summary panel">
      <div className="today-goal">
        <div><span className="eyebrow">Calls completed</span><strong>{completed} <small>/ {target}</small></strong><p>{remaining} remaining today</p></div>
        <Progress value={completed} max={target} size="lg" tone={completed >= target ? "success" : "accent"} />
      </div>
      <div className="today-counts" aria-label="Today's planned work">
        <SummaryCount label="Meetings" value={meetings.length} icon="calendar" tone="meeting" />
        <SummaryCount label="Follow-Ups" value={counts.followUps} icon="followUp" tone="follow" />
        <SummaryCount label="Callbacks" value={counts.callbacks} icon="callback" tone="callback" />
        <SummaryCount label="Retries" value={counts.retries} icon="refresh" tone="retry" />
        <SummaryCount label="New Calls" value={counts.newCalls} icon="leads" tone="new" />
      </div>
    </section>

    {meetings.length ? <section className="panel today-meetings">
      <div className="panel__header"><div><span className="eyebrow">Priority 1</span><h2>Meetings today</h2></div><Button variant="ghost" size="sm" onClick={() => onNavigate("meetings")}>View meetings</Button></div>
      <div className="today-meeting-list">{meetings.map((meeting) => {
        const lead = state.leads.find((item) => item.id === meeting.leadId);
        if (!lead) return null;
        return <button key={meeting.id} onClick={() => setDrawerLeadId(lead.id)}>
          <time>{formatDateTime(meeting.scheduledAt, { hour: "numeric", minute: "2-digit" })}</time>
          <span><strong>{lead.clinicName}</strong><small>{lead.decisionMakerName || "Decision maker not recorded"} · {meeting.meetingType}</small></span>
          <Badge tone="info">{meeting.durationMinutes} min</Badge><Icon name="chevronRight" size={16} />
        </button>;
      })}</div>
    </section> : null}

    <section className="panel today-queue">
      <div className="panel__header"><div><span className="eyebrow">Priorities 2–5</span><h2>Today’s call queue</h2><p>Scheduled work first, then enough new leads to fill the daily target.</p></div><Badge tone={plan.length ? "accent" : "success"} dot>{plan.length} remaining</Badge></div>
      {plan.length ? <div className="table-wrap"><table className="data-table today-table">
        <thead><tr><th>Priority</th><th>Clinic</th><th>Decision-maker</th><th>Phone</th><th>Stage</th><th>Attempt / touch</th><th>When</th><th>Tracking Technology</th><th>Quick actions</th></tr></thead>
        <tbody>{plan.map(({ lead, category, priority }) => {
          const phone = lead.directPhone || lead.mobilePhone;
          const overdue = category !== "new" && !!lead.nextAction && new Date(lead.nextAction.dueAt).getTime() < from;
          const workNext = lead.id === firstWorkableLeadId;
          return <tr key={lead.id} className={cn(overdue && "is-overdue")}>
            <td data-label="Priority"><span className={`queue-priority queue-priority--${priority}`}>P{priority}</span><small>{category === "follow_up" ? "Follow-up" : category === "callback" ? "Callback" : category === "retry" ? "Retry" : "New"}</small></td>
            <td data-label="Clinic"><button className="table-primary-link" onClick={() => setDrawerLeadId(lead.id)}>{lead.clinicName}</button><small>{[lead.city, lead.state].filter(Boolean).join(", ") || "Location not recorded"}</small></td>
            <td data-label="Decision-maker"><strong>{lead.decisionMakerName || "Not recorded"}</strong><small>{lead.decisionMakerRole || "Role not recorded"}</small></td>
            <td data-label="Phone"><button className="copy-value" onClick={() => void copy(phone, "Phone number")} disabled={!phone}><Icon name="copy" size={13} />{phone || "No number"}</button>{lead.mobilePhone && lead.mobilePhone !== phone ? <small>{lead.mobilePhone}</small> : null}</td>
            <td data-label="Stage"><Badge tone={STATUS_TONES[lead.status] as "info"} size="sm">{stageFor(lead)}</Badge><small>{STATUS_LABELS[lead.status]}</small></td>
            <td data-label="Attempt">{lead.pipelineStage === "post_meeting" ? <strong>Touch {lead.postMeetingTouchCount} / {state.settings.followUp.maximumPostMeetingTouches}</strong> : <strong>Attempt {lead.coldNoAnswerCount} / {state.settings.calling.maximumInitialAttempts}</strong>}</td>
            <td data-label="When"><strong className={cn(overdue && "text-danger")}>{category === "new" ? "Any time" : formatDateTime(lead.nextAction?.dueAt, { hour: "numeric", minute: "2-digit" })}</strong><small>{overdue ? "Overdue" : lead.nextAction?.exact ? "Scheduled" : "Due today"}</small></td>
            <td data-label="Tracking"><strong>{lead.trackingTechnologyFound || "Unknown"}</strong>{lead.primaryFinding ? <small>{lead.primaryFinding}</small> : null}</td>
            <td data-label="Actions"><div className="row-actions"><Button variant="ghost" size="sm" onClick={() => void copy(lead.websiteUrl, "Website")} disabled={!lead.websiteUrl}>Copy site</Button><Button variant={workNext ? "primary" : "secondary"} size="sm" onClick={workNext ? start : () => setDrawerLeadId(lead.id)}>{workNext ? "Work next" : "Open"}</Button></div></td>
          </tr>;
        })}</tbody>
      </table></div> : <EmptyState compact icon={<Icon name="checkCircle" size={26} />} title="Today is clear" description={completed >= target ? "You reached today’s calling target. Future scheduled work remains safely queued." : "No callable leads are due. Import more leads or review records missing a phone number."} action={completed < target ? <Button variant="primary" onClick={() => onNavigate("import")}>Import leads</Button> : undefined} />}
    </section>

    <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
  </>;
}

function SummaryCount({ label, value, icon, tone }: { label: string; value: number; icon: string; tone: string }) {
  return <div className={`today-count today-count--${tone}`}><span><Icon name={icon} size={17} /></span><div><strong>{value}</strong><small>{label}</small></div></div>;
}
