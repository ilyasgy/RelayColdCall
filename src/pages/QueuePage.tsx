import { useMemo } from "react";
import { Icon } from "../components/Icon";
import { Badge, Button, EmptyState, PageHeader } from "../components/UI";
import { useCRM } from "../data/store";
import { getQueue, startSession } from "../domain/engine";
import { formatDateTime, formatLocalTime, relativeTime } from "../lib/format";

interface QueuePageProps {
  onStartCalling: () => void;
}

const classInfo: Record<string, { label: string; description: string; icon: string; tone: "danger" | "warning" | "purple" | "info" | "neutral" }> = {
  exact_callback: { label: "Exact callbacks", description: "Prospect-requested times, including overdue callbacks", icon: "callback", tone: "warning" },
  post_meeting_follow_up: { label: "Post-meeting", description: "Warm opportunities due for the five-touch sequence", icon: "followUp", tone: "purple" },
  interested_follow_up: { label: "Interested follow-ups", description: "Engaged prospects expecting another conversation", icon: "activity", tone: "info" },
  cold_retry: { label: "Cold retries", description: "Retry windows that are due now", icon: "recycle", tone: "neutral" },
  new_cold: { label: "New cold leads", description: "Qualified leads not yet contacted", icon: "leads", tone: "neutral" },
  recycled: { label: "Recycled leads", description: "Prior cycles that are eligible again", icon: "history", tone: "neutral" },
};

export function QueuePage({ onStartCalling }: QueuePageProps) {
  const { state, commit } = useCRM();
  const queue = useMemo(() => getQueue(state), [state]);
  const activeSession = [...state.sessions].reverse().find((session) => !session.endedAt);
  const now = Date.now();
  const counts = Object.keys(classInfo).map((key) => ({
    key,
    ...classInfo[key],
    items: queue.filter((candidate) => candidate.action.queueClass === key),
  }));
  const excluded = {
    outsideHours: state.leads.filter((lead) => lead.nextAction?.queueEligible && lead.nextAction.dueAt <= new Date().toISOString() && !queue.some((candidate) => candidate.lead.id === lead.id)).length,
    future: state.leads.filter((lead) => lead.nextAction?.queueEligible && new Date(lead.nextAction.dueAt).getTime() > now).length,
    dnc: state.leads.filter((lead) => lead.doNotCall).length,
    contact: state.leads.filter((lead) => lead.status === "contact_data_required").length,
  };

  const start = () => {
    if (!activeSession) commit("Session started", (current) => startSession(current), "Calling session started");
    onStartCalling();
  };

  return (
    <>
      <PageHeader
        eyebrow="Queue engine"
        title="Call Queue"
        description="The queue is ranked automatically. Callbacks and warm opportunities always rise above cold work."
        actions={<Button variant="primary" size="lg" onClick={start} disabled={!queue.length} startIcon={<Icon name="play" size={17} />}>{activeSession ? "Resume calling" : "Start calling"}</Button>}
      />

      <section className="queue-hero panel">
        <div className="queue-hero__status">
          <span className="queue-pulse"><i /></span>
          <div><span className="eyebrow">Ready now</span><strong>{queue.length}</strong><small>eligible calls in prospect-local hours</small></div>
        </div>
        {queue[0] ? (
          <div className="queue-hero__next">
            <span className="eyebrow">Next call</span>
            <div><span className="lead-avatar">{queue[0].lead.clinicName.slice(0, 2).toUpperCase()}</span><span><strong>{queue[0].lead.clinicName}</strong><small>{queue[0].lead.decisionMakerName} · {queue[0].rankReason.slice(0, 2).join(" · ")}</small></span></div>
          </div>
        ) : <div className="queue-hero__next"><span className="eyebrow">Next eligibility</span><strong>{excluded.future} calls scheduled later</strong><small>Future work will enter automatically.</small></div>}
        <Button variant="primary" size="lg" onClick={start} disabled={!queue.length} startIcon={<Icon name="phone" size={18} />}>{queue.length ? "Start with next lead" : "Queue is clear"}</Button>
      </section>

      <div className="queue-grid">
        <section className="panel queue-breakdown">
          <div className="panel__header"><div><span className="eyebrow">Ranked work</span><h2>What is in the queue</h2></div><Badge tone="success" dot>Live ranking</Badge></div>
          <div className="queue-class-list">
            {counts.map((group, index) => (
              <div className="queue-class" key={group.key}>
                <span className="queue-class__rank">{index + 1}</span>
                <span className={`queue-class__icon is-${group.tone}`}><Icon name={group.icon} size={18} /></span>
                <div><strong>{group.label}</strong><small>{group.description}</small></div>
                <strong className="queue-class__count">{group.items.length}</strong>
              </div>
            ))}
          </div>
        </section>

        <aside className="panel queue-preview">
          <div className="panel__header"><div><span className="eyebrow">Preview</span><h2>First in line</h2></div></div>
          {queue.length ? (
            <div className="queue-preview__list">
              {queue.slice(0, 6).map((candidate, index) => (
                <div className="queue-preview__item" key={candidate.lead.id}>
                  <span className="queue-preview__position">{index + 1}</span>
                  <div><strong>{candidate.lead.clinicName}</strong><small>{candidate.lead.city}, {candidate.lead.state} · {formatLocalTime(candidate.lead.timeZone)}</small></div>
                  <div className="queue-preview__reason"><Badge tone={candidate.action.exact ? "warning" : candidate.action.queueClass === "post_meeting_follow_up" ? "purple" : "neutral"} size="sm">{classInfo[candidate.action.queueClass]?.label ?? "Call"}</Badge><small>{relativeTime(candidate.action.dueAt)}</small></div>
                </div>
              ))}
            </div>
          ) : <EmptyState compact icon={<Icon name="checkCircle" size={25} />} title="Nothing is call-ready" description="Future work, local calling windows, and callbacks are still being watched." />}
        </aside>
      </div>

      <section className="panel queue-eligibility">
        <div className="panel__header"><div><span className="eyebrow">Guardrails</span><h2>Waiting or excluded</h2></div><small>Updated {formatDateTime(new Date(), { hour: "numeric", minute: "2-digit" })}</small></div>
        <div className="eligibility-grid">
          <div><span className="is-info"><Icon name="clock" size={18} /></span><strong>{excluded.outsideHours}</strong><small>Outside local calling hours</small></div>
          <div><span className="is-neutral"><Icon name="calendarClock" size={18} /></span><strong>{excluded.future}</strong><small>Scheduled for later</small></div>
          <div><span className="is-danger"><Icon name="lock" size={18} /></span><strong>{excluded.dnc}</strong><small>Do Not Call protected</small></div>
          <div><span className="is-warning"><Icon name="badNumber" size={18} /></span><strong>{excluded.contact}</strong><small>Need contact correction</small></div>
        </div>
      </section>
    </>
  );
}
