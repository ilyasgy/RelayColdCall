import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { Badge, Button, EmptyState, MetricCard, PageHeader } from "../components/UI";
import { useCRM } from "../data/store";
import { computeAnalytics } from "../domain/engine";
import { downloadExport } from "../domain/files";
import { formatNumber, formatPercent } from "../lib/format";
import type { AnalyticsDimensionRow } from "../types";

export function AnalyticsPage() {
  const { state, notify } = useCRM();
  const [range, setRange] = useState("all");
  const [batch, setBatch] = useState("all");
  const from = useMemo(() => {
    if (range === "all") return undefined;
    const date = new Date();
    date.setDate(date.getDate() - Number(range));
    return date.toISOString();
  }, [range]);
  const analytics = useMemo(() => computeAnalytics(state, { from, batchId: batch === "all" ? undefined : batch }), [batch, from, state]);
  const funnel = [
    { label: "Imported leads", value: batch === "all" ? state.leads.length : state.leads.filter((lead) => lead.batchId === batch).length, tone: "neutral" },
    { label: "Called", value: analytics.uniqueLeadsCalled, tone: "info" },
    { label: "Conversations", value: analytics.realConversations, tone: "purple" },
    { label: "Meetings", value: analytics.meetingsBooked, tone: "warning" },
    { label: "Clients", value: analytics.clientsWon, tone: "success" },
  ];
  const funnelMax = Math.max(1, funnel[0].value);
  const lostRows = Object.entries(state.leads.filter((lead) => lead.status === "lost" && (batch === "all" || lead.batchId === batch)).reduce<Record<string, number>>((acc, lead) => { const reason = lead.lostReason || "Not recorded"; acc[reason] = (acc[reason] ?? 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]);

  if (!state.callAttempts.some((attempt) => !attempt.voidedAt) && !state.meetings.some((meeting) => !meeting.voidedAt)) {
    return <>
      <PageHeader eyebrow="Evidence from stored activity" title="Analytics" description="All rates are recalculated from stored call attempts, meetings, and outcomes — never manually entered totals." />
      <section className="panel analytics-empty"><EmptyState icon={<Icon name="analytics" size={26} />} title="No calling activity yet" description="Analytics will appear automatically after you begin recording calls and meetings. Nothing needs to be entered twice." /></section>
    </>;
  }

  return <>
    <PageHeader eyebrow="Evidence from stored activity" title="Analytics" description="All rates are recalculated from immutable call attempts, meetings, and outcomes — never manually entered totals." actions={<Button variant="secondary" onClick={() => void downloadExport({ kind: "analytics", format: "xlsx", state, analytics }).then((fileName) => notify(`${fileName} downloaded`, "success")).catch(() => notify("Analytics export failed", "danger"))} startIcon={<Icon name="download" size={16} />}>Export analytics</Button>} />
    <section className="analytics-filters panel"><div><Icon name="filter" size={16} /><strong>Analysis scope</strong></div><label><span>Period</span><select value={range} onChange={(event) => setRange(event.target.value)}><option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label><label><span>Batch / source</span><select value={batch} onChange={(event) => setBatch(event.target.value)}><option value="all">All batches</option>{state.batches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Badge tone="success" dot>Live stored data</Badge></section>
    <section className="metric-grid metric-grid--five"><MetricCard label="Total dials" value={formatNumber(analytics.totalDials)} icon={<Icon name="phone" size={18} />} tone="accent" /><MetricCard label="Answer rate" value={formatPercent(analytics.answerRate)} icon={<Icon name="phoneIncoming" size={18} />} hint={`${analytics.answeredCalls} answered`} /><MetricCard label="Conversation rate" value={formatPercent(analytics.conversationRate)} icon={<Icon name="activity" size={18} />} hint={`${analytics.realConversations} meaningful`} /><MetricCard label="Dial → meeting" value={formatPercent(analytics.dialToMeetingRate)} icon={<Icon name="calendar" size={18} />} hint={`${analytics.meetingsBooked} booked`} /><MetricCard label="Meeting → client" value={formatPercent(analytics.meetingToClientRate)} icon={<Icon name="won" size={18} />} hint={`${analytics.clientsWon} clients`} tone="success" /></section>
    <div className="dashboard-grid dashboard-grid--primary analytics-primary">
      <section className="panel funnel-panel"><div className="panel__header"><div><span className="eyebrow">Conversion</span><h2>Lead-to-client funnel</h2></div><Badge>{formatPercent(analytics.leadToClientRate)} overall</Badge></div><div className="conversion-funnel">{funnel.map((item, index) => <div key={item.label}><span>{item.label}</span><div className={`is-${item.tone}`} style={{ width: `${Math.max(12, item.value / funnelMax * 100)}%` }}><strong>{item.value}</strong></div>{index < funnel.length - 1 ? <small>{item.value ? formatPercent(funnel[index + 1].value / item.value * 100) : "0.0%"} to next</small> : null}</div>)}</div></section>
      <section className="panel performance-summary"><div className="panel__header"><div><span className="eyebrow">Conversion matrix</span><h2>Performance rates</h2></div></div><div className="rate-grid"><div><span>Answer rate</span><strong>{formatPercent(analytics.answerRate)}</strong></div><div><span>Conversation rate</span><strong>{formatPercent(analytics.conversationRate)}</strong></div><div><span>Conversation → meeting</span><strong>{formatPercent(analytics.conversationToMeetingRate)}</strong></div><div><span>Meeting show rate</span><strong>{formatPercent(analytics.meetingShowRate)}</strong></div><div><span>Dial → client</span><strong>{formatPercent(analytics.dialToClientRate)}</strong></div><div><span>Lead → client</span><strong>{formatPercent(analytics.leadToClientRate)}</strong></div><div><span>Avg attempts before conversation</span><strong>{analytics.averageAttemptsBeforeConversation.toFixed(1)}</strong></div><div><span>Avg attempts before meeting</span><strong>{analytics.averageAttemptsBeforeMeeting.toFixed(1)}</strong></div></div></section>
    </div>
    <section className="panel attempt-performance"><div className="panel__header"><div><span className="eyebrow">Cold calls only</span><h2>Attempt performance</h2></div><small>Post-meeting touches are deliberately excluded</small></div><div className="attempt-bars">{[1,2,3,4,5].map((attemptNumber) => { const row = analytics.byAttempt.find((item) => item.attempt === attemptNumber) ?? { attempt: attemptNumber, dials: 0, answered: 0, conversations: 0, connectionRate: 0 }; return <div key={attemptNumber}><div><span>Attempt {attemptNumber}</span><strong>{formatPercent(row.connectionRate)}</strong></div><div className="attempt-bars__track"><i style={{ width: `${row.connectionRate}%` }} /></div><small>{row.answered} answered / {row.dials} dials · {row.conversations} conversations</small></div>; })}</div></section>
    <div className="analytics-table-grid">
      <DimensionTable title="Finding performance" eyebrow="Pitch intelligence" rows={analytics.byFinding} keyLabel="Finding" />
      <DimensionTable title="Contact performance" eyebrow="Owner vs manager" rows={analytics.byContactType} keyLabel="Contact type" />
    </div>
    <div className="analytics-table-grid">
      <section className="panel analytics-table-card"><div className="panel__header"><div><span className="eyebrow">Call metrics</span><h2>Volume details</h2></div></div><div className="rate-grid rate-grid--compact"><div><span>Unique leads called</span><strong>{analytics.uniqueLeadsCalled}</strong></div><div><span>Answered calls</span><strong>{analytics.answeredCalls}</strong></div><div><span>No answers</span><strong>{analytics.noAnswers}</strong></div><div><span>Bad numbers</span><strong>{analytics.badNumbers}</strong></div><div><span>Callbacks</span><strong>{analytics.callbacks}</strong></div><div><span>Meetings held</span><strong>{analytics.meetingsHeld}</strong></div></div></section>
      <section className="panel analytics-table-card"><div className="panel__header"><div><span className="eyebrow">Loss intelligence</span><h2>Lost reasons</h2></div></div>{lostRows.length ? <div className="horizontal-bars horizontal-bars--compact">{lostRows.slice(0, 6).map(([reason, count]) => <div key={reason}><span>{reason}</span><div><i style={{ width: `${count / Math.max(...lostRows.map(([, item]) => item)) * 100}%` }} /></div><strong>{count}</strong></div>)}</div> : <p className="muted">No lost-reason data in this scope.</p>}</section>
    </div>
  </>;
}

function DimensionTable({ title, eyebrow, rows, keyLabel }: { title: string; eyebrow: string; rows: AnalyticsDimensionRow[]; keyLabel: string }) {
  return <section className="panel analytics-table-card"><div className="panel__header"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></div><div className="table-wrap"><table className="data-table data-table--analytics"><thead><tr><th>{keyLabel}</th><th>Dials</th><th>Answer</th><th>Meetings</th><th>Meeting rate</th><th>Clients</th><th>Client rate</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.key}><td><strong>{row.key.replaceAll("_", " ")}</strong></td><td>{row.dials}</td><td>{formatPercent(row.answerRate)}</td><td>{row.meetings}</td><td>{formatPercent(row.meetingRate)}</td><td>{row.clients}</td><td>{formatPercent(row.clientRate)}</td></tr>) : <tr><td colSpan={7} className="empty-cell">No activity in this scope</td></tr>}</tbody></table></div></section>;
}
