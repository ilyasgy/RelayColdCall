import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Badge, Button, EmptyState, Modal, Progress } from "../components/UI";
import { useCRM } from "../data/store";
import {
  addNote,
  applyColdOutcome,
  applyPostMeetingOutcome,
  endSession,
  getQueue,
} from "../domain/engine";
import { CONTACT_TYPE_LABELS, LOST_REASONS, STATUS_LABELS, STATUS_TONES } from "../lib/constants";
import { cn, formatDateTime, formatLocalTime, phoneHref, relativeTime, toLocalInputValue } from "../lib/format";
import type { ColdCallOutcome, PostMeetingOutcomeKind, PostMeetingTouchType } from "../types";

type ModalKind =
  | "callback"
  | "follow_up"
  | "meeting"
  | "lost"
  | "dnc"
  | "wrong_person"
  | "other"
  | "pm_still_deciding"
  | "pm_approval"
  | "pm_callback"
  | "pm_second_meeting"
  | "pm_proposal"
  | "pm_lost"
  | "pm_dnc"
  | null;

interface FocusModeProps {
  onExit: () => void;
}

function nextBusinessMorning(days = 1) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return toLocalInputValue(date);
}

function elapsedLabel(startedAt?: string) {
  if (!startedAt) return "00:00";
  const totalMinutes = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000));
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

export function FocusMode({ onExit }: FocusModeProps) {
  const { state, commit, undo, canUndo, notify } = useCRM();
  const queue = useMemo(() => getQueue(state), [state]);
  const candidate = queue[0] ?? null;
  const lead = candidate?.lead ?? null;
  const [modal, setModal] = useState<ModalKind>(null);
  const [quickNote, setQuickNote] = useState("");
  const [scheduleAt, setScheduleAt] = useState(nextBusinessMorning());
  const [formNote, setFormNote] = useState("");
  const [meetingType, setMeetingType] = useState("Video call");
  const [contactEmail, setContactEmail] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [replacementName, setReplacementName] = useState("");
  const [replacementRole, setReplacementRole] = useState("");
  const [replacementPhone, setReplacementPhone] = useState("");
  const [approver, setApprover] = useState("");
  const [touchType, setTouchType] = useState<PostMeetingTouchType>("phone");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const lastSavedNote = useRef("");
  const activeSession = [...state.sessions].reverse().find((session) => !session.endedAt);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCalls = state.callAttempts.filter((attempt) => !attempt.voidedAt && new Date(attempt.occurredAt) >= todayStart);
  const sessionCalls = activeSession ? state.callAttempts.filter((attempt) => attempt.sessionId === activeSession.id && !attempt.voidedAt) : [];
  const isPostMeeting = !!lead && (lead.pipelineStage === "post_meeting" || ["post_meeting_follow_up", "decision_pending", "proposal_sent"].includes(lead.status));
  const latestMeeting = lead ? [...state.meetings].filter((meeting) => meeting.leadId === lead.id && !meeting.voidedAt).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0] : undefined;
  const latestTouch = lead ? [...state.postMeetingTouches].filter((touch) => touch.leadId === lead.id && !touch.voidedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0] : undefined;
  const recentActivities = lead ? [...state.activities].filter((activity) => activity.leadId === lead.id && !activity.voidedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 5) : [];

  useEffect(() => {
    setQuickNote("");
    lastSavedNote.current = "";
    setContactEmail(lead?.email ?? "");
    setScheduleAt(nextBusinessMorning());
    setFormNote("");
    setLostReason("");
    setReplacementName("");
    setReplacementRole("");
    setReplacementPhone("");
    setApprover("");
    setTouchType("phone");
  }, [lead?.id]);

  const saveQuickNote = () => {
    const value = quickNote.trim();
    if (!lead || !value || value === lastSavedNote.current) return;
    lastSavedNote.current = value;
    commit("Quick note saved", (current) => addNote(current, lead.id, value), "Note autosaved");
  };

  const coldOutcome = (outcome: ColdCallOutcome, extra: Record<string, unknown> = {}, label?: string) => {
    if (!lead) return;
    setModal(null);
    commit(label ?? STATUS_LABELS[lead.status], (current) => applyColdOutcome(current, lead.id, {
      outcome,
      note: formNote.trim() || quickNote.trim(),
      ...extra,
    }), label ?? `${outcome.replaceAll("_", " ")} recorded`);
  };

  const postMeetingOutcome = (outcome: PostMeetingOutcomeKind, extra: Record<string, unknown> = {}, label?: string) => {
    if (!lead) return;
    setModal(null);
    commit(label ?? "Follow-up recorded", (current) => applyPostMeetingOutcome(current, lead.id, {
      outcome,
      touchType,
      note: formNote.trim() || quickNote.trim(),
      ...extra,
    }), label ?? `${outcome.replaceAll("_", " ")} recorded`);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!state.settings.interface.keyboardShortcutsEnabled) return;
      const target = event.target as HTMLElement;
      const typing = target.matches("input, textarea, select, [contenteditable='true']");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (!typing && canUndo) {
          event.preventDefault();
          undo();
        }
        return;
      }
      if (typing || modal || !lead || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        noteRef.current?.focus();
        return;
      }
      const actions: Record<string, () => void> = isPostMeeting ? {
        n: () => postMeetingOutcome("no_answer", {}, "No answer — next touch scheduled"),
        c: () => setModal("pm_callback"),
        m: () => setModal("pm_second_meeting"),
        l: () => setModal("pm_lost"),
        d: () => setModal("pm_dnc"),
      } : {
        n: () => coldOutcome("no_answer", {}, "No answer — retry scheduled"),
        c: () => setModal("callback"),
        m: () => setModal("meeting"),
        i: () => setModal("follow_up"),
        f: () => setModal("follow_up"),
        l: () => setModal("lost"),
        b: () => coldOutcome("bad_number", {}, "Bad number recorded"),
        w: () => setModal("wrong_person"),
        d: () => setModal("dnc"),
      };
      if (actions[key]) {
        event.preventDefault();
        actions[key]();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canUndo, isPostMeeting, lead, modal, quickNote, formNote, state.settings.interface.keyboardShortcutsEnabled, touchType, undo]);

  const finishSession = () => {
    if (activeSession) commit("Session ended", (current) => endSession(current, activeSession.id), "Session summary saved");
    onExit();
  };

  if (!lead) {
    return (
      <div className="focus-shell focus-shell--empty">
        <header className="focus-topbar"><div className="brand brand--compact"><span className="brand__mark"><Icon name="zap" size={19} /></span><strong>Relay</strong></div><Button variant="ghost" onClick={finishSession}>End session</Button></header>
        <main className="focus-empty">
          <EmptyState
            icon={<Icon name="checkCircle" size={32} />}
            title="The call queue is clear"
            description="Every eligible lead has a defined next action. Future callbacks, retries, and follow-ups will enter automatically."
            action={<Button variant="primary" onClick={finishSession}>View session summary</Button>}
            secondaryAction={<Button variant="secondary" onClick={onExit}>Back to queue</Button>}
          />
          <div className="session-summary-grid"><div><strong>{sessionCalls.length}</strong><span>Dials</span></div><div><strong>{sessionCalls.filter((call) => call.meaningfulConversation).length}</strong><span>Conversations</span></div><div><strong>{state.meetings.filter((meeting) => activeSession && meeting.createdAt >= activeSession.startedAt).length}</strong><span>Meetings</span></div><div><strong>{elapsedLabel(activeSession?.startedAt)}</strong><span>Elapsed</span></div></div>
        </main>
      </div>
    );
  }

  const phone = lead.badNumber && lead.mobilePhone ? lead.mobilePhone : lead.directPhone || lead.mobilePhone;
  const maxColdAttempts = lead.coldAttemptCount >= state.settings.calling.maximumInitialAttempts ? state.settings.calling.maximumLifetimeAttempts : state.settings.calling.maximumInitialAttempts;

  return (
    <div className="focus-shell">
      <header className="focus-topbar">
        <div className="brand brand--compact"><span className="brand__mark"><Icon name="zap" size={19} /></span><strong>Relay</strong><Badge tone="success" dot size="sm">Live session</Badge></div>
        <div className="focus-session-stats">
          <span><small>Call</small><strong>{todayCalls.length + 1} / {state.settings.calling.dailyCallGoal}</strong></span>
          <span><small>Elapsed</small><strong>{elapsedLabel(activeSession?.startedAt)}</strong></span>
          <span><small>Calls / hr</small><strong>{activeSession ? Math.round(sessionCalls.length / Math.max(1 / 60, (Date.now() - new Date(activeSession.startedAt).getTime()) / 3_600_000)) : 0}</strong></span>
        </div>
        <div className="focus-topbar__actions">{canUndo ? <Button variant="ghost" size="sm" onClick={undo} startIcon={<Icon name="undo" size={15} />}>Undo</Button> : null}<Button variant="ghost" size="sm" onClick={finishSession} startIcon={<Icon name="stop" size={14} />}>End session</Button></div>
        <Progress className="focus-goal-progress" value={todayCalls.length} max={state.settings.calling.dailyCallGoal} size="sm" />
      </header>

      <main className="focus-main">
        <section className="focus-lead">
          <div className="next-action-banner">
            <span><Icon name={candidate.action.exact ? "callback" : isPostMeeting ? "followUp" : "phone"} size={17} /></span>
            <div><small>Next action</small><strong>{candidate.action.reason}</strong></div>
            <div className="next-action-banner__time"><strong>{candidate.action.exact ? formatDateTime(candidate.action.dueAt) : relativeTime(candidate.action.dueAt)}</strong><small>{candidate.rankReason.join(" · ")}</small></div>
          </div>

          <div className="focus-identity">
            <div>
              <div className="focus-identity__badges"><Badge tone={STATUS_TONES[lead.status] as "info"}>{STATUS_LABELS[lead.status]}</Badge><Badge tone={lead.priority === "critical" ? "danger" : lead.priority === "high" ? "warning" : "neutral"}>{lead.priority} priority</Badge>{isPostMeeting ? <Badge tone="purple" dot>Warm opportunity</Badge> : null}</div>
              <h1>{lead.clinicName}</h1>
              <p><strong>{lead.decisionMakerName || "Decision maker unknown"}</strong><span>{lead.decisionMakerRole || CONTACT_TYPE_LABELS[lead.contactType]}</span></p>
            </div>
            <div className="focus-phone-card">
              <small>{lead.badNumber ? "Alternate number" : "Direct number"}</small>
              <a href={phoneHref(phone)}><Icon name="phone" size={20} /> {phone || "No valid number"}{lead.extension ? ` ext. ${lead.extension}` : ""}</a>
              <div><span><Icon name="location" size={14} /> {lead.city}, {lead.state}</span><span><Icon name="clock" size={14} /> {formatLocalTime(lead.timeZone)}</span></div>
            </div>
          </div>

          {isPostMeeting ? (
            <div className="post-meeting-context">
              <div className="post-meeting-context__header"><span><Icon name="handshake" size={18} /></span><div><small>Meeting held</small><strong>{formatDateTime(latestMeeting?.completedAt ?? latestMeeting?.scheduledAt)}</strong></div><div className="touch-counter"><strong>{lead.postMeetingTouchCount} / {state.settings.followUp.maximumPostMeetingTouches}</strong><small>Post-meeting touches</small></div></div>
              <div className="post-meeting-context__grid">
                <div><small>What they were interested in</small><strong>{latestMeeting?.interestSummary || "Not recorded"}</strong></div>
                <div><small>Main objection</small><strong>{latestMeeting?.mainObjection || "Not recorded"}</strong></div>
                <div><small>Decision status</small><strong>{latestMeeting?.decisionStatus || STATUS_LABELS[lead.status]}</strong></div>
                <div><small>Last follow-up</small><strong>{latestTouch ? `${latestTouch.type} · ${latestTouch.outcome.replaceAll("_", " ")}` : "No touches yet"}</strong></div>
              </div>
              {latestMeeting?.notes ? <p className="meeting-note"><Icon name="note" size={15} /> {latestMeeting.notes}</p> : null}
            </div>
          ) : (
            <div className="finding-card">
              <div className="finding-card__top"><span className="finding-card__icon"><Icon name="shield" size={20} /></span><div><small>Primary finding</small><h2>{lead.primaryFinding || "Research finding not recorded"}</h2></div><span className={cn("finding-strength", `is-${lead.findingStrength.toLowerCase()}`)}><strong>{lead.findingStrength}</strong><small>{lead.findingStrength === "A" ? "Strong" : lead.findingStrength === "B" ? "Good" : "Fallback"}</small></span></div>
              <div className="finding-card__detail"><p><small>Evidence</small>{lead.evidenceNotes || "No supporting evidence added."}</p><p><small>Pitch angle</small>{lead.pitchNotes || "Lead with the primary finding and confirm who owns the decision."}</p></div>
              <div className="finding-card__tags"><Badge tone={lead.pixelPresent === "yes" ? "purple" : "neutral"}>Pixel: {lead.pixelPresent}</Badge>{lead.trackingTechnologies.map((technology) => <Badge key={technology}>{technology}</Badge>)}{lead.securityGrade ? <Badge tone="warning">Grade {lead.securityGrade}</Badge> : null}{lead.websiteUrl ? <a href={lead.websiteUrl} target="_blank" rel="noreferrer"><Icon name="externalLink" size={14} /> Open website</a> : null}</div>
            </div>
          )}

          <div className="counter-pair">
            <div><span><Icon name="phone" size={16} /> Cold call attempts</span><strong>{lead.coldAttemptCount} <small>/ {maxColdAttempts}</small></strong></div>
            <div className={isPostMeeting ? "is-active" : ""}><span><Icon name="followUp" size={16} /> Post-meeting touches</span><strong>{lead.postMeetingTouchCount} <small>/ {state.settings.followUp.maximumPostMeetingTouches}</small></strong></div>
          </div>

          <div className="quick-notes">
            <div className="quick-notes__label"><span><Icon name="note" size={16} /> Quick notes</span><small><kbd>Space</kbd> focus · Autosaves on blur</small></div>
            <textarea ref={noteRef} value={quickNote} onChange={(event) => setQuickNote(event.target.value)} onBlur={saveQuickNote} placeholder="Type what matters from this conversation…" rows={2} />
          </div>

          <OutcomeDock
            postMeeting={isPostMeeting}
            onCold={(outcome) => {
              if (outcome === "no_answer") coldOutcome(outcome, {}, "No answer — retry scheduled");
              else if (outcome === "bad_number") coldOutcome(outcome, {}, "Bad number recorded");
              else if (outcome === "callback") setModal("callback");
              else if (outcome === "meeting_booked") setModal("meeting");
              else if (outcome === "interested" || outcome === "follow_up") setModal("follow_up");
              else if (outcome === "not_interested") setModal("lost");
              else if (outcome === "wrong_person") setModal("wrong_person");
              else if (outcome === "do_not_call") setModal("dnc");
              else setModal("other");
            }}
            onPostMeeting={(outcome) => {
              if (outcome === "no_answer") postMeetingOutcome(outcome, {}, "No answer — next touch scheduled");
              else if (outcome === "still_deciding") setModal("pm_still_deciding");
              else if (outcome === "needs_internal_approval") setModal("pm_approval");
              else if (outcome === "requested_callback") setModal("pm_callback");
              else if (outcome === "second_meeting_booked") setModal("pm_second_meeting");
              else if (outcome === "proposal_sent") setModal("pm_proposal");
              else if (outcome === "won") postMeetingOutcome("won", {}, "Client won — follow-ups stopped");
              else if (outcome === "lost") setModal("pm_lost");
              else setModal("pm_dnc");
            }}
          />
        </section>

        <aside className="focus-context-rail">
          <div className="context-rail__section"><div className="context-rail__header"><span>Previous context</span><Badge size="sm">{recentActivities.length} recent</Badge></div>{lead.lastConversationNotes ? <blockquote>“{lead.lastConversationNotes}”</blockquote> : <p className="muted">No previous conversation notes.</p>}</div>
          <div className="context-rail__section"><div className="context-rail__header"><span>Activity history</span><Icon name="history" size={16} /></div><div className="timeline">{recentActivities.map((activity) => <div className="timeline__item" key={activity.id}><i /><div><time>{formatDateTime(activity.occurredAt)}</time><strong>{activity.title}</strong>{activity.note ? <p>{activity.note}</p> : null}</div></div>)}</div></div>
          <div className="context-rail__section context-rail__contact"><div className="context-rail__header"><span>Contact</span></div><p><Icon name="mail" size={14} /> {lead.email || "No email"}</p><p><Icon name="globe" size={14} /> {lead.websiteDomain || "No website"}</p><p><Icon name="building" size={14} /> {lead.specialty || "Specialty unknown"}</p></div>
        </aside>
      </main>

      <OutcomeModal
        kind={modal}
        onClose={() => setModal(null)}
        scheduleAt={scheduleAt}
        setScheduleAt={setScheduleAt}
        note={formNote}
        setNote={setFormNote}
        meetingType={meetingType}
        setMeetingType={setMeetingType}
        contactEmail={contactEmail}
        setContactEmail={setContactEmail}
        lostReason={lostReason}
        setLostReason={setLostReason}
        replacementName={replacementName}
        setReplacementName={setReplacementName}
        replacementRole={replacementRole}
        setReplacementRole={setReplacementRole}
        replacementPhone={replacementPhone}
        setReplacementPhone={setReplacementPhone}
        approver={approver}
        setApprover={setApprover}
        touchType={touchType}
        setTouchType={setTouchType}
        submit={() => {
          const iso = scheduleAt ? new Date(scheduleAt).toISOString() : undefined;
          if (modal === "callback") coldOutcome("callback", { callbackAt: iso }, "Callback scheduled");
          if (modal === "follow_up") coldOutcome("interested", { followUpAt: iso }, "Interested follow-up scheduled");
          if (modal === "meeting") coldOutcome("meeting_booked", { meetingAt: iso, meetingType, contactEmail }, "Meeting booked");
          if (modal === "lost") coldOutcome("not_interested", { lostReason }, "Lead moved to Lost");
          if (modal === "dnc") coldOutcome("do_not_call", {}, "Do Not Call protection enabled");
          if (modal === "wrong_person") coldOutcome("wrong_person", { replacementName, replacementRole, replacementPhone }, "Contact updated");
          if (modal === "other") coldOutcome("other", { nextActionAt: iso }, "Custom outcome saved");
          if (modal === "pm_still_deciding") postMeetingOutcome("still_deciding", { nextAt: iso }, "Still deciding — follow-up scheduled");
          if (modal === "pm_approval") postMeetingOutcome("needs_internal_approval", { approver, nextAt: iso }, "Internal approval follow-up scheduled");
          if (modal === "pm_callback") postMeetingOutcome("requested_callback", { callbackAt: iso }, "Exact callback scheduled");
          if (modal === "pm_second_meeting") postMeetingOutcome("second_meeting_booked", { secondMeetingAt: iso, secondMeetingType: meetingType }, "Second meeting booked");
          if (modal === "pm_proposal") postMeetingOutcome("proposal_sent", { nextAt: iso }, "Proposal sent — decision follow-up scheduled");
          if (modal === "pm_lost") postMeetingOutcome("lost", { lostReason }, "Opportunity moved to Lost");
          if (modal === "pm_dnc") postMeetingOutcome("do_not_contact", {}, "Do Not Contact protection enabled");
        }}
      />
    </div>
  );
}

function OutcomeDock({ postMeeting, onCold, onPostMeeting }: { postMeeting: boolean; onCold: (outcome: ColdCallOutcome) => void; onPostMeeting: (outcome: PostMeetingOutcomeKind) => void }) {
  const cold: Array<{ outcome: ColdCallOutcome; label: string; key?: string; icon: string; tone?: string }> = [
    { outcome: "no_answer", label: "No answer", key: "N", icon: "phone" },
    { outcome: "callback", label: "Callback", key: "C", icon: "callback" },
    { outcome: "interested", label: "Interested", key: "I", icon: "activity", tone: "purple" },
    { outcome: "meeting_booked", label: "Meeting booked", key: "M", icon: "calendar", tone: "success" },
    { outcome: "not_interested", label: "Not interested", key: "L", icon: "lost" },
    { outcome: "wrong_person", label: "Wrong person", key: "W", icon: "user" },
    { outcome: "bad_number", label: "Bad number", key: "B", icon: "badNumber" },
    { outcome: "do_not_call", label: "Do not call", key: "D", icon: "lock", tone: "danger" },
    { outcome: "other", label: "Other", icon: "more" },
  ];
  const warm: Array<{ outcome: PostMeetingOutcomeKind; label: string; key?: string; icon: string; tone?: string }> = [
    { outcome: "no_answer", label: "No answer", key: "N", icon: "phone" },
    { outcome: "still_deciding", label: "Still deciding", icon: "clock", tone: "purple" },
    { outcome: "needs_internal_approval", label: "Needs approval", icon: "users" },
    { outcome: "requested_callback", label: "Callback", key: "C", icon: "callback" },
    { outcome: "second_meeting_booked", label: "Second meeting", key: "M", icon: "calendar", tone: "purple" },
    { outcome: "proposal_sent", label: "Proposal sent", icon: "file", tone: "purple" },
    { outcome: "won", label: "Won", icon: "won", tone: "success" },
    { outcome: "lost", label: "Lost", key: "L", icon: "lost" },
    { outcome: "do_not_contact", label: "Do not contact", key: "D", icon: "lock", tone: "danger" },
  ];
  const actions = postMeeting ? warm : cold;
  return <div className={cn("outcome-dock", postMeeting && "outcome-dock--warm")}><div className="outcome-dock__label"><span>{postMeeting ? "Record follow-up outcome" : "Record call outcome"}</span><small>One action saves everything and loads the next lead</small></div><div className="outcome-grid">{actions.map((action) => <button key={action.outcome} className={cn("outcome-button", action.tone && `is-${action.tone}`)} onClick={() => postMeeting ? onPostMeeting(action.outcome as PostMeetingOutcomeKind) : onCold(action.outcome as ColdCallOutcome)}><span><Icon name={action.icon} size={19} /></span><strong>{action.label}</strong>{action.key ? <kbd>{action.key}</kbd> : null}</button>)}</div></div>;
}

interface OutcomeModalProps {
  kind: ModalKind;
  onClose: () => void;
  submit: () => void;
  scheduleAt: string;
  setScheduleAt: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  meetingType: string;
  setMeetingType: (value: string) => void;
  contactEmail: string;
  setContactEmail: (value: string) => void;
  lostReason: string;
  setLostReason: (value: string) => void;
  replacementName: string;
  setReplacementName: (value: string) => void;
  replacementRole: string;
  setReplacementRole: (value: string) => void;
  replacementPhone: string;
  setReplacementPhone: (value: string) => void;
  approver: string;
  setApprover: (value: string) => void;
  touchType: PostMeetingTouchType;
  setTouchType: (value: PostMeetingTouchType) => void;
}

function OutcomeModal(props: OutcomeModalProps) {
  const { kind } = props;
  if (!kind) return null;
  const isDnc = kind === "dnc" || kind === "pm_dnc";
  const isLost = kind === "lost" || kind === "pm_lost";
  const isMeeting = kind === "meeting" || kind === "pm_second_meeting";
  const isWrong = kind === "wrong_person";
  const isApproval = kind === "pm_approval";
  const isWarm = kind.startsWith("pm_");
  const titles: Record<Exclude<ModalKind, null>, string> = {
    callback: "Schedule exact callback",
    follow_up: "Schedule interested follow-up",
    meeting: "Book the meeting",
    lost: "Close as not interested",
    dnc: "Enable Do Not Call protection?",
    wrong_person: "Update the decision maker",
    other: "Record another outcome",
    pm_still_deciding: "Still deciding",
    pm_approval: "Internal approval needed",
    pm_callback: "Schedule exact callback",
    pm_second_meeting: "Book a second meeting",
    pm_proposal: "Proposal / agreement sent",
    pm_lost: "Close this opportunity",
    pm_dnc: "Stop all future contact?",
  };
  const requiresSchedule = !isDnc && !isLost && !isWrong;
  return (
    <Modal
      open
      onClose={props.onClose}
      title={titles[kind]}
      description={isDnc ? "This overrides every callback, retry, recycle, and follow-up. One confirmation is required." : isLost ? "The full journey remains available in history." : "Keep it quick — the next lead loads immediately after saving."}
      size="sm"
      footer={<><Button variant="ghost" onClick={props.onClose}>Cancel</Button><Button variant={isDnc ? "danger" : isLost ? "secondary" : "primary"} onClick={props.submit} disabled={requiresSchedule && !props.scheduleAt}>{isDnc ? "Stop future contact" : isLost ? "Move to Lost" : "Save & next lead"}</Button></>}
    >
      <div className="form-stack">
        {isWarm && !isDnc && <label className="field"><span>Touch type</span><select value={props.touchType} onChange={(event) => props.setTouchType(event.target.value as PostMeetingTouchType)}><option value="phone">Phone call</option><option value="email">Email</option><option value="callback">Scheduled callback</option><option value="other">Other agreed method</option></select></label>}
        {requiresSchedule ? <label className="field"><span>{isMeeting ? "Meeting date & time" : kind.includes("callback") ? "Exact callback date & time" : "Next action date & time"}</span><input type="datetime-local" value={props.scheduleAt} onChange={(event) => props.setScheduleAt(event.target.value)} required /><small>{kind.includes("callback") ? "Prospect-requested time overrides the automatic cadence." : "The default cadence uses business days."}</small></label> : null}
        {isMeeting ? <><label className="field"><span>Meeting type</span><select value={props.meetingType} onChange={(event) => props.setMeetingType(event.target.value)}><option>Video call</option><option>Phone call</option><option>In person</option><option>Other</option></select></label>{kind === "meeting" ? <label className="field"><span>Contact email</span><input type="email" value={props.contactEmail} onChange={(event) => props.setContactEmail(event.target.value)} placeholder="name@clinic.com" /></label> : null}</> : null}
        {isLost ? <label className="field"><span>Lost reason <small>Optional</small></span><select value={props.lostReason} onChange={(event) => props.setLostReason(event.target.value)}><option value="">No reason selected</option>{LOST_REASONS.map((reason) => <option key={reason}>{reason}</option>)}</select></label> : null}
        {isWrong ? <><div className="form-callout"><Icon name="info" size={17} /><span>The clinic stays active. Add the correct contact if the prospect provided one.</span></div><label className="field"><span>Correct contact name</span><input value={props.replacementName} onChange={(event) => props.setReplacementName(event.target.value)} /></label><label className="field"><span>Role</span><input value={props.replacementRole} onChange={(event) => props.setReplacementRole(event.target.value)} /></label><label className="field"><span>Direct phone</span><input value={props.replacementPhone} onChange={(event) => props.setReplacementPhone(event.target.value)} /></label></> : null}
        {isApproval ? <label className="field"><span>Who needs to approve?</span><input value={props.approver} onChange={(event) => props.setApprover(event.target.value)} placeholder="Owner, board, finance…" /></label> : null}
        {!isDnc && !isWrong ? <label className="field"><span>Note <small>Optional</small></span><textarea value={props.note} onChange={(event) => props.setNote(event.target.value)} rows={3} placeholder="What should be remembered next time?" /></label> : null}
        {isDnc ? <div className="danger-callout"><Icon name="lock" size={20} /><div><strong>Permanent queue exclusion</strong><p>The lead remains in history but cannot be automatically called again.</p></div></div> : null}
      </div>
    </Modal>
  );
}
