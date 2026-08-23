import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { LeadDrawer } from "../components/LeadDrawer";
import { Badge, Button, EmptyState, Modal, PageHeader } from "../components/UI";
import { useCRM } from "../data/store";
import { completeMeeting } from "../domain/engine";
import { downloadExport } from "../domain/files";
import { LOST_REASONS, MEETING_OUTCOME_LABELS } from "../lib/constants";
import { cn, formatDateTime, phoneHref, toLocalInputValue } from "../lib/format";
import type { Meeting, MeetingOutcome } from "../types";

type MeetingTab = "today" | "upcoming" | "completed" | "follow_up" | "won" | "lost";

export function MeetingsPage() {
  const { state, commit, notify } = useCRM();
  const [tab, setTab] = useState<MeetingTab>("today");
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const today = new Date().toDateString();
  const groups = useMemo(() => ({
    today: state.meetings.filter((meeting) => meeting.status === "booked" && new Date(meeting.scheduledAt).toDateString() === today),
    upcoming: state.meetings.filter((meeting) => meeting.status === "booked" && new Date(meeting.scheduledAt).getTime() > Date.now() && new Date(meeting.scheduledAt).toDateString() !== today),
    completed: state.meetings.filter((meeting) => meeting.status === "completed"),
    follow_up: state.meetings.filter((meeting) => meeting.status === "completed" && meeting.outcome && !["won", "lost"].includes(meeting.outcome)),
    won: state.meetings.filter((meeting) => meeting.status === "completed" && meeting.outcome === "won"),
    lost: state.meetings.filter((meeting) => meeting.status === "completed" && meeting.outcome === "lost"),
  }), [state.meetings, today]);
  const meetings = groups[tab].sort((a, b) => tab === "completed" ? b.scheduledAt.localeCompare(a.scheduledAt) : a.scheduledAt.localeCompare(b.scheduledAt));

  return <>
    <PageHeader eyebrow="Meeting pipeline" title="Meetings" description="Booked meetings stay visible until a required sales outcome moves the opportunity forward." actions={<Button variant="secondary" onClick={() => void downloadExport({ kind: "meetings", format: "xlsx", state }).then((fileName) => notify(`${fileName} downloaded`, "success")).catch(() => notify("Meeting export failed", "danger"))} startIcon={<Icon name="download" size={16} />}>Export meetings</Button>} />
    <section className="panel meetings-panel">
      <div className="collection-toolbar"><div className="tabs tabs--wrap">{(["today", "upcoming", "completed", "follow_up", "won", "lost"] as MeetingTab[]).map((item) => <button key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item === "follow_up" ? "Follow-up required" : item[0].toUpperCase() + item.slice(1)} <span>{groups[item].length}</span></button>)}</div></div>
      {meetings.length ? <div className="meeting-card-grid">{meetings.map((meeting) => {
        const lead = state.leads.find((item) => item.id === meeting.leadId);
        if (!lead) return null;
        return <article className="meeting-card" key={meeting.id}><div className="meeting-card__time"><span><strong>{formatDateTime(meeting.scheduledAt, { month: "short", day: "numeric" })}</strong><small>{formatDateTime(meeting.scheduledAt, { hour: "numeric", minute: "2-digit" })}</small></span><Badge tone={meeting.status === "completed" ? meeting.outcome === "won" ? "success" : meeting.outcome === "lost" ? "neutral" : "purple" : "info"} dot>{meeting.status === "completed" ? MEETING_OUTCOME_LABELS[meeting.outcome!] : meeting.status}</Badge></div><div className="meeting-card__identity"><span className="lead-avatar">{lead.clinicName.slice(0, 2).toUpperCase()}</span><div><h3>{lead.clinicName}</h3><p>{lead.decisionMakerName} · {lead.decisionMakerRole}</p></div></div><div className="meeting-card__context"><div><small>Primary finding</small><strong>{lead.primaryFinding || "No finding recorded"}</strong></div><div><small>Original call notes</small><p>{lead.lastConversationNotes || "No prior notes"}</p></div>{meeting.notes ? <div><small>Meeting notes</small><p>{meeting.notes}</p></div> : null}</div><div className="meeting-card__contact"><a href={phoneHref(lead.directPhone || lead.mobilePhone)}><Icon name="phone" size={14} /> {lead.directPhone || lead.mobilePhone}</a><a href={lead.email ? `mailto:${lead.email}` : undefined}><Icon name="mail" size={14} /> {lead.email || "No email"}</a><span><Icon name="timer" size={14} /> {meeting.durationMinutes} min · {meeting.meetingType}</span></div><footer><Button variant="ghost" size="sm" onClick={() => setDrawerLeadId(lead.id)}>View lead</Button>{meeting.status === "booked" ? <Button variant="primary" size="sm" onClick={() => setCompletingId(meeting.id)} startIcon={<Icon name="checkCircle" size={15} />}>Mark completed</Button> : meeting.outcome && !["won", "lost"].includes(meeting.outcome) ? <Badge tone="purple">Touches {lead.postMeetingTouchCount} / {state.settings.followUp.maximumPostMeetingTouches}</Badge> : null}</footer></article>;
      })}</div> : <EmptyState icon={<Icon name="calendar" size={28} />} title={tab === "today" ? "No meetings today" : tab === "follow_up" ? "No meetings need follow-up" : `No ${tab.replace("_", " ")} meetings`} description={tab === "today" ? "Meetings scheduled for today appear here with the full calling context." : "Meeting records move here automatically as their status changes."} />}
    </section>
    <CompleteMeetingModal meeting={state.meetings.find((meeting) => meeting.id === completingId) ?? null} onClose={() => setCompletingId(null)} onSubmit={(meeting, input) => { commit("Meeting completed", (current) => completeMeeting(current, meeting.id, input), input.outcome === "won" ? "Client won" : input.outcome === "lost" ? "Meeting closed as lost" : "Post-meeting follow-up started"); setCompletingId(null); }} />
    <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
  </>;
}

function CompleteMeetingModal({ meeting, onClose, onSubmit }: { meeting: Meeting | null; onClose: () => void; onSubmit: (meeting: Meeting, input: { outcome: MeetingOutcome; note?: string; nextAt?: string; secondMeetingAt?: string; secondMeetingType?: string; lostReason?: string; interestSummary?: string; mainObjection?: string; decisionStatus?: string }) => void }) {
  const [outcome, setOutcome] = useState<MeetingOutcome | "">("");
  const [note, setNote] = useState("");
  const [interest, setInterest] = useState("");
  const [objection, setObjection] = useState("");
  const [decision, setDecision] = useState("");
  const [nextAt, setNextAt] = useState(() => { const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(10, 0, 0, 0); return toLocalInputValue(date); });
  const [lostReason, setLostReason] = useState("");
  if (!meeting) return null;
  const needsNext = outcome && !["won", "lost"].includes(outcome);
  return <Modal open onClose={onClose} title="Complete meeting" description="A completed meeting must have a disposition. No-decision outcomes start the post-meeting sequence automatically." size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={outcome === "won" ? "success" : outcome === "lost" ? "secondary" : "primary"} disabled={!outcome || (!!needsNext && !nextAt)} onClick={() => onSubmit(meeting, { outcome: outcome as MeetingOutcome, note, nextAt: needsNext ? new Date(nextAt).toISOString() : undefined, secondMeetingAt: outcome === "second_meeting_needed" ? new Date(nextAt).toISOString() : undefined, secondMeetingType: "Video call", lostReason, interestSummary: interest, mainObjection: objection, decisionStatus: decision || MEETING_OUTCOME_LABELS[outcome as MeetingOutcome] })}>Complete & continue</Button></>}>
    <div className="meeting-outcome-form"><span className="field-label">Required outcome</span><div className="outcome-choice-grid">{(Object.keys(MEETING_OUTCOME_LABELS) as MeetingOutcome[]).map((value) => <button key={value} className={cn(outcome === value && "is-selected", value === "won" && "is-success", value === "lost" && "is-danger")} onClick={() => setOutcome(value)}><Icon name={value === "won" ? "won" : value === "lost" ? "lost" : value === "second_meeting_needed" ? "calendar" : value === "proposal_sent" ? "file" : "followUp"} size={18} /><span>{MEETING_OUTCOME_LABELS[value]}</span><i /></button>)}</div><div className="form-grid"><label className="field"><span>What interested them?</span><input value={interest} onChange={(event) => setInterest(event.target.value)} placeholder="Compliance, patient privacy…" /></label><label className="field"><span>Main objection</span><input value={objection} onChange={(event) => setObjection(event.target.value)} placeholder="Budget, approval, timing…" /></label><label className="field"><span>Decision status</span><input value={decision} onChange={(event) => setDecision(event.target.value)} placeholder="Owner reviewing proposal" /></label>{needsNext ? <label className="field"><span>{outcome === "second_meeting_needed" ? "Second meeting date" : "First follow-up date"}</span><input type="datetime-local" value={nextAt} onChange={(event) => setNextAt(event.target.value)} /></label> : null}{outcome === "lost" ? <label className="field"><span>Lost reason</span><select value={lostReason} onChange={(event) => setLostReason(event.target.value)}><option value="">No reason selected</option>{LOST_REASONS.map((reason) => <option key={reason}>{reason}</option>)}</select></label> : null}<label className="field field--full"><span>Meeting notes</span><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Decision process, stakeholders, requested materials…" /></label></div></div>
  </Modal>;
}
