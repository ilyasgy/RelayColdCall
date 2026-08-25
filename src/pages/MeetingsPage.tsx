import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { LeadDrawer } from "../components/LeadDrawer";
import { Badge, Button, EmptyState, Modal, PageHeader } from "../components/UI";
import { useCRM } from "../data/store";
import { completeMeeting, updateMeetingStatus } from "../domain/engine";
import { downloadExport } from "../domain/files";
import { LOST_REASONS } from "../lib/constants";
import { cn, formatDateTime, toLocalInputValue } from "../lib/format";
import type { Meeting, MeetingOutcome } from "../types";

type MeetingView = "today" | "upcoming" | "past" | "reschedule" | "no_show" | "completed";

function beginningOfToday() { const date = new Date(); date.setHours(0, 0, 0, 0); return date; }
function endOfToday() { const date = new Date(); date.setHours(23, 59, 59, 999); return date; }

export function MeetingsPage() {
  const { state, commit, notify } = useCRM();
  const [view, setView] = useState<MeetingView>("today");
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const from = beginningOfToday().getTime();
  const through = endOfToday().getTime();

  const groups = useMemo(() => ({
    today: state.meetings.filter((meeting) => !meeting.voidedAt && meeting.status === "booked" && new Date(meeting.scheduledAt).getTime() >= from && new Date(meeting.scheduledAt).getTime() <= through),
    upcoming: state.meetings.filter((meeting) => !meeting.voidedAt && meeting.status === "booked" && new Date(meeting.scheduledAt).getTime() > through),
    past: state.meetings.filter((meeting) => !meeting.voidedAt && meeting.status === "booked" && new Date(meeting.scheduledAt).getTime() < from),
    reschedule: state.meetings.filter((meeting) => !meeting.voidedAt && (meeting.status === "reschedule_needed" || meeting.status === "cancelled")),
    no_show: state.meetings.filter((meeting) => !meeting.voidedAt && meeting.status === "no_show"),
    completed: state.meetings.filter((meeting) => !meeting.voidedAt && meeting.status === "completed"),
  }), [from, state.meetings, through]);
  const meetings = [...groups[view]].sort((left, right) => view === "completed" || view === "past" ? right.scheduledAt.localeCompare(left.scheduledAt) : left.scheduledAt.localeCompare(right.scheduledAt));
  const tabs: Array<{ id: MeetingView; label: string }> = [
    { id: "today", label: "Today" }, { id: "upcoming", label: "Upcoming" }, { id: "past", label: "Past" },
    { id: "reschedule", label: "Reschedule Needed" }, { id: "no_show", label: "No Show" }, { id: "completed", label: "Completed" },
  ];

  return <>
    <PageHeader eyebrow="Scheduled conversations" title="Meetings" description="Upcoming and unresolved meetings stay visible until you record what happened." actions={<Button variant="secondary" onClick={() => void downloadExport({ kind: "meetings", format: "xlsx", state }).then((name) => notify(`${name} downloaded`, "success")).catch(() => notify("Meeting export failed", "danger"))} startIcon={<Icon name="download" size={16} />}>Export meetings</Button>} />
    <section className="panel meetings-panel meetings-panel--simple">
      <div className="collection-toolbar"><div className="filter-chips">{tabs.map((tab) => <button key={tab.id} className={view === tab.id ? "is-active" : ""} onClick={() => setView(tab.id)}>{tab.label}<span>{groups[tab.id].length}</span></button>)}</div></div>
      {meetings.length ? <div className="meeting-list">{meetings.map((meeting) => {
        const lead = state.leads.find((item) => item.id === meeting.leadId);
        if (!lead) return null;
        const overdue = meeting.status === "booked" && new Date(meeting.scheduledAt).getTime() < Date.now();
        return <article className={cn("meeting-row", overdue && "is-overdue")} key={meeting.id}>
          <div className="meeting-row__time"><strong>{formatDateTime(meeting.scheduledAt, { month: "short", day: "numeric" })}</strong><span>{formatDateTime(meeting.scheduledAt, { hour: "numeric", minute: "2-digit" })}</span></div>
          <div className="meeting-row__lead"><button className="table-primary-link" onClick={() => setDrawerLeadId(lead.id)}>{lead.clinicName}</button><small>{lead.decisionMakerName || "Decision maker not recorded"} · {lead.decisionMakerRole || "Role not recorded"}</small></div>
          <div><small>Meeting</small><strong>{meeting.meetingType}</strong><span>{meeting.durationMinutes} minutes</span></div>
          <div><small>Context</small><strong>{lead.primaryFinding || lead.trackingTechnologyFound || "No imported technical context"}</strong><span>{meeting.notes || lead.lastConversationNotes || "No notes"}</span></div>
          <Badge tone={meeting.status === "completed" ? meeting.outcome === "won" ? "success" : meeting.outcome === "lost" ? "neutral" : "purple" : meeting.status === "no_show" || meeting.status === "reschedule_needed" ? "warning" : overdue ? "danger" : "info"} dot>{meeting.status === "completed" ? (meeting.outcome ?? "completed").replaceAll("_", " ") : meeting.status.replaceAll("_", " ")}</Badge>
          <div className="row-actions"><Button variant="ghost" size="sm" onClick={() => setDrawerLeadId(lead.id)}>View lead</Button>{meeting.status === "booked" ? <><Button variant="secondary" size="sm" onClick={() => setReschedulingId(meeting.id)}>Reschedule</Button><Button variant="quiet" size="sm" onClick={() => commit("Meeting marked no-show", (current) => updateMeetingStatus(current, meeting.id, "no_show"), "No-show recorded; follow-up added to Today")}>No Show</Button><Button variant="primary" size="sm" onClick={() => setCompletingId(meeting.id)}>Complete</Button></> : meeting.status === "reschedule_needed" || meeting.status === "cancelled" ? <Button variant="primary" size="sm" onClick={() => setReschedulingId(meeting.id)}>Set new time</Button> : null}</div>
        </article>;
      })}</div> : <EmptyState icon={<Icon name="calendar" size={27} />} title={view === "today" ? "No meetings today" : `No ${tabs.find((tab) => tab.id === view)?.label.toLowerCase()} meetings`} description="Meetings move between these views automatically as you record outcomes." />}
    </section>

    <CompleteMeetingModal meeting={state.meetings.find((meeting) => meeting.id === completingId) ?? null} onClose={() => setCompletingId(null)} onSubmit={(meeting, input) => { commit("Meeting completed", (current) => completeMeeting(current, meeting.id, input), input.outcome === "won" ? "Client won" : input.outcome === "lost" ? "Meeting marked lost" : "Five-touch follow-up started"); setCompletingId(null); }} />
    <RescheduleModal key={reschedulingId ?? "none"} meeting={state.meetings.find((meeting) => meeting.id === reschedulingId) ?? null} onClose={() => setReschedulingId(null)} onSubmit={(meeting, scheduledAt, note) => { commit("Meeting rescheduled", (current) => updateMeetingStatus(current, meeting.id, "booked", { scheduledAt, note }), "Meeting rescheduled"); setReschedulingId(null); }} onNeedsDate={(meeting, note) => { commit("Meeting needs rescheduling", (current) => updateMeetingStatus(current, meeting.id, "reschedule_needed", { note }), "Meeting moved to Reschedule Needed"); setReschedulingId(null); }} />
    <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
  </>;
}

function CompleteMeetingModal({ meeting, onClose, onSubmit }: { meeting: Meeting | null; onClose: () => void; onSubmit: (meeting: Meeting, input: { outcome: MeetingOutcome; note?: string; nextAt?: string; lostReason?: string; interestSummary?: string; mainObjection?: string; decisionStatus?: string }) => void }) {
  const [outcome, setOutcome] = useState<"won" | "lost" | "follow_up_needed" | "">("");
  const [note, setNote] = useState("");
  const [interest, setInterest] = useState("");
  const [objection, setObjection] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [nextAt, setNextAt] = useState(nextBusinessMorning());
  if (!meeting) return null;
  const startFollowUp = outcome === "follow_up_needed";
  return <Modal open onClose={onClose} title="Complete meeting" description="Choose the result. If there is no final decision, start the five-touch follow-up and choose its first due date." size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={outcome === "won" ? "success" : "primary"} disabled={!outcome || (startFollowUp && !nextAt)} onClick={() => onSubmit(meeting, { outcome: outcome as MeetingOutcome, note, nextAt: startFollowUp ? new Date(nextAt).toISOString() : undefined, lostReason, interestSummary: interest, mainObjection: objection, decisionStatus: outcome === "won" ? "Won" : outcome === "lost" ? "Lost" : "Follow-up active" })}>Complete meeting</Button></>}>
    <div className="form-stack"><div className="meeting-result-choices"><button className={outcome === "won" ? "is-selected is-success" : ""} onClick={() => setOutcome("won")}><Icon name="won" size={18} /><strong>Won</strong></button><button className={outcome === "lost" ? "is-selected" : ""} onClick={() => setOutcome("lost")}><Icon name="lost" size={18} /><strong>Lost</strong></button><button className={outcome === "follow_up_needed" ? "is-selected" : ""} onClick={() => setOutcome("follow_up_needed")}><Icon name="followUp" size={18} /><strong>Start Follow-Up Sequence</strong></button></div>
      <div className="form-grid"><label className="field"><span>What interested them?</span><input value={interest} onChange={(event) => setInterest(event.target.value)} /></label><label className="field"><span>Main objection</span><input value={objection} onChange={(event) => setObjection(event.target.value)} /></label>{startFollowUp ? <label className="field"><span>Touch 1 due date and time</span><input type="datetime-local" value={nextAt} onChange={(event) => setNextAt(event.target.value)} /></label> : null}{outcome === "lost" ? <label className="field"><span>Lost reason</span><select value={lostReason} onChange={(event) => setLostReason(event.target.value)}><option value="">No reason selected</option>{LOST_REASONS.map((reason) => <option key={reason}>{reason}</option>)}</select></label> : null}<label className="field field--full"><span>Meeting notes</span><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} /></label></div>
    </div>
  </Modal>;
}

function RescheduleModal({ meeting, onClose, onSubmit, onNeedsDate }: { meeting: Meeting | null; onClose: () => void; onSubmit: (meeting: Meeting, scheduledAt: string, note: string) => void; onNeedsDate: (meeting: Meeting, note: string) => void }) {
  const [date, setDate] = useState(() => meeting ? toLocalInputValue(meeting.scheduledAt) : nextBusinessMorning());
  const [note, setNote] = useState("");
  if (!meeting) return null;
  return <Modal open onClose={onClose} title="Reschedule meeting" description="Set the agreed time now, or place it in Reschedule Needed until the prospect confirms." size="sm" footer={<><Button variant="ghost" onClick={() => onNeedsDate(meeting, note)}>Date not known yet</Button><Button variant="primary" disabled={!date} onClick={() => onSubmit(meeting, new Date(date).toISOString(), note)}>Save new time</Button></>}><div className="form-stack"><label className="field"><span>New date and time</span><input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="field"><span>Note <small>Optional</small></span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label></div></Modal>;
}

function nextBusinessMorning() { const date = new Date(); date.setDate(date.getDate() + 1); while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1); date.setHours(10, 0, 0, 0); return toLocalInputValue(date); }
