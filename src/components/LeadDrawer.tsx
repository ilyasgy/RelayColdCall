import { useEffect, useState } from "react";
import { useCRM } from "../data/store";
import { addNote, reopenLead, updateLead } from "../domain/engine";
import type { ContactType, FindingStrength, LeadPriority, PixelPresence } from "../types";
import { CONTACT_TYPE_LABELS, PRIORITY_LABELS, STATUS_LABELS, STATUS_TONES } from "../lib/constants";
import { cn, formatDateTime, formatLocalTime, phoneHref, relativeTime } from "../lib/format";
import { Icon } from "./Icon";
import { Badge, Button, Modal } from "./UI";

interface LeadDrawerProps {
  leadId: string | null;
  onClose: () => void;
}

export function LeadDrawer({ leadId, onClose }: LeadDrawerProps) {
  const { state, commit } = useCRM();
  const lead = state.leads.find((item) => item.id === leadId);
  const [tab, setTab] = useState<"overview" | "activity" | "opportunity" | "research">("overview");
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    setTab("overview");
    setEditing(false);
    setNote("");
  }, [leadId]);

  if (!lead) return null;
  const activities = state.activities.filter((activity) => activity.leadId === lead.id && !activity.voidedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const meetings = state.meetings.filter((meeting) => meeting.leadId === lead.id && !meeting.voidedAt).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  const touches = state.postMeetingTouches.filter((touch) => touch.leadId === lead.id && !touch.voidedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const batch = state.batches.find((item) => item.id === lead.batchId);
  const terminalDormant = lead.status === "dormant_unreachable" || lead.status === "dormant_post_meeting_no_response";

  return (
    <>
      <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <aside className="drawer" aria-label={`${lead.clinicName} details`}>
          <header className="drawer__header">
            <div className="drawer__identity"><span className="lead-avatar lead-avatar--lg">{lead.clinicName.slice(0, 2).toUpperCase()}</span><div><div><Badge tone={STATUS_TONES[lead.status] as "info"}>{STATUS_LABELS[lead.status]}</Badge><Badge tone={lead.priority === "critical" ? "danger" : lead.priority === "high" ? "warning" : "neutral"}>{PRIORITY_LABELS[lead.priority]}</Badge></div><h2>{lead.clinicName}</h2><p>{lead.decisionMakerName || "Decision maker unknown"} · {lead.decisionMakerRole || CONTACT_TYPE_LABELS[lead.contactType]}</p></div></div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close lead details"><Icon name="close" size={19} /></Button>
          </header>

          <div className={cn("drawer-next-action", !lead.nextAction && "is-terminal")}>
            <span><Icon name={lead.nextAction?.type.includes("meeting") ? "calendar" : lead.nextAction?.type.includes("correction") ? "badNumber" : lead.nextAction ? "phone" : "checkCircle"} size={18} /></span>
            <div><small>What happens next</small><strong>{lead.nextAction?.reason ?? (terminalDormant ? "No automated action — reopen manually when appropriate" : lead.status === "won" ? "Client won — sales follow-up complete" : "Closed — no future queue action")}</strong></div>
            <div><strong>{lead.nextAction ? relativeTime(lead.nextAction.dueAt) : "No action"}</strong><small>{lead.nextAction ? formatDateTime(lead.nextAction.dueAt) : "History retained"}</small></div>
          </div>

          <div className="drawer__tabs" role="tablist">
            {(["overview", "activity", "opportunity", "research"] as const).map((item) => <button key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)} role="tab" aria-selected={tab === item}>{item}</button>)}
          </div>

          <div className="drawer__body">
            {tab === "overview" ? <>
              <div className="detail-actions"><Button variant="primary" size="sm" onClick={() => setEditing(true)} startIcon={<Icon name="edit" size={15} />}>Edit lead</Button>{terminalDormant ? <Button variant="secondary" size="sm" onClick={() => commit("Lead reopened", (current) => reopenLead(current, lead.id), "Lead reopened and queued")} startIcon={<Icon name="recycle" size={15} />}>Reopen lead</Button> : null}</div>
              <section className="detail-section"><h3>Contact</h3><div className="detail-grid"><div><small>Decision maker</small><strong>{lead.decisionMakerName || "—"}</strong></div><div><small>Role</small><strong>{lead.decisionMakerRole || CONTACT_TYPE_LABELS[lead.contactType]}</strong></div><div><small>Direct phone</small><a href={phoneHref(lead.directPhone)}>{lead.directPhone || "—"}</a></div><div><small>Mobile</small><a href={phoneHref(lead.mobilePhone)}>{lead.mobilePhone || "—"}</a></div><div><small>Email</small><a href={lead.email ? `mailto:${lead.email}` : undefined}>{lead.email || "—"}</a></div><div><small>Local time</small><strong>{formatLocalTime(lead.timeZone)}</strong></div></div></section>
              <section className="detail-section"><h3>Business</h3><div className="detail-grid"><div><small>Website</small><a href={lead.websiteUrl} target="_blank" rel="noreferrer">{lead.websiteDomain || "—"} <Icon name="externalLink" size={12} /></a></div><div><small>Location</small><strong>{lead.city}, {lead.state}</strong></div><div><small>Specialty</small><strong>{lead.specialty || "—"}</strong></div><div><small>Practice size</small><strong>{lead.practiceSize || "—"}</strong></div><div><small>Batch</small><strong>{batch?.name || "Direct entry"}</strong></div><div><small>Assigned caller</small><strong>{lead.assignedCaller || "Operator"}</strong></div></div></section>
              <section className="detail-section"><h3>Journey counters</h3><div className="counter-pair counter-pair--drawer"><div><span>Cold call attempts</span><strong>{lead.coldAttemptCount} <small>/ {state.settings.calling.maximumLifetimeAttempts}</small></strong></div><div className={lead.pipelineStage === "post_meeting" ? "is-active" : ""}><span>Post-meeting touches</span><strong>{lead.postMeetingTouchCount} <small>/ {state.settings.followUp.maximumPostMeetingTouches}</small></strong></div></div></section>
              <section className="detail-section"><h3>Add note</h3><div className="inline-note"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add an append-only note…" rows={3} /><Button variant="secondary" disabled={!note.trim()} onClick={() => { commit("Note added", (current) => addNote(current, lead.id, note.trim()), "Note saved"); setNote(""); }}>Add note</Button></div></section>
            </> : null}

            {tab === "activity" ? <section className="detail-section"><div className="section-heading"><h3>Complete activity history</h3><Badge>{activities.length} events</Badge></div><div className="timeline timeline--full">{activities.map((activity) => <div className="timeline__item" key={activity.id}><i /><div><time>{formatDateTime(activity.occurredAt)}</time><strong>{activity.title}</strong>{activity.note ? <p>{activity.note}</p> : null}</div></div>)}</div></section> : null}

            {tab === "opportunity" ? <>
              <section className="detail-section"><div className="section-heading"><h3>Meetings</h3><Badge tone="info">{meetings.length}</Badge></div>{meetings.length ? meetings.map((meeting) => <div className="detail-record" key={meeting.id}><span><Icon name="calendar" size={17} /></span><div><strong>{formatDateTime(meeting.scheduledAt)} · {meeting.meetingType}</strong><small>{meeting.status}{meeting.outcome ? ` · ${meeting.outcome.replaceAll("_", " ")}` : ""}</small>{meeting.notes ? <p>{meeting.notes}</p> : null}</div></div>) : <p className="muted">No meetings recorded.</p>}</section>
              <section className="detail-section"><div className="section-heading"><h3>Post-meeting touches</h3><Badge tone="purple">{lead.postMeetingTouchCount} / {state.settings.followUp.maximumPostMeetingTouches}</Badge></div>{touches.length ? touches.map((touch) => <div className="detail-record" key={touch.id}><span><Icon name={touch.type === "email" ? "mail" : "phone"} size={17} /></span><div><strong>Touch {touch.touchNumber} — {touch.type}</strong><small>{formatDateTime(touch.occurredAt)} · {touch.outcome.replaceAll("_", " ")}</small>{touch.note ? <p>{touch.note}</p> : null}</div></div>) : <p className="muted">No post-meeting touches recorded.</p>}</section>
            </> : null}

            {tab === "research" ? <>
              <section className="detail-section"><div className="research-hero"><span className={cn("finding-strength", `is-${lead.findingStrength.toLowerCase()}`)}><strong>{lead.findingStrength}</strong><small>Strength</small></span><div><small>Primary finding</small><h3>{lead.primaryFinding || "Not researched"}</h3><p>{lead.evidenceNotes || "No evidence note available."}</p></div></div></section>
              <section className="detail-section"><div className="detail-grid"><div><small>Finding category</small><strong>{lead.findingCategory || "—"}</strong></div><div><small>Tracking pixel</small><strong>{lead.pixelPresent}</strong></div><div><small>Technology</small><strong>{lead.trackingTechnologies.join(", ") || "—"}</strong></div><div><small>Security grade</small><strong>{lead.securityGrade || "—"}</strong></div></div></section>
              <section className="detail-section"><h3>Pitch notes</h3><p>{lead.pitchNotes || "No pitch notes saved."}</p></section>
            </> : null}
          </div>
        </aside>
      </div>
      <EditLeadModal leadId={editing ? lead.id : null} onClose={() => setEditing(false)} />
    </>
  );
}

function EditLeadModal({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { state, commit } = useCRM();
  const lead = state.leads.find((item) => item.id === leadId);
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!lead) return;
    setForm({ clinicName: lead.clinicName, websiteUrl: lead.websiteUrl, city: lead.city, state: lead.state, timeZone: lead.timeZone, specialty: lead.specialty, practiceSize: lead.practiceSize, decisionMakerName: lead.decisionMakerName, decisionMakerRole: lead.decisionMakerRole, contactType: lead.contactType, directPhone: lead.directPhone, mobilePhone: lead.mobilePhone, extension: lead.extension, email: lead.email, priority: lead.priority, pixelPresent: lead.pixelPresent, primaryFinding: lead.primaryFinding, findingCategory: lead.findingCategory, findingStrength: lead.findingStrength, evidenceNotes: lead.evidenceNotes, pitchNotes: lead.pitchNotes, securityGrade: lead.securityGrade });
  }, [lead]);
  if (!lead) return null;
  const field = (key: string) => ({ value: form[key] ?? "", onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value })) });
  const save = () => {
    commit("Lead updated", (current) => updateLead(current, lead.id, { ...form, contactType: form.contactType as ContactType, priority: form.priority as LeadPriority, pixelPresent: form.pixelPresent as PixelPresence, findingStrength: form.findingStrength as FindingStrength }), "Lead changes autosaved");
    onClose();
  };
  return <Modal open onClose={onClose} title="Edit lead" description="Changes update the operational record immediately." size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save changes</Button></>}><div className="form-grid"><label className="field"><span>Clinic name</span><input {...field("clinicName")} /></label><label className="field"><span>Website</span><input {...field("websiteUrl")} /></label><label className="field"><span>Decision maker</span><input {...field("decisionMakerName")} /></label><label className="field"><span>Role</span><input {...field("decisionMakerRole")} /></label><label className="field"><span>Contact class</span><select {...field("contactType")}>{Object.entries(CONTACT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span>Direct phone</span><input {...field("directPhone")} /></label><label className="field"><span>Mobile phone</span><input {...field("mobilePhone")} /></label><label className="field"><span>Email</span><input type="email" {...field("email")} /></label><label className="field"><span>City</span><input {...field("city")} /></label><label className="field"><span>State</span><input {...field("state")} /></label><label className="field"><span>Time zone</span><input {...field("timeZone")} /></label><label className="field"><span>Priority</span><select {...field("priority")}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span>Pixel</span><select {...field("pixelPresent")}><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option></select></label><label className="field"><span>Finding strength</span><select {...field("findingStrength")}><option value="A">A — Strong</option><option value="B">B — Good</option><option value="C">C — Fallback</option><option value="unknown">Unknown</option></select></label><label className="field field--full"><span>Primary finding</span><input {...field("primaryFinding")} /></label><label className="field field--full"><span>Evidence</span><textarea rows={3} {...field("evidenceNotes")} /></label><label className="field field--full"><span>Pitch notes</span><textarea rows={3} {...field("pitchNotes")} /></label></div></Modal>;
}
