import { useEffect, useState } from "react";
import { useCRM } from "../data/store";
import { addNote, applyColdOutcome, applyPostMeetingOutcome, reopenLead, updateLead } from "../domain/engine";
import type { ContactType, FindingStrength, LeadPriority, PixelPresence, PostMeetingTouchType } from "../types";
import { CONTACT_TYPE_LABELS, LOST_REASONS, PRIORITY_LABELS, STATUS_LABELS, STATUS_TONES } from "../lib/constants";
import { cn, formatDateTime, phoneHref, relativeTime, toLocalInputValue } from "../lib/format";
import { Icon } from "./Icon";
import { Badge, Button, Modal } from "./UI";

interface LeadDrawerProps {
  leadId: string | null;
  onClose: () => void;
}

type QuickAction =
  | "callback" | "meeting" | "not_interested" | "wrong_number" | "disqualified" | "dnc" | "won" | "lost"
  | "pm_still_deciding" | "pm_callback" | "pm_second_meeting" | "pm_proposal" | "pm_lost" | "pm_dnc"
  | null;

function nextBusinessMorning() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return toLocalInputValue(date);
}

export function LeadDrawer({ leadId, onClose }: LeadDrawerProps) {
  const { state, commit, notify } = useCRM();
  const lead = state.leads.find((item) => item.id === leadId);
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState("");
  const [action, setAction] = useState<QuickAction>(null);
  const [scheduleAt, setScheduleAt] = useState(nextBusinessMorning());
  const [actionNote, setActionNote] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [touchType, setTouchType] = useState<PostMeetingTouchType>("phone");

  useEffect(() => {
    setEditing(false);
    setAction(null);
    setNotes(lead?.lastConversationNotes ?? "");
    setScheduleAt(nextBusinessMorning());
    setActionNote("");
    setLostReason("");
    setTouchType("phone");
  }, [lead?.id]);

  if (!lead) return null;
  const activities = state.activities.filter((activity) => activity.leadId === lead.id && !activity.voidedAt).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const meetings = state.meetings.filter((meeting) => meeting.leadId === lead.id && !meeting.voidedAt).sort((left, right) => right.scheduledAt.localeCompare(left.scheduledAt));
  const touches = state.postMeetingTouches.filter((touch) => touch.leadId === lead.id && !touch.voidedAt).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const batch = state.batches.find((item) => item.id === lead.batchId);
  const terminal = !lead.nextAction;
  const canReopen = terminal && lead.status !== "do_not_call" && lead.status !== "won" && lead.status !== "wrong_number";
  const isPostMeeting = lead.pipelineStage === "post_meeting";

  const saveNotes = () => {
    const value = notes.trim();
    if (!value || value === lead.lastConversationNotes.trim()) return;
    commit("Notes autosaved", (current) => addNote(current, lead.id, value), "Notes autosaved");
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

  const recordCold = (outcome: Parameters<typeof applyColdOutcome>[2]["outcome"], extra: Record<string, unknown> = {}, message?: string) => {
    commit("Call outcome recorded", (current) => applyColdOutcome(current, lead.id, { outcome, note: actionNote.trim() || notes.trim(), ...extra }), message ?? `${outcome.replaceAll("_", " ")} recorded`);
    onClose();
  };

  const recordPostMeeting = (outcome: Parameters<typeof applyPostMeetingOutcome>[2]["outcome"], extra: Record<string, unknown> = {}, message?: string) => {
    commit("Follow-up outcome recorded", (current) => applyPostMeetingOutcome(current, lead.id, { outcome, touchType, note: actionNote.trim() || notes.trim(), ...extra }), message ?? `${outcome.replaceAll("_", " ")} recorded`);
    onClose();
  };

  const submitAction = () => {
    const at = scheduleAt ? new Date(scheduleAt).toISOString() : undefined;
    if (action === "callback") recordCold("callback", { callbackAt: at }, "Callback scheduled");
    else if (action === "meeting") recordCold("meeting_booked", { meetingAt: at, meetingType: "Video call" }, "Meeting booked");
    else if (action === "not_interested") recordCold("not_interested", { lostReason: lostReason || "Not Interested" }, "Lead finished as not interested");
    else if (action === "wrong_number") recordCold("bad_number", {}, "Lead finished as wrong number");
    else if (action === "disqualified") recordCold("disqualified", { lostReason: lostReason || "Disqualified" }, "Lead finished as disqualified");
    else if (action === "dnc") recordCold("do_not_call", {}, "Do Not Contact protection enabled");
    else if (action === "won") recordCold("won", {}, "Lead marked won");
    else if (action === "lost") recordCold("lost", { lostReason }, "Lead marked lost");
    else if (action === "pm_still_deciding") recordPostMeeting("still_deciding", { nextAt: at }, "Next follow-up scheduled");
    else if (action === "pm_callback") recordPostMeeting("requested_callback", { callbackAt: at }, "Exact callback scheduled");
    else if (action === "pm_second_meeting") recordPostMeeting("second_meeting_booked", { secondMeetingAt: at, secondMeetingType: "Second meeting" }, "Second meeting booked");
    else if (action === "pm_proposal") recordPostMeeting("proposal_sent", { nextAt: at }, "Proposal follow-up scheduled");
    else if (action === "pm_lost") recordPostMeeting("lost", { lostReason }, "Opportunity marked lost");
    else if (action === "pm_dnc") recordPostMeeting("do_not_contact", {}, "Do Not Contact protection enabled");
    setAction(null);
  };

  return <>
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="drawer drawer--simple" aria-label={`${lead.clinicName} details`}>
        <header className="drawer__header">
          <div className="drawer__identity"><span className="lead-avatar lead-avatar--lg">{lead.clinicName.slice(0, 2).toUpperCase()}</span><div><div><Badge tone={STATUS_TONES[lead.status] as "info"}>{STATUS_LABELS[lead.status]}</Badge><Badge tone={lead.priority === "critical" ? "danger" : lead.priority === "high" ? "warning" : "neutral"}>{PRIORITY_LABELS[lead.priority]}</Badge></div><h2>{lead.clinicName}</h2><p>{lead.decisionMakerName || "Decision maker unknown"} · {lead.decisionMakerRole || CONTACT_TYPE_LABELS[lead.contactType]}</p></div></div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close lead details"><Icon name="close" size={19} /></Button>
        </header>

        <div className={cn("drawer-next-action", terminal && "is-terminal")}>
          <span><Icon name={lead.nextAction?.type === "meeting" ? "calendar" : lead.nextAction ? "arrowRight" : "checkCircle"} size={18} /></span>
          <div><small>Next action</small><strong>{lead.nextAction?.reason ?? "Finished — no future action scheduled"}</strong></div>
          <div><strong>{lead.nextAction ? relativeTime(lead.nextAction.dueAt) : "Complete"}</strong><small>{lead.nextAction ? formatDateTime(lead.nextAction.dueAt) : "History retained"}</small></div>
        </div>

        <div className="drawer__body drawer__body--simple">
          <div className="lead-primary-actions">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)} startIcon={<Icon name="edit" size={14} />}>Edit</Button>
            {lead.directPhone || lead.mobilePhone ? <Button variant="secondary" size="sm" onClick={() => void copy(lead.directPhone || lead.mobilePhone, "Phone number")} startIcon={<Icon name="copy" size={14} />}>Copy phone</Button> : null}
            {lead.websiteUrl ? <><Button variant="secondary" size="sm" onClick={() => void copy(lead.websiteUrl, "Website")} startIcon={<Icon name="copy" size={14} />}>Copy website</Button><a className="button button--ghost button--sm" href={lead.websiteUrl} target="_blank" rel="noreferrer"><Icon name="externalLink" size={14} /> Open site</a></> : null}
            {canReopen ? <Button variant="primary" size="sm" onClick={() => commit("Lead reopened", (current) => reopenLead(current, lead.id), "Lead reopened and added to Today")}>Reopen</Button> : null}
          </div>

          {!terminal ? <section className="detail-section quick-outcome-section">
            <div className="section-heading"><div><h3>Record result</h3><p>Save the outcome and the next lead will move into place.</p></div>{isPostMeeting ? <Badge tone="purple">Touch {lead.postMeetingTouchCount} / {state.settings.followUp.maximumPostMeetingTouches}</Badge> : <Badge>Attempt {lead.coldNoAnswerCount} / {state.settings.calling.maximumInitialAttempts}</Badge>}</div>
            {isPostMeeting ? <div className="quick-outcome-grid">
              <Button variant="secondary" size="sm" onClick={() => recordPostMeeting("no_answer", {}, "No answer recorded; next touch scheduled")}>No Answer</Button>
              <Button variant="secondary" size="sm" onClick={() => setAction("pm_still_deciding")}>Still Deciding</Button>
              <Button variant="secondary" size="sm" onClick={() => setAction("pm_callback")}>Callback</Button>
              <Button variant="secondary" size="sm" onClick={() => setAction("pm_second_meeting")}>Second Meeting</Button>
              <Button variant="secondary" size="sm" onClick={() => setAction("pm_proposal")}>Proposal Sent</Button>
              <Button variant="success" size="sm" onClick={() => recordPostMeeting("won", {}, "Client won")}>Won</Button>
              <Button variant="quiet" size="sm" onClick={() => setAction("pm_lost")}>Lost</Button>
              <Button variant="danger" size="sm" onClick={() => setAction("pm_dnc")}>Do Not Contact</Button>
            </div> : <div className="quick-outcome-grid">
              <Button variant="secondary" size="sm" onClick={() => recordCold("no_answer", {}, "No answer recorded; retry scheduled")}>No Answer</Button>
              <Button variant="secondary" size="sm" onClick={() => setAction("callback")}>Callback</Button>
              <Button variant="primary" size="sm" onClick={() => setAction("meeting")}>Meeting Booked</Button>
              <Button variant="quiet" size="sm" onClick={() => setAction("not_interested")}>Not Interested</Button>
              <Button variant="quiet" size="sm" onClick={() => setAction("wrong_number")}>Wrong Number</Button>
              <Button variant="quiet" size="sm" onClick={() => setAction("disqualified")}>Disqualified</Button>
              <Button variant="success" size="sm" onClick={() => setAction("won")}>Won</Button>
              <Button variant="quiet" size="sm" onClick={() => setAction("lost")}>Lost</Button>
              <Button variant="danger" size="sm" onClick={() => setAction("dnc")}>Do Not Contact</Button>
            </div>}
          </section> : null}

          <section className="detail-section">
            <h3>Main information</h3>
            <div className="detail-grid detail-grid--main">
              <Detail label="Clinic" value={lead.clinicName} />
              <Detail label="Website" value={lead.websiteDomain || lead.websiteUrl} />
              <Detail label="Decision-maker" value={lead.decisionMakerName} />
              <Detail label="Role" value={lead.decisionMakerRole || CONTACT_TYPE_LABELS[lead.contactType]} />
              <Detail label="Direct phone" value={lead.directPhone} href={phoneHref(lead.directPhone)} />
              <Detail label="Mobile phone" value={lead.mobilePhone} href={phoneHref(lead.mobilePhone)} />
              <Detail label="Location" value={[lead.city, lead.state].filter(Boolean).join(", ")} />
              <Detail label="Tracking pixel" value={lead.pixelPresent} />
              <Detail label="Primary finding" value={lead.primaryFinding || `Finding strength ${lead.findingStrength}`} />
              <Detail label="Current status" value={STATUS_LABELS[lead.status]} />
              <Detail label="Cold attempts" value={`${lead.coldAttemptCount} total · ${lead.coldNoAnswerCount} unanswered / ${state.settings.calling.maximumInitialAttempts}`} />
              <Detail label="Post-meeting touches" value={`${lead.postMeetingTouchCount} / ${state.settings.followUp.maximumPostMeetingTouches}`} />
              <Detail label="Next action" value={lead.nextAction?.reason} />
              <Detail label="Next action date" value={lead.nextAction ? formatDateTime(lead.nextAction.dueAt) : "No future action"} />
              <Detail label="Imported batch" value={batch?.name || "Direct entry"} />
            </div>
            {Object.keys(lead.customFields).length ? <div className="custom-field-grid">{Object.entries(lead.customFields).map(([key, value]) => <Detail key={key} label={key} value={value} />)}</div> : null}
          </section>

          <section className="detail-section">
            <div className="section-heading"><div><h3>Notes</h3><p>Autosaves when you leave the field.</p></div><span className="autosave-label"><Icon name="check" size={13} /> Local autosave</span></div>
            <textarea className="lead-notes-editor" value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={saveNotes} rows={5} placeholder="Add the useful context for the next interaction…" />
          </section>

          {meetings.length || touches.length ? <section className="detail-section">
            <div className="section-heading"><h3>Meeting & follow-up context</h3>{touches.length ? <Badge tone="purple">{touches.length} touches</Badge> : null}</div>
            {meetings.slice(0, 3).map((meeting) => <div className="detail-record" key={meeting.id}><span><Icon name="calendar" size={16} /></span><div><strong>{meeting.meetingType} · {formatDateTime(meeting.scheduledAt)}</strong><small>{meeting.status.replaceAll("_", " ")}{meeting.outcome ? ` · ${meeting.outcome.replaceAll("_", " ")}` : ""}</small>{meeting.notes ? <p>{meeting.notes}</p> : null}</div></div>)}
            {touches.slice(0, 5).map((touch) => <div className="detail-record" key={touch.id}><span><Icon name={touch.type === "email" ? "mail" : "phone"} size={16} /></span><div><strong>Touch {touch.touchNumber} · {touch.type}</strong><small>{touch.outcome.replaceAll("_", " ")} · {formatDateTime(touch.completedAt)}</small>{touch.note ? <p>{touch.note}</p> : null}</div></div>)}
          </section> : null}

          <section className="detail-section">
            <div className="section-heading"><div><h3>History</h3><p>A permanent chronological record of what happened.</p></div><Badge>{activities.length} events</Badge></div>
            <div className="timeline timeline--full">{activities.length ? activities.map((activity) => <div className="timeline__item" key={activity.id}><i /><div><time>{formatDateTime(activity.occurredAt)}</time><strong>{activity.title}</strong>{activity.note ? <p>{activity.note}</p> : null}</div></div>) : <p className="muted">No activity has been recorded yet.</p>}</div>
          </section>
        </div>
      </aside>
    </div>

    <EditLeadModal leadId={editing ? lead.id : null} onClose={() => setEditing(false)} />
    <QuickActionModal action={action} scheduleAt={scheduleAt} setScheduleAt={setScheduleAt} note={actionNote} setNote={setActionNote} lostReason={lostReason} setLostReason={setLostReason} touchType={touchType} setTouchType={setTouchType} onClose={() => setAction(null)} onSubmit={submitAction} />
  </>;
}

function Detail({ label, value, href }: { label: string; value?: string; href?: string }) {
  return <div><small>{label}</small>{href && value ? <a href={href}>{value}</a> : <strong>{value || "—"}</strong>}</div>;
}

function QuickActionModal(props: {
  action: QuickAction;
  scheduleAt: string;
  setScheduleAt: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  lostReason: string;
  setLostReason: (value: string) => void;
  touchType: PostMeetingTouchType;
  setTouchType: (value: PostMeetingTouchType) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!props.action) return null;
  const scheduled = ["callback", "meeting", "pm_still_deciding", "pm_callback", "pm_second_meeting", "pm_proposal"].includes(props.action);
  const lost = ["not_interested", "disqualified", "lost", "pm_lost"].includes(props.action);
  const dnc = props.action === "dnc" || props.action === "pm_dnc";
  const postMeeting = props.action.startsWith("pm_");
  const labels: Record<Exclude<QuickAction, null>, string> = {
    callback: "Schedule callback", meeting: "Book meeting", not_interested: "Not interested", wrong_number: "Wrong number",
    disqualified: "Disqualified", dnc: "Do not contact", won: "Mark won", lost: "Mark lost",
    pm_still_deciding: "Still deciding", pm_callback: "Schedule callback", pm_second_meeting: "Book second meeting",
    pm_proposal: "Proposal sent", pm_lost: "Mark lost", pm_dnc: "Do not contact",
  };
  return <Modal open onClose={props.onClose} title={labels[props.action]} description={dnc ? "This permanently removes the lead from all future work queues." : "Save the result and Relay will place the lead in the correct next stage."} size="sm" footer={<><Button variant="ghost" onClick={props.onClose}>Cancel</Button><Button variant={dnc ? "danger" : props.action === "won" ? "success" : "primary"} disabled={scheduled && !props.scheduleAt} onClick={props.onSubmit}>{dnc ? "Stop future contact" : "Save result"}</Button></>}>
    <div className="form-stack">
      {postMeeting && !dnc ? <label className="field"><span>Touch type</span><select value={props.touchType} onChange={(event) => props.setTouchType(event.target.value as PostMeetingTouchType)}><option value="phone">Phone</option><option value="email">Email</option><option value="callback">Scheduled callback</option><option value="other">Other</option></select></label> : null}
      {scheduled ? <label className="field"><span>{props.action.includes("meeting") ? "Meeting date and time" : props.action.includes("callback") ? "Exact callback date and time" : "Next follow-up date and time"}</span><input type="datetime-local" value={props.scheduleAt} onChange={(event) => props.setScheduleAt(event.target.value)} required /></label> : null}
      {lost ? <label className="field"><span>Reason <small>Optional</small></span><select value={props.lostReason} onChange={(event) => props.setLostReason(event.target.value)}><option value="">No reason selected</option>{LOST_REASONS.map((reason) => <option key={reason}>{reason}</option>)}</select></label> : null}
      {!dnc ? <label className="field"><span>Note <small>Optional</small></span><textarea rows={3} value={props.note} onChange={(event) => props.setNote(event.target.value)} placeholder="What should be remembered?" /></label> : <div className="danger-callout"><Icon name="lock" size={19} /><div><strong>Permanent queue exclusion</strong><p>The record and history remain available in Finished.</p></div></div>}
    </div>
  </Modal>;
}

function EditLeadModal({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { state, commit } = useCRM();
  const lead = state.leads.find((item) => item.id === leadId);
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!lead) return;
    setForm({ clinicName: lead.clinicName, websiteUrl: lead.websiteUrl, city: lead.city, state: lead.state, decisionMakerName: lead.decisionMakerName, decisionMakerRole: lead.decisionMakerRole, contactType: lead.contactType, directPhone: lead.directPhone, mobilePhone: lead.mobilePhone, email: lead.email, priority: lead.priority, pixelPresent: lead.pixelPresent, primaryFinding: lead.primaryFinding, findingStrength: lead.findingStrength });
  }, [lead]);
  if (!lead) return null;
  const field = (key: string) => ({ value: form[key] ?? "", onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value })) });
  const save = () => {
    commit("Lead updated", (current) => updateLead(current, lead.id, { ...form, contactType: form.contactType as ContactType, priority: form.priority as LeadPriority, pixelPresent: form.pixelPresent as PixelPresence, findingStrength: form.findingStrength as FindingStrength }), "Lead changes saved");
    onClose();
  };
  return <Modal open onClose={onClose} title="Edit lead" description="Only lead information changes; history and counters remain intact." size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save changes</Button></>}>
    <div className="form-grid">
      <label className="field"><span>Clinic name</span><input {...field("clinicName")} /></label><label className="field"><span>Website</span><input {...field("websiteUrl")} /></label>
      <label className="field"><span>Decision-maker</span><input {...field("decisionMakerName")} /></label><label className="field"><span>Role</span><input {...field("decisionMakerRole")} /></label>
      <label className="field"><span>Direct phone</span><input {...field("directPhone")} /></label><label className="field"><span>Mobile phone</span><input {...field("mobilePhone")} /></label>
      <label className="field"><span>Email</span><input type="email" {...field("email")} /></label><label className="field"><span>Contact type</span><select {...field("contactType")}>{Object.entries(CONTACT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span>City</span><input {...field("city")} /></label><label className="field"><span>State</span><input {...field("state")} /></label>
      <label className="field"><span>Pixel</span><select {...field("pixelPresent")}><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option></select></label><label className="field"><span>Finding strength</span><select {...field("findingStrength")}><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="unknown">Unknown</option></select></label>
      <label className="field field--full"><span>Primary finding</span><input {...field("primaryFinding")} /></label><label className="field"><span>Priority</span><select {...field("priority")}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
  </Modal>;
}
