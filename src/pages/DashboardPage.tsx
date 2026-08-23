import { useMemo } from "react";
import { useCRM } from "../data/store";
import { computeAnalytics, getQueue, startSession } from "../domain/engine";
import type { CRMState } from "../types";
import { Icon } from "../components/Icon";
import { Badge, Button, EmptyState, MetricCard, PageHeader, Progress } from "../components/UI";
import { STATUS_LABELS, STATUS_TONES, type Route } from "../lib/constants";
import { formatDateTime, formatNumber, formatPercent } from "../lib/format";

interface DashboardPageProps {
  onNavigate: (route: Route) => void;
  onStartCalling: () => void;
}

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function dayKey(value: string | Date) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function buildDailySeries(state: CRMState) {
  return Array.from({ length: 7 }, (_, reverseIndex) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - reverseIndex));
    date.setHours(0, 0, 0, 0);
    const key = dayKey(date);
    const calls = state.callAttempts.filter((attempt) => !attempt.voidedAt && dayKey(attempt.occurredAt) === key);
    const meetings = state.meetings.filter((meeting) => !meeting.voidedAt && dayKey(meeting.createdAt) === key);
    return {
      label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
      calls: calls.length,
      conversations: calls.filter((call) => call.meaningfulConversation).length,
      meetings: meetings.length,
    };
  });
}

export function DashboardPage({ onNavigate, onStartCalling }: DashboardPageProps) {
  const { state, commit } = useCRM();
  const analytics = useMemo(() => computeAnalytics(state), [state]);
  const queue = useMemo(() => getQueue(state), [state]);
  const from = todayStart().getTime();
  const todayCalls = state.callAttempts.filter((attempt) => !attempt.voidedAt && new Date(attempt.occurredAt).getTime() >= from);
  const todayMeetings = state.meetings.filter((meeting) => meeting.status === "booked" && new Date(meeting.scheduledAt).toDateString() === new Date().toDateString());
  const todayWins = state.leads.filter((lead) => lead.status === "won" && new Date(lead.updatedAt).getTime() >= from).length;
  const todayCallbacks = todayCalls.filter((call) => call.outcome === "callback" || call.outcome === "requested_callback").length;
  const todayMeetingsBooked = state.meetings.filter((meeting) => new Date(meeting.createdAt).getTime() >= from).length;
  const dailySeries = useMemo(() => buildDailySeries(state), [state]);
  const seriesMax = Math.max(1, ...dailySeries.map((day) => day.calls));
  const activeSession = [...state.sessions].reverse().find((session) => !session.endedAt);
  const nowDate = new Date();
  const greeting = nowDate.getHours() < 12 ? "Good morning" : nowDate.getHours() < 18 ? "Good afternoon" : "Good evening";
  const operationsDay = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(nowDate);

  const pipeline = [
    { label: "New", count: state.leads.filter((lead) => lead.status === "new").length, tone: "neutral" },
    { label: "Active calls", count: state.leads.filter((lead) => ["retry_scheduled", "callback", "interested", "conversation_follow_up", "extended_retry"].includes(lead.status)).length, tone: "info" },
    { label: "Meetings", count: state.leads.filter((lead) => ["meeting_booked", "second_meeting_booked"].includes(lead.status)).length, tone: "info" },
    { label: "Decision", count: state.leads.filter((lead) => ["decision_pending", "proposal_sent", "post_meeting_follow_up"].includes(lead.status)).length, tone: "purple" },
    { label: "Won", count: state.leads.filter((lead) => lead.status === "won").length, tone: "success" },
    { label: "Lost", count: state.leads.filter((lead) => lead.status === "lost").length, tone: "neutral" },
  ];

  const start = () => {
    if (!activeSession) commit("Session started", (current) => startSession(current), "Calling session started");
    onStartCalling();
  };

  if (!state.leads.length) {
    return (
      <>
        <PageHeader
          eyebrow={`${operationsDay} operations`}
          title={`${greeting}, Operator`}
          description="Relay is ready for your first lead list. Import leads once, then let the queue organize every next action."
          actions={<Button variant="primary" size="lg" onClick={() => onNavigate("import")} startIcon={<Icon name="plus" size={17} />}>Import your first leads</Button>}
        />
        <section className="panel dashboard-empty-state">
          <EmptyState
            icon={<Icon name="leads" size={28} />}
            title="No leads yet"
            description="Import a CSV or XLSX file to create your workspace. Your data stays on this computer and Relay will build the calling queue automatically."
            action={<><Button variant="primary" onClick={() => onNavigate("import")}>Import lead list</Button><Button variant="secondary" onClick={() => onNavigate("settings")}>Review settings</Button></>}
          />
          <div className="empty-onboarding-grid" aria-label="Getting started">
            <div><span>1</span><strong>Import</strong><small>Add your prepared lead list.</small></div>
            <div><span>2</span><strong>Review</strong><small>Confirm calling hours and retry rules.</small></div>
            <div><span>3</span><strong>Start calling</strong><small>Relay serves the next best lead.</small></div>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={`${operationsDay} operations`}
        title={`${greeting}, Operator`}
        description="Your calling day is organized. Start with the highest-value work below."
        actions={<Button variant="primary" size="lg" onClick={start} startIcon={<Icon name="play" size={17} />}>{activeSession ? "Resume calling" : "Start calling"}</Button>}
      />

      <section className="goal-banner">
        <div className="goal-banner__copy">
          <span className="goal-banner__icon"><Icon name="target" size={20} /></span>
          <div><span className="eyebrow">Daily call goal</span><strong>{todayCalls.length} <small>/ {state.settings.calling.dailyCallGoal} calls</small></strong></div>
        </div>
        <Progress value={todayCalls.length} max={state.settings.calling.dailyCallGoal} showValue valueLabel={`${Math.max(0, state.settings.calling.dailyCallGoal - todayCalls.length)} remaining`} size="lg" />
        <div className="goal-banner__stats">
          <span><strong>{todayCalls.filter((call) => call.meaningfulConversation).length}</strong> conversations</span>
          <span><strong>{todayMeetingsBooked}</strong> meetings</span>
          <span><strong>{todayCallbacks}</strong> callbacks</span>
        </div>
      </section>

      <section className="metric-grid metric-grid--five" aria-label="Today's metrics">
        <MetricCard label="Calls made" value={todayCalls.length} icon={<Icon name="phone" size={18} />} hint="Today" tone="accent" />
        <MetricCard label="Conversations" value={todayCalls.filter((call) => call.meaningfulConversation).length} icon={<Icon name="activity" size={18} />} hint={formatPercent(todayCalls.length ? todayCalls.filter((call) => call.meaningfulConversation).length / todayCalls.length * 100 : 0)} />
        <MetricCard label="Callbacks" value={todayCallbacks} icon={<Icon name="callback" size={18} />} hint="Scheduled today" />
        <MetricCard label="Meetings booked" value={todayMeetingsBooked} icon={<Icon name="calendar" size={18} />} hint={`${todayMeetings.length} on calendar today`} />
        <MetricCard label="Clients won" value={todayWins} icon={<Icon name="won" size={18} />} hint="Today" tone="success" />
      </section>

      <div className="dashboard-grid dashboard-grid--primary">
        <section className="panel next-work-panel">
          <div className="panel__header"><div><span className="eyebrow">Priority desk</span><h2>Next work</h2></div><Badge tone={queue.length ? "accent" : "neutral"} dot>{queue.length} ready now</Badge></div>
          <div className="work-list">
            {[
              { key: "exact_callback", label: "Exact callbacks", icon: "callback", route: "callbacks" as Route },
              { key: "post_meeting_follow_up", label: "Post-meeting follow-ups", icon: "followUp", route: "follow-ups" as Route },
              { key: "interested_follow_up", label: "Interested follow-ups", icon: "activity", route: "follow-ups" as Route },
              { key: "cold_retry", label: "Cold retries", icon: "recycle", route: "queue" as Route },
              { key: "new_cold", label: "New leads", icon: "leads", route: "leads" as Route },
            ].map((item) => {
              const matches = queue.filter((candidate) => candidate.action.queueClass === item.key);
              return (
                <button className="work-list__item" key={item.key} onClick={() => onNavigate(item.route)}>
                  <span className="work-list__icon"><Icon name={item.icon} size={18} /></span>
                  <span><strong>{item.label}</strong><small>{matches[0]?.lead.clinicName ?? "Nothing due"}</small></span>
                  <b>{matches.length}</b><Icon name="chevronRight" size={16} />
                </button>
              );
            })}
          </div>
          <Button variant="primary" fullWidth onClick={start} disabled={!queue.length} startIcon={<Icon name="phone" size={17} />}>
            {queue.length ? `Call next — ${queue[0].lead.clinicName}` : "No calls eligible right now"}
          </Button>
        </section>

        <section className="panel pipeline-panel">
          <div className="panel__header"><div><span className="eyebrow">All-time</span><h2>Pipeline health</h2></div><Button variant="ghost" size="sm" onClick={() => onNavigate("analytics")}>View analytics <Icon name="arrowRight" size={14} /></Button></div>
          <div className="pipeline-stack">
            {pipeline.map((item) => (
              <div className="pipeline-row" key={item.label}>
                <span className={`pipeline-row__dot is-${item.tone}`} />
                <span>{item.label}</span><strong>{formatNumber(item.count)}</strong>
                <div className="pipeline-row__bar"><i style={{ width: `${Math.max(4, item.count / Math.max(1, state.leads.length) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="pipeline-footer"><span><Icon name="recycle" size={15} /> {state.leads.filter((lead) => lead.status === "recycle_later").length} in recycle</span><span><Icon name="followUp" size={15} /> {state.leads.filter((lead) => lead.pipelineStage === "post_meeting" && !["won", "lost"].includes(lead.status)).length} warm opportunities</span></div>
        </section>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <section className="panel chart-panel">
          <div className="panel__header"><div><span className="eyebrow">Last 7 days</span><h2>Calling momentum</h2></div><div className="chart-legend"><span className="is-calls">Calls</span><span className="is-conversations">Conversations</span></div></div>
          <div className="bar-chart" aria-label="Calls and conversations over seven days">
            {dailySeries.map((day) => (
              <div className="bar-chart__day" key={day.label}>
                <div className="bar-chart__bars">
                  <i className="is-calls" style={{ height: `${day.calls / seriesMax * 100}%` }} title={`${day.calls} calls`} />
                  <i className="is-conversations" style={{ height: `${day.conversations / seriesMax * 100}%` }} title={`${day.conversations} conversations`} />
                </div>
                <strong>{day.calls}</strong><span>{day.label}</span>
              </div>
            ))}
          </div>
          <div className="chart-summary">
            <span><strong>{formatNumber(analytics.totalDials)}</strong> all-time dials</span>
            <span><strong>{formatPercent(analytics.answerRate)}</strong> answer rate</span>
            <span><strong>{formatPercent(analytics.dialToMeetingRate)}</strong> dial → meeting</span>
          </div>
        </section>

        <section className="panel activity-panel">
          <div className="panel__header"><div><span className="eyebrow">Live log</span><h2>Recent activity</h2></div><Icon name="activity" size={18} /></div>
          <div className="activity-list activity-list--compact">
            {[...state.activities].filter((activity) => !activity.voidedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 6).map((activity) => {
              const lead = activity.leadId ? state.leads.find((item) => item.id === activity.leadId) : null;
              return (
                <div className="activity-item" key={activity.id}>
                  <span className="activity-item__icon"><Icon name={activity.type.includes("meeting") ? "calendar" : activity.type.includes("call") ? "phone" : "activity"} size={15} /></span>
                  <div><strong>{activity.title}</strong><small>{lead?.clinicName ?? activity.note}</small></div>
                  <time>{formatDateTime(activity.occurredAt, { hour: "numeric", minute: "2-digit" })}</time>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {todayMeetings.length ? (
        <section className="panel meetings-strip">
          <div className="panel__header"><div><span className="eyebrow">Calendar</span><h2>Meetings today</h2></div><Button variant="ghost" size="sm" onClick={() => onNavigate("meetings")}>See all</Button></div>
          <div className="meeting-mini-grid">
            {todayMeetings.slice(0, 3).map((meeting) => {
              const lead = state.leads.find((item) => item.id === meeting.leadId);
              return <button key={meeting.id} onClick={() => onNavigate("meetings")}><time>{formatDateTime(meeting.scheduledAt, { hour: "numeric", minute: "2-digit" })}</time><span><strong>{lead?.clinicName}</strong><small>{lead?.decisionMakerName} · {meeting.meetingType}</small></span><Badge tone={STATUS_TONES[lead?.status ?? "new"] as "info"}>{lead ? STATUS_LABELS[lead.status] : "Booked"}</Badge></button>;
            })}
          </div>
        </section>
      ) : null}
    </>
  );
}
