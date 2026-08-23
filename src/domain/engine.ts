import { createEmptyState, TERMINAL_STATUSES } from "../data/defaults";
import type {
  Activity,
  AnalyticsDimensionRow,
  AnalyticsOptions,
  AnalyticsSummary,
  AttemptPerformanceRow,
  CRMState,
  CallAttempt,
  CallingSession,
  ColdCallOutcome,
  ColdOutcomeInput,
  DomainInvariantViolation,
  ImportBatch,
  ISODateTime,
  Lead,
  LeadImportInput,
  Meeting,
  MeetingOutcomeInput,
  NextAction,
  PostMeetingOutcomeInput,
  PostMeetingTouch,
  QueueCandidate,
  QueueClass,
  UndoEntry,
} from "../types";

const DAY_MS = 86_400_000;
const MAX_UNDO_ENTRIES = 25;

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

function asIso(value?: string | Date): ISODateTime {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new DomainError(`Invalid date: ${String(value)}`);
  return date.toISOString();
}

function beginDraft(state: CRMState, at: ISODateTime): CRMState {
  return {
    ...state,
    revision: state.revision + 1,
    leads: [...state.leads],
    activities: [...state.activities],
    callAttempts: [...state.callAttempts],
    meetings: [...state.meetings],
    postMeetingTouches: [...state.postMeetingTouches],
    sessions: [...state.sessions],
    batches: [...state.batches],
    undoStack: [...state.undoStack],
    updatedAt: at,
  };
}

function allocateId(draft: CRMState, prefix: string): string {
  const id = `${prefix}_${String(draft.nextSequence).padStart(6, "0")}`;
  draft.nextSequence += 1;
  return id;
}

function requireLead(state: CRMState, leadId: string): { lead: Lead; index: number } {
  const index = state.leads.findIndex((lead) => lead.id === leadId);
  if (index < 0) throw new DomainError(`Lead ${leadId} was not found`);
  return { lead: state.leads[index], index };
}

function replaceLead(draft: CRMState, index: number, lead: Lead): void {
  draft.leads[index] = lead;
}

function appendActivity(
  draft: CRMState,
  input: Omit<Activity, "id" | "voidedAt">,
): Activity {
  const activity: Activity = {
    ...input,
    id: allocateId(draft, "activity"),
    voidedAt: null,
  };
  draft.activities.push(activity);
  return activity;
}

function appendStatusActivity(
  draft: CRMState,
  lead: Lead,
  at: ISODateTime,
  note = "",
): Activity {
  return appendActivity(draft, {
    leadId: lead.id,
    type: "status_changed",
    occurredAt: at,
    title: `Status: ${lead.status.replaceAll("_", " ")}`,
    note,
    metadata: { status: lead.status, pipelineStage: lead.pipelineStage },
  });
}

function pushUndo(draft: CRMState, entry: UndoEntry): void {
  draft.undoStack.push(entry);
  if (draft.undoStack.length > MAX_UNDO_ENTRIES) {
    draft.undoStack = draft.undoStack.slice(-MAX_UNDO_ENTRIES);
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    }
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function getZonedParts(instant: ISODateTime, timeZone: string): ZonedParts {
  const values: Record<string, number> = {};
  for (const part of zonedFormatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function localPartsToUtc(parts: ZonedParts, timeZone: string): ISODateTime {
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let guess = desired;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const observed = getZonedParts(new Date(guess).toISOString(), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const correction = desired - observedAsUtc;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess).toISOString();
}

function dateKey(parts: Pick<ZonedParts, "year" | "month" | "day">): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseClock(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) throw new DomainError(`Invalid clock time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new DomainError(`Invalid clock time: ${value}`);
  return { hour, minute };
}

function dayOfWeek(parts: Pick<ZonedParts, "year" | "month" | "day">): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export interface BusinessDayOptions {
  time?: string;
  weekdays?: number[];
  holidays?: string[];
}

export function addBusinessDays(
  from: ISODateTime,
  businessDays: number,
  timeZone: string,
  options: BusinessDayOptions = {},
): ISODateTime {
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new DomainError("businessDays must be a non-negative integer");
  }
  const weekdays = options.weekdays ?? [1, 2, 3, 4, 5];
  const holidays = new Set(options.holidays ?? []);
  const start = getZonedParts(asIso(from), timeZone);
  const localDate = new Date(Date.UTC(start.year, start.month - 1, start.day));
  let accepted = 0;
  while (accepted < businessDays) {
    localDate.setUTCDate(localDate.getUTCDate() + 1);
    const parts = {
      year: localDate.getUTCFullYear(),
      month: localDate.getUTCMonth() + 1,
      day: localDate.getUTCDate(),
    };
    if (weekdays.includes(localDate.getUTCDay()) && !holidays.has(dateKey(parts))) {
      accepted += 1;
    }
  }

  const requestedTime = options.time ? parseClock(options.time) : start;
  return localPartsToUtc(
    {
      year: localDate.getUTCFullYear(),
      month: localDate.getUTCMonth() + 1,
      day: localDate.getUTCDate(),
      hour: requestedTime.hour,
      minute: requestedTime.minute,
      second: 0,
    },
    timeZone,
  );
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function automaticDueAt(
  state: CRMState,
  lead: Lead,
  from: ISODateTime,
  businessDays: number,
  salt: string,
): ISODateTime {
  const buckets = state.settings.calling.retryTimeBuckets;
  const fallback = state.settings.calling.callingHoursStart;
  let bucket = buckets.length > 0 ? buckets[stableHash(`${lead.id}:${salt}`) % buckets.length] : fallback;
  if (lead.lastCalledAt && buckets.length > 1) {
    const previous = getZonedParts(lead.lastCalledAt, lead.timeZone);
    const previousClock = `${String(previous.hour).padStart(2, "0")}:${String(previous.minute).padStart(2, "0")}`;
    if (bucket === previousClock) {
      const currentIndex = buckets.indexOf(bucket);
      bucket = buckets[(currentIndex + 1) % buckets.length];
    }
  }
  return addBusinessDays(from, businessDays, lead.timeZone, {
    time: bucket,
    weekdays: state.settings.calling.callingWeekdays,
    holidays: state.settings.calling.holidayDates,
  });
}

function makeAction(
  draft: CRMState,
  lead: Lead,
  at: ISODateTime,
  input: Omit<NextAction, "id" | "leadId" | "createdAt" | "scheduleTimeZone">,
): NextAction {
  return {
    ...input,
    id: allocateId(draft, "action"),
    leadId: lead.id,
    createdAt: at,
    scheduleTimeZone: lead.timeZone,
  };
}

function hasCallableNumber(lead: Lead): boolean {
  return Boolean(lead.directPhone.trim() || lead.mobilePhone.trim() || lead.alternatePhones.length > 0);
}

function isWithinCallingHours(state: CRMState, lead: Lead, now: ISODateTime): boolean {
  const local = getZonedParts(now, lead.timeZone);
  const currentMinutes = local.hour * 60 + local.minute;
  const start = parseClock(state.settings.calling.callingHoursStart);
  const end = parseClock(state.settings.calling.callingHoursEnd);
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  return (
    state.settings.calling.callingWeekdays.includes(dayOfWeek(local)) &&
    !state.settings.calling.holidayDates.includes(dateKey(local)) &&
    currentMinutes >= startMinutes &&
    currentMinutes <= endMinutes
  );
}

function localTimeLabel(now: ISODateTime, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(now));
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(now));
  }
}

function queuePriorityScore(state: CRMState, lead: Lead): { score: number; reasons: string[] } {
  const settings = state.settings.queue;
  let score = settings.manualPriority[lead.priority];
  const reasons = [`${lead.priority} manual priority`];
  const strength = settings.findingStrengthPriority[lead.findingStrength];
  if (strength > 0) {
    score += strength;
    reasons.push(`finding ${lead.findingStrength} +${strength}`);
  }
  if (lead.pixelPresent === "yes" && settings.pixelPriority > 0) {
    score += settings.pixelPriority;
    reasons.push(`pixel +${settings.pixelPriority}`);
  }
  if (lead.contactType === "owner" && settings.ownerPriority > 0) {
    score += settings.ownerPriority;
    reasons.push(`owner +${settings.ownerPriority}`);
  }
  return { score, reasons };
}

export function getQueue(
  state: CRMState,
  now: ISODateTime | Date = new Date(),
): QueueCandidate[] {
  const at = asIso(now);
  const atMs = new Date(at).getTime();
  const candidates: QueueCandidate[] = [];

  for (const lead of state.leads) {
    const action = lead.nextAction;
    if (
      !action ||
      !action.queueEligible ||
      action.queueClass === "non_call" ||
      TERMINAL_STATUSES.has(lead.status) ||
      lead.doNotCall ||
      !hasCallableNumber(lead) ||
      new Date(action.dueAt).getTime() > atMs
    ) {
      continue;
    }
    const exactOverride =
      action.exact &&
      action.queueClass === "exact_callback" &&
      state.settings.calling.exactCallbacksOverrideCallingHours;
    if (!exactOverride && !isWithinCallingHours(state, lead, at)) continue;

    const classRank = state.settings.queue.classOrder.indexOf(action.queueClass);
    if (classRank < 0) continue;
    const priority = queuePriorityScore(state, lead);
    candidates.push({
      lead,
      action,
      classRank,
      priorityScore: priority.score,
      overdueMinutes: Math.max(0, Math.floor((atMs - new Date(action.dueAt).getTime()) / 60_000)),
      prospectLocalTime: localTimeLabel(at, lead.timeZone),
      rankReason: [action.queueClass.replaceAll("_", " "), ...priority.reasons],
    });
  }

  return candidates.sort(
    (left, right) =>
      left.classRank - right.classRank ||
      right.overdueMinutes - left.overdueMinutes ||
      right.priorityScore - left.priorityScore ||
      new Date(left.action.dueAt).getTime() - new Date(right.action.dueAt).getTime() ||
      left.lead.id.localeCompare(right.lead.id),
  );
}

export function getNextLead(
  state: CRMState,
  now: ISODateTime | Date = new Date(),
): QueueCandidate | null {
  return getQueue(state, now)[0] ?? null;
}

function normalizeDomain(value: string): string {
  if (!value.trim()) return "";
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

export function findDuplicateLeadIds(state: CRMState, input: LeadImportInput): string[] {
  const domain = normalizeDomain(input.websiteUrl ?? "");
  const phone = normalizePhone(input.directPhone ?? input.mobilePhone ?? "");
  const name = input.clinicName.trim().toLowerCase();
  const city = (input.city ?? "").trim().toLowerCase();
  return state.leads
    .filter((lead) => {
      const sameDomain = Boolean(domain && lead.websiteDomain === domain);
      const leadPhones = [lead.directPhone, lead.mobilePhone, ...lead.alternatePhones].map(normalizePhone);
      const samePhone = Boolean(phone && leadPhones.includes(phone));
      const sameNameAndPlace =
        Boolean(name && city) &&
        lead.clinicName.trim().toLowerCase() === name &&
        lead.city.trim().toLowerCase() === city;
      return sameDomain || samePhone || sameNameAndPlace;
    })
    .map((lead) => lead.id);
}

export interface ImportLeadsOptions {
  batchName?: string;
  source?: string;
  fileName?: string;
  duplicateStrategy?: "keep" | "skip";
}

export function importLeads(
  state: CRMState,
  inputs: LeadImportInput[],
  options: ImportLeadsOptions = {},
  now: ISODateTime | Date = new Date(),
): CRMState {
  const at = asIso(now);
  const draft = beginDraft(state, at);
  const batchId = allocateId(draft, "batch");
  let importedCount = 0;
  let duplicateCount = 0;
  let skippedCount = 0;

  for (const input of inputs) {
    if (!input.clinicName?.trim()) {
      skippedCount += 1;
      continue;
    }
    const duplicateIds = findDuplicateLeadIds(draft, input);
    if (duplicateIds.length > 0) {
      duplicateCount += 1;
      if (options.duplicateStrategy === "skip") {
        skippedCount += 1;
        continue;
      }
    }

    const id = allocateId(draft, "lead");
    const callable = Boolean(
      input.directPhone?.trim() || input.mobilePhone?.trim() || input.alternatePhones?.length,
    );
    const leadBase: Lead = {
      id,
      clinicName: input.clinicName.trim(),
      websiteUrl: input.websiteUrl ?? "",
      websiteDomain: normalizeDomain(input.websiteUrl ?? ""),
      city: input.city ?? "",
      state: input.state ?? "",
      timeZone: input.timeZone ?? state.settings.defaultLeadTimeZone,
      specialty: input.specialty ?? "",
      practiceSize: input.practiceSize ?? "",
      decisionMakerName: input.decisionMakerName ?? "",
      decisionMakerRole: input.decisionMakerRole ?? "",
      contactType: input.contactType ?? "unknown",
      directPhone: input.directPhone ?? "",
      mobilePhone: input.mobilePhone ?? "",
      extension: input.extension ?? "",
      email: input.email ?? "",
      alternatePhones: [...(input.alternatePhones ?? [])],
      pixelPresent: input.pixelPresent ?? "unknown",
      trackingTechnologies: [...(input.trackingTechnologies ?? [])],
      primaryFinding: input.primaryFinding ?? "",
      secondaryFinding: input.secondaryFinding ?? "",
      findingCategory: input.findingCategory ?? "Other",
      findingStrength: input.findingStrength ?? "unknown",
      evidenceNotes: input.evidenceNotes ?? "",
      pitchNotes: input.pitchNotes ?? "",
      securityGrade: input.securityGrade ?? "",
      researchCompleted: input.researchCompleted ?? false,
      status: callable ? "new" : "contact_data_required",
      pipelineStage: "cold",
      priority: input.priority ?? "normal",
      coldAttemptCount: 0,
      coldNoAnswerCount: 0,
      recycleCycle: 0,
      postMeetingTouchCount: 0,
      firstCalledAt: null,
      lastCalledAt: null,
      lastOutcome: "",
      lastConversationNotes: input.lastConversationNotes ?? "",
      callbackAt: null,
      followUpAt: null,
      nextAction: null,
      lostReason: input.lostReason ?? "",
      doNotCall: false,
      badNumber: false,
      importedAt: at,
      batchId,
      assignedCaller: input.assignedCaller ?? "",
      createdAt: at,
      updatedAt: at,
      revision: 1,
    };
    const nextAction = makeAction(draft, leadBase, at, {
      type: callable ? "cold_call" : "contact_data_correction",
      dueAt: at,
      exact: false,
      queueClass: callable ? "new_cold" : "non_call",
      queueEligible: callable,
      reason: callable ? "Imported and ready to call" : "A valid phone number is required",
    });
    const lead = { ...leadBase, nextAction };
    draft.leads.push(lead);
    appendActivity(draft, {
      leadId: id,
      type: "lead_imported",
      occurredAt: at,
      title: "Lead imported",
      note: duplicateIds.length ? `Possible duplicate of ${duplicateIds.join(", ")}` : "",
      metadata: { batchId, possibleDuplicate: duplicateIds.length > 0 },
    });
    importedCount += 1;
  }

  const batch: ImportBatch = {
    id: batchId,
    name: options.batchName ?? `Import ${new Date(at).toLocaleDateString("en-US")}`,
    source: options.source ?? "Manual import",
    fileName: options.fileName ?? "",
    importedAt: at,
    rowCount: inputs.length,
    importedCount,
    duplicateCount,
    skippedCount,
  };
  draft.batches.push(batch);
  return draft;
}

export function addNote(
  state: CRMState,
  leadId: string,
  note: string,
  now: ISODateTime | Date = new Date(),
): CRMState {
  const trimmed = note.trim();
  if (!trimmed) return state;
  const at = asIso(now);
  const draft = beginDraft(state, at);
  const { lead, index } = requireLead(draft, leadId);
  const activity = appendActivity(draft, {
    leadId,
    type: "note",
    occurredAt: at,
    title: "Note added",
    note: trimmed,
    metadata: {},
  });
  replaceLead(draft, index, {
    ...lead,
    lastConversationNotes: trimmed,
    updatedAt: at,
    revision: lead.revision + 1,
  });
  pushUndo(draft, {
    id: allocateId(draft, "undo"),
    label: "Add note",
    createdAt: at,
    leadBefore: lead,
    meetingBefore: null,
    createdActivityIds: [activity.id],
    createdCallAttemptIds: [],
    createdMeetingIds: [],
    createdTouchIds: [],
  });
  return draft;
}

export type LeadPatch = Partial<
  Omit<
    Lead,
    | "id"
    | "createdAt"
    | "importedAt"
    | "coldAttemptCount"
    | "coldNoAnswerCount"
    | "postMeetingTouchCount"
    | "nextAction"
    | "revision"
  >
>;

export function updateLead(
  state: CRMState,
  leadId: string,
  patch: LeadPatch,
  now: ISODateTime | Date = new Date(),
): CRMState {
  const at = asIso(now);
  const draft = beginDraft(state, at);
  const { lead, index } = requireLead(draft, leadId);
  let updated: Lead = {
    ...lead,
    ...patch,
    id: lead.id,
    websiteDomain:
      patch.websiteUrl === undefined ? lead.websiteDomain : normalizeDomain(patch.websiteUrl),
    alternatePhones:
      patch.alternatePhones === undefined ? lead.alternatePhones : [...patch.alternatePhones],
    trackingTechnologies:
      patch.trackingTechnologies === undefined
        ? lead.trackingTechnologies
        : [...patch.trackingTechnologies],
    updatedAt: at,
    revision: lead.revision + 1,
  };

  if (patch.doNotCall) {
    updated = {
      ...updated,
      status: "do_not_call",
      pipelineStage: "closed",
      nextAction: null,
      callbackAt: null,
      followUpAt: null,
      doNotCall: true,
    };
  } else if (lead.status === "contact_data_required" && hasCallableNumber(updated)) {
    updated = {
      ...updated,
      status: "new",
      badNumber: false,
      nextAction: makeAction(draft, updated, at, {
        type: "cold_call",
        dueAt: at,
        exact: false,
        queueClass: "new_cold",
        queueEligible: true,
        reason: "Contact data corrected",
      }),
    };
  }

  replaceLead(draft, index, updated);
  const activity = appendActivity(draft, {
    leadId,
    type: "lead_updated",
    occurredAt: at,
    title: "Lead updated",
    note: "",
    metadata: { fields: Object.keys(patch).join(", ") },
  });
  pushUndo(draft, {
    id: allocateId(draft, "undo"),
    label: "Update lead",
    createdAt: at,
    leadBefore: lead,
    meetingBefore: null,
    createdActivityIds: [activity.id],
    createdCallAttemptIds: [],
    createdMeetingIds: [],
    createdTouchIds: [],
  });
  return draft;
}

function callContextForLead(lead: Lead): CallAttempt["context"] {
  switch (lead.nextAction?.type) {
    case "cold_retry":
      return "cold_retry";
    case "recycled_call":
      return "recycled";
    case "callback":
      return "callback";
    case "interested_follow_up":
      return "interested_follow_up";
    case "post_meeting_follow_up":
      return "post_meeting";
    default:
      return "cold";
  }
}

function isColdContext(context: CallAttempt["context"]): boolean {
  return context === "cold" || context === "cold_retry" || context === "recycled";
}

function attemptFlags(outcome: ColdCallOutcome): { answered: boolean; meaningful: boolean } {
  switch (outcome) {
    case "no_answer":
    case "bad_number":
      return { answered: false, meaningful: false };
    case "wrong_person":
      return { answered: true, meaningful: false };
    case "other":
      return { answered: true, meaningful: false };
    default:
      return { answered: true, meaningful: true };
  }
}

function currentSessionId(state: CRMState): string | null {
  return [...state.sessions].reverse().find((session) => session.endedAt === null)?.id ?? null;
}

function advanceActiveSession(draft: CRMState, now: ISODateTime): void {
  const sessionIndex = draft.sessions.findIndex((session) => session.endedAt === null);
  if (sessionIndex < 0) return;
  const next = getNextLead(draft, now);
  draft.sessions[sessionIndex] = {
    ...draft.sessions[sessionIndex],
    currentLeadId: next?.lead.id ?? null,
  };
}

function isHighValue(state: CRMState, lead: Lead): boolean {
  return (
    lead.priority === "critical" ||
    lead.priority === "high" ||
    lead.findingStrength === "A" ||
    lead.pixelPresent === "yes" ||
    lead.contactType === "owner" ||
    queuePriorityScore(state, lead).score >= 200
  );
}

function requireInputDate(value: string | undefined, label: string): ISODateTime {
  if (!value) throw new DomainError(`${label} is required`);
  return asIso(value);
}

function createMeeting(
  draft: CRMState,
  lead: Lead,
  at: ISODateTime,
  scheduledAt: ISODateTime,
  input: {
    meetingType?: string;
    durationMinutes?: number;
    contactEmail?: string;
    notes?: string;
  },
): Meeting {
  const meeting: Meeting = {
    id: allocateId(draft, "meeting"),
    leadId: lead.id,
    scheduledAt,
    durationMinutes: input.durationMinutes ?? draft.settings.meetings.defaultDurationMinutes,
    meetingType: input.meetingType ?? "Discovery call",
    contactEmail: input.contactEmail ?? lead.email,
    status: "booked",
    outcome: null,
    notes: input.notes ?? "",
    interestSummary: "",
    mainObjection: "",
    decisionStatus: "",
    completedAt: null,
    createdAt: at,
    updatedAt: at,
    voidedAt: null,
  };
  draft.meetings.push(meeting);
  return meeting;
}

function scheduleWarmFollowUp(
  draft: CRMState,
  lead: Lead,
  at: ISODateTime,
  dueAt: ISODateTime,
  reason: string,
  exact = false,
): NextAction {
  return makeAction(draft, lead, at, {
    type: "interested_follow_up",
    dueAt,
    exact,
    queueClass: "interested_follow_up",
    queueEligible: true,
    reason,
  });
}

export function applyColdOutcome(
  state: CRMState,
  leadId: string,
  input: ColdOutcomeInput,
  now: ISODateTime | Date = new Date(),
): CRMState {
  const allowedOutcomes: ColdCallOutcome[] = [
    "no_answer",
    "callback",
    "meeting_booked",
    "interested",
    "follow_up",
    "not_interested",
    "do_not_call",
    "wrong_person",
    "bad_number",
    "other",
  ];
  if (!allowedOutcomes.includes(input.outcome)) throw new DomainError("A valid call outcome is required");
  const at = asIso(now);
  const draft = beginDraft(state, at);
  const { lead, index } = requireLead(draft, leadId);
  if (TERMINAL_STATUSES.has(lead.status) || lead.doNotCall) {
    throw new DomainError("A terminal or do-not-contact lead cannot receive a call outcome");
  }
  if (lead.pipelineStage === "post_meeting") {
    throw new DomainError("Use applyPostMeetingOutcome for a post-meeting follow-up");
  }

  const context = callContextForLead(lead);
  const coldContext = isColdContext(context);
  const coldAttemptCount = lead.coldAttemptCount + (coldContext ? 1 : 0);
  const coldNoAnswerCount =
    lead.coldNoAnswerCount + (coldContext && input.outcome === "no_answer" ? 1 : 0);
  const flags = attemptFlags(input.outcome);
  const sessionId = currentSessionId(draft);
  const attempt: CallAttempt = {
    id: allocateId(draft, "call"),
    leadId,
    sessionId,
    occurredAt: at,
    context,
    outcome: input.outcome,
    coldAttemptNumber: coldContext ? coldAttemptCount : null,
    coldNoAnswerNumber:
      coldContext && input.outcome === "no_answer" ? coldNoAnswerCount : null,
    postMeetingTouchNumber: null,
    answered: flags.answered,
    meaningfulConversation: flags.meaningful,
    note: input.note?.trim() ?? "",
    durationSeconds: input.durationSeconds ?? null,
    batchIdSnapshot: lead.batchId,
    contactTypeSnapshot: lead.contactType,
    pixelPresentSnapshot: lead.pixelPresent,
    findingCategorySnapshot: lead.findingCategory,
    findingStrengthSnapshot: lead.findingStrength,
    voidedAt: null,
  };
  draft.callAttempts.push(attempt);

  let updated: Lead = {
    ...lead,
    coldAttemptCount,
    coldNoAnswerCount,
    firstCalledAt: lead.firstCalledAt ?? at,
    lastCalledAt: at,
    lastOutcome: input.outcome,
    lastConversationNotes: input.note?.trim() || lead.lastConversationNotes,
    callbackAt: null,
    followUpAt: null,
    nextAction: null,
    updatedAt: at,
    revision: lead.revision + 1,
  };
  const createdMeetingIds: string[] = [];
  const createdActivityIds: string[] = [];

  switch (input.outcome) {
    case "no_answer": {
      if (!coldContext) {
        const dueAt = automaticDueAt(
          draft,
          updated,
          at,
          draft.settings.calling.defaultRetryDelayBusinessDays,
          `warm-no-answer:${updated.coldAttemptCount}`,
        );
        updated = {
          ...updated,
          status: "conversation_follow_up",
          pipelineStage: "engaged",
          followUpAt: dueAt,
          nextAction: scheduleWarmFollowUp(
            draft,
            updated,
            at,
            dueAt,
            "No answer on a warm follow-up; retry scheduled",
          ),
        };
        break;
      }

      const initialMaximum = Math.max(1, draft.settings.calling.maximumInitialAttempts);
      const lifetimeMaximum = Math.max(initialMaximum, draft.settings.calling.maximumLifetimeAttempts);
      if (coldNoAnswerCount < initialMaximum) {
        const delays = draft.settings.calling.retryDelaysBusinessDays;
        const delay =
          delays[Math.max(0, coldNoAnswerCount - 1)] ??
          draft.settings.calling.defaultRetryDelayBusinessDays;
        const dueAt = automaticDueAt(draft, updated, at, delay, `retry:${coldNoAnswerCount}`);
        updated = {
          ...updated,
          status: "retry_scheduled",
          nextAction: makeAction(draft, updated, at, {
            type: "cold_retry",
            dueAt,
            exact: false,
            queueClass: "cold_retry",
            queueEligible: true,
            reason: `No answer attempt ${coldNoAnswerCount}; automatic retry`,
          }),
        };
      } else if (coldNoAnswerCount === initialMaximum && coldNoAnswerCount < lifetimeMaximum) {
        const dueAt = automaticDueAt(
          draft,
          updated,
          at,
          draft.settings.calling.recycleDelayBusinessDays,
          `recycle:${updated.recycleCycle + 1}`,
        );
        const eligible =
          !draft.settings.calling.highValueExtendedAttemptsOnly || isHighValue(draft, updated);
        updated = {
          ...updated,
          status: "recycle_later",
          recycleCycle: updated.recycleCycle + 1,
          nextAction: makeAction(draft, updated, at, {
            type: eligible ? "recycled_call" : "manual_review",
            dueAt,
            exact: false,
            queueClass: eligible ? "recycled" : "non_call",
            queueEligible: eligible,
            reason: eligible
              ? "Initial attempts exhausted; eligible after recycle delay"
              : "Initial attempts exhausted; review before an extended retry",
          }),
        };
      } else if (coldNoAnswerCount < lifetimeMaximum) {
        const dueAt = automaticDueAt(
          draft,
          updated,
          at,
          draft.settings.calling.defaultRetryDelayBusinessDays,
          `extended:${coldNoAnswerCount}`,
        );
        updated = {
          ...updated,
          status: "extended_retry",
          nextAction: makeAction(draft, updated, at, {
            type: "cold_retry",
            dueAt,
            exact: false,
            queueClass: "cold_retry",
            queueEligible: true,
            reason: `Extended attempt ${coldNoAnswerCount + 1} scheduled`,
          }),
        };
      } else {
        updated = {
          ...updated,
          status: "dormant_unreachable",
          pipelineStage: "dormant",
          nextAction: null,
        };
      }
      break;
    }
    case "callback": {
      const callbackAt = requireInputDate(input.callbackAt, "Callback date/time");
      updated = {
        ...updated,
        status: "callback",
        pipelineStage: "engaged",
        callbackAt,
        nextAction: makeAction(draft, updated, at, {
          type: "callback",
          dueAt: callbackAt,
          exact: true,
          queueClass: "exact_callback",
          queueEligible: true,
          reason: "Prospect requested an exact callback",
        }),
      };
      break;
    }
    case "meeting_booked": {
      const meetingAt = requireInputDate(input.meetingAt, "Meeting date/time");
      const meeting = createMeeting(draft, updated, at, meetingAt, {
        meetingType: input.meetingType,
        durationMinutes: input.meetingDurationMinutes,
        contactEmail: input.contactEmail,
        notes: input.note,
      });
      createdMeetingIds.push(meeting.id);
      updated = {
        ...updated,
        status: "meeting_booked",
        pipelineStage: "meeting",
        nextAction: makeAction(draft, updated, at, {
          type: "meeting",
          dueAt: meetingAt,
          exact: true,
          queueClass: "non_call",
          queueEligible: false,
          reason: `Attend meeting ${meeting.id}`,
        }),
      };
      const meetingActivity = appendActivity(draft, {
        leadId,
        type: "meeting_booked",
        occurredAt: at,
        title: "Meeting booked",
        note: input.note?.trim() ?? "",
        metadata: { meetingId: meeting.id, scheduledAt: meetingAt },
      });
      createdActivityIds.push(meetingActivity.id);
      break;
    }
    case "interested":
    case "follow_up": {
      const dueAt = input.followUpAt
        ? asIso(input.followUpAt)
        : automaticDueAt(draft, updated, at, 1, `warm:${updated.coldAttemptCount}`);
      updated = {
        ...updated,
        status: input.outcome === "interested" ? "interested" : "conversation_follow_up",
        pipelineStage: "engaged",
        followUpAt: dueAt,
        nextAction: scheduleWarmFollowUp(
          draft,
          updated,
          at,
          dueAt,
          input.outcome === "interested" ? "Interested prospect follow-up" : "Conversation follow-up",
          Boolean(input.followUpAt),
        ),
      };
      break;
    }
    case "not_interested":
      updated = {
        ...updated,
        status: "lost",
        pipelineStage: "closed",
        lostReason: input.lostReason ?? "Not Interested",
        nextAction: null,
      };
      break;
    case "do_not_call":
      updated = {
        ...updated,
        status: "do_not_call",
        pipelineStage: "closed",
        doNotCall: true,
        nextAction: null,
      };
      break;
    case "wrong_person": {
      const replacementPhone = input.replacementPhone?.trim() ?? "";
      if (replacementPhone) {
        updated = {
          ...updated,
          decisionMakerName: input.replacementName?.trim() || updated.decisionMakerName,
          decisionMakerRole: input.replacementRole?.trim() || updated.decisionMakerRole,
          directPhone: replacementPhone,
          badNumber: false,
          status: "new",
          pipelineStage: "cold",
          nextAction: makeAction(draft, updated, at, {
            type: "cold_call",
            dueAt: at,
            exact: false,
            queueClass: "new_cold",
            queueEligible: true,
            reason: "Replacement decision-maker contact supplied",
          }),
        };
      } else {
        updated = {
          ...updated,
          status: "contact_data_required",
          nextAction: makeAction(draft, updated, at, {
            type: "contact_data_correction",
            dueAt: at,
            exact: false,
            queueClass: "non_call",
            queueEligible: false,
            reason: "Correct decision-maker contact is required",
          }),
        };
      }
      break;
    }
    case "bad_number": {
      const [alternate, ...remaining] = updated.alternatePhones.filter(Boolean);
      if (alternate) {
        updated = {
          ...updated,
          directPhone: alternate,
          alternatePhones: remaining,
          badNumber: false,
          status: "new",
          nextAction: makeAction(draft, updated, at, {
            type: "cold_call",
            dueAt: at,
            exact: false,
            queueClass: "new_cold",
            queueEligible: true,
            reason: "Using alternate phone after bad-number result",
          }),
        };
      } else {
        updated = {
          ...updated,
          badNumber: true,
          directPhone: "",
          mobilePhone: "",
          status: "contact_data_required",
          nextAction: makeAction(draft, updated, at, {
            type: "contact_data_correction",
            dueAt: at,
            exact: false,
            queueClass: "non_call",
            queueEligible: false,
            reason: "All known phone numbers are invalid",
          }),
        };
      }
      break;
    }
    case "other": {
      const dueAt = input.nextActionAt ? asIso(input.nextActionAt) : at;
      updated = {
        ...updated,
        status: "conversation_follow_up",
        pipelineStage: "engaged",
        followUpAt: dueAt,
        nextAction: makeAction(draft, updated, at, {
          type: "manual_review",
          dueAt,
          exact: Boolean(input.nextActionAt),
          queueClass: "non_call",
          queueEligible: false,
          reason: "Custom outcome requires manual review",
        }),
      };
      break;
    }
  }

  replaceLead(draft, index, updated);
  const callActivity = appendActivity(draft, {
    leadId,
    type: "call_attempt",
    occurredAt: at,
    title: input.outcome.replaceAll("_", " "),
    note: input.note?.trim() ?? "",
    metadata: {
      callAttemptId: attempt.id,
      outcome: input.outcome,
      coldAttemptNumber: attempt.coldAttemptNumber,
      status: updated.status,
    },
  });
  const statusActivity = appendStatusActivity(draft, updated, at, input.note?.trim() ?? "");
  pushUndo(draft, {
    id: allocateId(draft, "undo"),
    label: `Call outcome: ${input.outcome.replaceAll("_", " ")}`,
    createdAt: at,
    leadBefore: lead,
    meetingBefore: null,
    createdActivityIds: [...createdActivityIds, callActivity.id, statusActivity.id],
    createdCallAttemptIds: [attempt.id],
    createdMeetingIds,
    createdTouchIds: [],
  });
  advanceActiveSession(draft, at);
  return draft;
}

export function startSession(
  state: CRMState,
  now: ISODateTime | Date = new Date(),
): CRMState {
  const at = asIso(now);
  if (state.sessions.some((session) => session.endedAt === null)) return state;
  const draft = beginDraft(state, at);
  const next = getNextLead(draft, at);
  const session: CallingSession = {
    id: allocateId(draft, "session"),
    startedAt: at,
    endedAt: null,
    currentLeadId: next?.lead.id ?? null,
    dailyGoalSnapshot: draft.settings.calling.dailyCallGoal,
  };
  draft.sessions.push(session);
  appendActivity(draft, {
    leadId: null,
    type: "session_started",
    occurredAt: at,
    title: "Calling session started",
    note: "",
    metadata: { sessionId: session.id, dailyGoal: session.dailyGoalSnapshot },
  });
  return draft;
}

export function endSession(
  state: CRMState,
  sessionIdOrNow?: string | Date,
  now: ISODateTime | Date = new Date(),
): CRMState {
  const explicitSessionId =
    typeof sessionIdOrNow === "string" && sessionIdOrNow.startsWith("session_")
      ? sessionIdOrNow
      : null;
  const activeIndex = state.sessions.findIndex(
    (session) =>
      session.endedAt === null && (!explicitSessionId || session.id === explicitSessionId),
  );
  if (activeIndex < 0) return state;
  const at = asIso(explicitSessionId ? now : sessionIdOrNow ?? now);
  const draft = beginDraft(state, at);
  const session = draft.sessions[activeIndex];
  draft.sessions[activeIndex] = { ...session, endedAt: at, currentLeadId: null };
  appendActivity(draft, {
    leadId: null,
    type: "session_ended",
    occurredAt: at,
    title: "Calling session ended",
    note: "",
    metadata: { sessionId: session.id },
  });
  return draft;
}

function postMeetingDueAt(
  draft: CRMState,
  lead: Lead,
  at: ISODateTime,
  completedTouches: number,
): ISODateTime {
  const cadence = draft.settings.followUp.cadenceBusinessDays;
  const delay = cadence[Math.min(completedTouches, Math.max(0, cadence.length - 1))] ?? 3;
  return automaticDueAt(draft, lead, at, delay, `post-meeting:${completedTouches + 1}`);
}

function schedulePostMeetingAction(
  draft: CRMState,
  lead: Lead,
  at: ISODateTime,
  dueAt: ISODateTime,
  reason: string,
  exact = false,
  exactCallback = false,
): NextAction {
  return makeAction(draft, lead, at, {
    type: "post_meeting_follow_up",
    dueAt,
    exact,
    queueClass: exactCallback ? "exact_callback" : "post_meeting_follow_up",
    queueEligible: true,
    reason,
  });
}

export function completeMeeting(
  state: CRMState,
  meetingId: string,
  input: MeetingOutcomeInput,
  now: ISODateTime | Date = new Date(),
): CRMState {
  const allowedOutcomes: MeetingOutcomeInput["outcome"][] = [
    "won",
    "decision_pending",
    "follow_up_needed",
    "second_meeting_needed",
    "proposal_sent",
    "lost",
  ];
  if (!allowedOutcomes.includes(input.outcome)) {
    throw new DomainError("A completed meeting requires a valid outcome");
  }
  const at = asIso(now);
  const draft = beginDraft(state, at);
  const meetingIndex = draft.meetings.findIndex(
    (meeting) => meeting.id === meetingId && meeting.voidedAt === null,
  );
  if (meetingIndex < 0) throw new DomainError(`Meeting ${meetingId} was not found`);
  const meetingBefore = draft.meetings[meetingIndex];
  if (meetingBefore.status !== "booked") {
    throw new DomainError("Only a booked meeting can be completed");
  }
  const { lead, index: leadIndex } = requireLead(draft, meetingBefore.leadId);
  if (lead.doNotCall || TERMINAL_STATUSES.has(lead.status)) {
    throw new DomainError("A terminal lead cannot complete an active meeting");
  }

  const updatedMeeting: Meeting = {
    ...meetingBefore,
    status: "completed",
    outcome: input.outcome,
    notes: input.note?.trim() || meetingBefore.notes,
    interestSummary: input.interestSummary?.trim() ?? meetingBefore.interestSummary,
    mainObjection: input.mainObjection?.trim() ?? meetingBefore.mainObjection,
    decisionStatus: input.decisionStatus?.trim() ?? meetingBefore.decisionStatus,
    completedAt: at,
    updatedAt: at,
  };
  draft.meetings[meetingIndex] = updatedMeeting;

  let updatedLead: Lead = {
    ...lead,
    lastOutcome: `meeting_${input.outcome}`,
    lastConversationNotes: input.note?.trim() || lead.lastConversationNotes,
    callbackAt: null,
    followUpAt: null,
    nextAction: null,
    updatedAt: at,
    revision: lead.revision + 1,
  };
  const createdMeetingIds: string[] = [];

  switch (input.outcome) {
    case "won":
      updatedLead = {
        ...updatedLead,
        status: "won",
        pipelineStage: "client",
        nextAction: null,
      };
      break;
    case "lost":
      updatedLead = {
        ...updatedLead,
        status: "lost",
        pipelineStage: "closed",
        lostReason: input.lostReason ?? "Lost after meeting",
        nextAction: null,
      };
      break;
    case "second_meeting_needed": {
      const scheduledAt = requireInputDate(input.secondMeetingAt, "Second meeting date/time");
      const secondMeeting = createMeeting(draft, updatedLead, at, scheduledAt, {
        meetingType: input.secondMeetingType ?? "Second meeting",
        notes: input.note,
      });
      createdMeetingIds.push(secondMeeting.id);
      updatedLead = {
        ...updatedLead,
        status: "second_meeting_booked",
        pipelineStage: "meeting",
        nextAction: makeAction(draft, updatedLead, at, {
          type: "meeting",
          dueAt: scheduledAt,
          exact: true,
          queueClass: "non_call",
          queueEligible: false,
          reason: `Attend second meeting ${secondMeeting.id}`,
        }),
      };
      break;
    }
    case "decision_pending":
    case "follow_up_needed":
    case "proposal_sent": {
      const isContinuingSequence = lead.pipelineStage === "post_meeting";
      const touchCount = isContinuingSequence ? lead.postMeetingTouchCount : 0;
      const dueAt = input.nextAt
        ? asIso(input.nextAt)
        : postMeetingDueAt(draft, updatedLead, at, touchCount);
      const status =
        input.outcome === "decision_pending"
          ? "decision_pending"
          : input.outcome === "proposal_sent"
            ? "proposal_sent"
            : "post_meeting_follow_up";
      updatedLead = {
        ...updatedLead,
        status,
        pipelineStage: "post_meeting",
        postMeetingTouchCount: touchCount,
        followUpAt: dueAt,
        nextAction: schedulePostMeetingAction(
          draft,
          updatedLead,
          at,
          dueAt,
          `Post-meeting ${input.outcome.replaceAll("_", " ")}`,
          Boolean(input.nextAt),
        ),
      };
      break;
    }
  }

  replaceLead(draft, leadIndex, updatedLead);
  const completionActivity = appendActivity(draft, {
    leadId: lead.id,
    type: "meeting_completed",
    occurredAt: at,
    title: `Meeting completed — ${input.outcome.replaceAll("_", " ")}`,
    note: input.note?.trim() ?? "",
    metadata: { meetingId, outcome: input.outcome, status: updatedLead.status },
  });
  const statusActivity = appendStatusActivity(draft, updatedLead, at, input.note?.trim() ?? "");
  pushUndo(draft, {
    id: allocateId(draft, "undo"),
    label: `Complete meeting: ${input.outcome.replaceAll("_", " ")}`,
    createdAt: at,
    leadBefore: lead,
    meetingBefore,
    createdActivityIds: [completionActivity.id, statusActivity.id],
    createdCallAttemptIds: [],
    createdMeetingIds,
    createdTouchIds: [],
  });
  advanceActiveSession(draft, at);
  return draft;
}

function latestCompletedMeeting(state: CRMState, leadId: string): Meeting | null {
  return (
    state.meetings
      .filter(
        (meeting) =>
          meeting.leadId === leadId &&
          meeting.status === "completed" &&
          meeting.voidedAt === null,
      )
      .sort(
        (left, right) =>
          new Date(right.completedAt ?? right.updatedAt).getTime() -
          new Date(left.completedAt ?? left.updatedAt).getTime(),
      )[0] ?? null
  );
}

function postMeetingFlags(outcome: PostMeetingOutcomeInput["outcome"]): {
  answered: boolean;
  meaningful: boolean;
} {
  if (outcome === "no_answer") return { answered: false, meaningful: false };
  return { answered: true, meaningful: true };
}

export function applyPostMeetingOutcome(
  state: CRMState,
  leadId: string,
  input: PostMeetingOutcomeInput,
  now: ISODateTime | Date = new Date(),
): CRMState {
  const allowedOutcomes: PostMeetingOutcomeInput["outcome"][] = [
    "no_answer",
    "still_deciding",
    "needs_internal_approval",
    "requested_callback",
    "second_meeting_booked",
    "proposal_sent",
    "won",
    "lost",
    "do_not_contact",
  ];
  if (!allowedOutcomes.includes(input.outcome)) {
    throw new DomainError("A valid post-meeting outcome is required");
  }
  const at = asIso(now);
  const draft = beginDraft(state, at);
  const { lead, index } = requireLead(draft, leadId);
  if (lead.pipelineStage !== "post_meeting") {
    throw new DomainError("The lead is not in the post-meeting pipeline");
  }
  if (TERMINAL_STATUSES.has(lead.status) || lead.doNotCall) {
    throw new DomainError("A terminal lead cannot receive a post-meeting outcome");
  }
  const meeting = latestCompletedMeeting(draft, leadId);
  if (!meeting) throw new DomainError("A completed meeting is required before post-meeting follow-up");

  const maximumTouches = Math.max(1, draft.settings.followUp.maximumPostMeetingTouches);
  const previousTouchNumber = draft.postMeetingTouches
    .filter((touch) => touch.leadId === leadId && touch.voidedAt === null)
    .reduce((maximum, touch) => Math.max(maximum, touch.touchNumber), 0);
  const touchNumber = previousTouchNumber + 1;
  const cappedTouchCount = Math.min(maximumTouches, lead.postMeetingTouchCount + 1);
  const touchType = input.touchType ?? "phone";
  let callAttempt: CallAttempt | null = null;
  if (touchType === "phone" || touchType === "callback") {
    const flags = postMeetingFlags(input.outcome);
    callAttempt = {
      id: allocateId(draft, "call"),
      leadId,
      sessionId: currentSessionId(draft),
      occurredAt: at,
      context: "post_meeting",
      outcome: input.outcome,
      coldAttemptNumber: null,
      coldNoAnswerNumber: null,
      postMeetingTouchNumber: touchNumber,
      answered: flags.answered,
      meaningfulConversation: flags.meaningful,
      note: input.note?.trim() ?? "",
      durationSeconds: input.durationSeconds ?? null,
      batchIdSnapshot: lead.batchId,
      contactTypeSnapshot: lead.contactType,
      pixelPresentSnapshot: lead.pixelPresent,
      findingCategorySnapshot: lead.findingCategory,
      findingStrengthSnapshot: lead.findingStrength,
      voidedAt: null,
    };
    draft.callAttempts.push(callAttempt);
  }

  const touch: PostMeetingTouch = {
    id: allocateId(draft, "touch"),
    leadId,
    meetingId: meeting.id,
    touchNumber,
    type: touchType,
    outcome: input.outcome,
    occurredAt: at,
    note: input.note?.trim() ?? "",
    approver: input.approver?.trim() ?? "",
    nextScheduledAt: input.callbackAt ?? input.nextAt ?? input.secondMeetingAt ?? null,
    callAttemptId: callAttempt?.id ?? null,
    voidedAt: null,
  };
  draft.postMeetingTouches.push(touch);

  let updated: Lead = {
    ...lead,
    postMeetingTouchCount: cappedTouchCount,
    lastCalledAt: callAttempt ? at : lead.lastCalledAt,
    lastOutcome: input.outcome,
    lastConversationNotes: input.note?.trim() || lead.lastConversationNotes,
    callbackAt: null,
    followUpAt: null,
    nextAction: null,
    updatedAt: at,
    revision: lead.revision + 1,
  };
  const createdMeetingIds: string[] = [];

  const scheduleAutomaticOrManual = (status: Lead["status"], reason: string): Lead => {
    if (input.nextAt) {
      const dueAt = asIso(input.nextAt);
      return {
        ...updated,
        status,
        followUpAt: dueAt,
        nextAction: schedulePostMeetingAction(draft, updated, at, dueAt, reason, true),
      };
    }
    if (cappedTouchCount < maximumTouches) {
      const dueAt = postMeetingDueAt(draft, updated, at, cappedTouchCount);
      return {
        ...updated,
        status,
        followUpAt: dueAt,
        nextAction: schedulePostMeetingAction(draft, updated, at, dueAt, reason),
      };
    }
    return {
      ...updated,
      status,
      nextAction: makeAction(draft, updated, at, {
        type: "manual_review",
        dueAt: at,
        exact: false,
        queueClass: "non_call",
        queueEligible: false,
        reason: "Automated five-touch cadence complete; meaningful progress requires review",
      }),
    };
  };

  switch (input.outcome) {
    case "no_answer":
      if (cappedTouchCount >= maximumTouches) {
        updated = {
          ...updated,
          status: "dormant_post_meeting_no_response",
          pipelineStage: "dormant",
          nextAction: null,
        };
      } else {
        const dueAt = postMeetingDueAt(draft, updated, at, cappedTouchCount);
        updated = {
          ...updated,
          status: "post_meeting_follow_up",
          followUpAt: dueAt,
          nextAction: schedulePostMeetingAction(
            draft,
            updated,
            at,
            dueAt,
            `Post-meeting touch ${cappedTouchCount + 1} due`,
          ),
        };
      }
      break;
    case "still_deciding":
      updated = scheduleAutomaticOrManual("decision_pending", "Prospect is still deciding");
      break;
    case "needs_internal_approval":
      updated = scheduleAutomaticOrManual(
        "decision_pending",
        input.approver ? `Internal approval needed from ${input.approver}` : "Internal approval needed",
      );
      break;
    case "proposal_sent":
      updated = scheduleAutomaticOrManual("proposal_sent", "Proposal/agreement follow-up");
      break;
    case "requested_callback": {
      const callbackAt = requireInputDate(input.callbackAt, "Callback date/time");
      updated = {
        ...updated,
        status: "post_meeting_follow_up",
        callbackAt,
        followUpAt: callbackAt,
        nextAction: schedulePostMeetingAction(
          draft,
          updated,
          at,
          callbackAt,
          "Exact post-meeting callback requested",
          true,
          true,
        ),
      };
      break;
    }
    case "second_meeting_booked": {
      const scheduledAt = requireInputDate(input.secondMeetingAt, "Second meeting date/time");
      const secondMeeting = createMeeting(draft, updated, at, scheduledAt, {
        meetingType: input.secondMeetingType ?? "Second meeting",
        notes: input.note,
      });
      createdMeetingIds.push(secondMeeting.id);
      updated = {
        ...updated,
        status: "second_meeting_booked",
        pipelineStage: "meeting",
        nextAction: makeAction(draft, updated, at, {
          type: "meeting",
          dueAt: scheduledAt,
          exact: true,
          queueClass: "non_call",
          queueEligible: false,
          reason: `Attend second meeting ${secondMeeting.id}`,
        }),
      };
      break;
    }
    case "won":
      updated = { ...updated, status: "won", pipelineStage: "client", nextAction: null };
      break;
    case "lost":
      updated = {
        ...updated,
        status: "lost",
        pipelineStage: "closed",
        lostReason: input.lostReason ?? "Lost after meeting",
        nextAction: null,
      };
      break;
    case "do_not_contact":
      updated = {
        ...updated,
        status: "do_not_call",
        pipelineStage: "closed",
        doNotCall: true,
        nextAction: null,
      };
      break;
  }

  replaceLead(draft, index, updated);
  const touchActivity = appendActivity(draft, {
    leadId,
    type: "post_meeting_touch",
    occurredAt: at,
    title: `Post-meeting touch ${touchNumber}: ${input.outcome.replaceAll("_", " ")}`,
    note: input.note?.trim() ?? "",
    metadata: {
      touchId: touch.id,
      touchNumber,
      touchType,
      outcome: input.outcome,
      status: updated.status,
    },
  });
  const statusActivity = appendStatusActivity(draft, updated, at, input.note?.trim() ?? "");
  pushUndo(draft, {
    id: allocateId(draft, "undo"),
    label: `Post-meeting touch: ${input.outcome.replaceAll("_", " ")}`,
    createdAt: at,
    leadBefore: lead,
    meetingBefore: null,
    createdActivityIds: [touchActivity.id, statusActivity.id],
    createdCallAttemptIds: callAttempt ? [callAttempt.id] : [],
    createdMeetingIds,
    createdTouchIds: [touch.id],
  });
  advanceActiveSession(draft, at);
  return draft;
}

export function reopenLead(
  state: CRMState,
  leadId: string,
  now: ISODateTime | Date = new Date(),
  mode?: "cold" | "post_meeting",
): CRMState {
  const at = asIso(now);
  const draft = beginDraft(state, at);
  const { lead, index } = requireLead(draft, leadId);
  if (!TERMINAL_STATUSES.has(lead.status) || lead.status === "do_not_call") {
    throw new DomainError("Only a closed/dormant non-DNC lead can be reopened");
  }
  const postMeeting =
    mode === "post_meeting" ||
    (mode === undefined && lead.status === "dormant_post_meeting_no_response");
  if (postMeeting && !latestCompletedMeeting(draft, leadId)) {
    throw new DomainError("A completed meeting is required to reopen into post-meeting follow-up");
  }
  const updated: Lead = {
    ...lead,
    status: postMeeting ? "post_meeting_follow_up" : "new",
    pipelineStage: postMeeting ? "post_meeting" : "cold",
    lostReason: "",
    nextAction: makeAction(draft, lead, at, {
      type: postMeeting ? "post_meeting_follow_up" : "cold_call",
      dueAt: at,
      exact: false,
      queueClass: postMeeting ? "post_meeting_follow_up" : "recycled",
      queueEligible: hasCallableNumber(lead),
      reason: "Lead manually reopened",
    }),
    updatedAt: at,
    revision: lead.revision + 1,
  };
  replaceLead(draft, index, updated);
  const activity = appendActivity(draft, {
    leadId,
    type: "lead_reopened",
    occurredAt: at,
    title: "Lead reopened",
    note: "",
    metadata: { mode: postMeeting ? "post_meeting" : "cold" },
  });
  pushUndo(draft, {
    id: allocateId(draft, "undo"),
    label: "Reopen lead",
    createdAt: at,
    leadBefore: lead,
    meetingBefore: null,
    createdActivityIds: [activity.id],
    createdCallAttemptIds: [],
    createdMeetingIds: [],
    createdTouchIds: [],
  });
  return draft;
}

export function undoLastAction(
  state: CRMState,
  now: ISODateTime | Date = new Date(),
): CRMState {
  const undo = state.undoStack.at(-1);
  if (!undo) return state;
  const at = asIso(now);
  const draft = beginDraft(state, at);
  const current = requireLead(draft, undo.leadBefore.id);
  replaceLead(draft, current.index, {
    ...undo.leadBefore,
    updatedAt: at,
    revision: current.lead.revision + 1,
  });
  if (undo.meetingBefore) {
    const index = draft.meetings.findIndex((meeting) => meeting.id === undo.meetingBefore?.id);
    if (index >= 0) {
      draft.meetings[index] = { ...undo.meetingBefore, updatedAt: at };
    }
  }
  const voidActivities = new Set(undo.createdActivityIds);
  const voidAttempts = new Set(undo.createdCallAttemptIds);
  const voidMeetings = new Set(undo.createdMeetingIds);
  const voidTouches = new Set(undo.createdTouchIds);
  draft.activities = draft.activities.map((activity) =>
    voidActivities.has(activity.id) ? { ...activity, voidedAt: at } : activity,
  );
  draft.callAttempts = draft.callAttempts.map((attempt) =>
    voidAttempts.has(attempt.id) ? { ...attempt, voidedAt: at } : attempt,
  );
  draft.meetings = draft.meetings.map((meeting) =>
    voidMeetings.has(meeting.id) ? { ...meeting, voidedAt: at } : meeting,
  );
  draft.postMeetingTouches = draft.postMeetingTouches.map((touch) =>
    voidTouches.has(touch.id) ? { ...touch, voidedAt: at } : touch,
  );
  draft.undoStack = draft.undoStack.slice(0, -1);
  appendActivity(draft, {
    leadId: undo.leadBefore.id,
    type: "action_undone",
    occurredAt: at,
    title: `Undid: ${undo.label}`,
    note: "The original records remain in the audit trail as voided.",
    metadata: { undoId: undo.id },
  });
  advanceActiveSession(draft, at);
  return draft;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function isInRange(value: ISODateTime, options: AnalyticsOptions): boolean {
  const timestamp = new Date(value).getTime();
  return (
    (!options.from || timestamp >= new Date(options.from).getTime()) &&
    (!options.to || timestamp <= new Date(options.to).getTime())
  );
}

function findingDimension(attempt: CallAttempt): string {
  if (attempt.pixelPresentSnapshot === "yes") return "Tracking Pixel";
  if (attempt.findingCategorySnapshot.toLowerCase().includes("header")) return "Security Headers";
  return attempt.findingCategorySnapshot || "Other";
}

function buildDimensionRows(
  attempts: CallAttempt[],
  meetings: Meeting[],
  leads: Lead[],
  keyFor: (attempt: CallAttempt) => string,
): AnalyticsDimensionRow[] {
  const groups = new Map<string, CallAttempt[]>();
  for (const attempt of attempts) {
    const key = keyFor(attempt) || "Unknown";
    groups.set(key, [...(groups.get(key) ?? []), attempt]);
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const leadIds = new Set(rows.map((row) => row.leadId));
      const dials = rows.length;
      const answered = rows.filter((row) => row.answered).length;
      const conversations = rows.filter((row) => row.meaningfulConversation).length;
      const meetingCount = meetings.filter((meeting) => leadIds.has(meeting.leadId)).length;
      const clients = leads.filter((lead) => leadIds.has(lead.id) && lead.status === "won").length;
      return {
        key,
        dials,
        answered,
        conversations,
        meetings: meetingCount,
        clients,
        answerRate: rate(answered, dials),
        meetingRate: rate(meetingCount, new Set(rows.map((row) => row.leadId)).size),
        clientRate: rate(clients, new Set(rows.map((row) => row.leadId)).size),
      };
    })
    .sort((left, right) => right.dials - left.dials || left.key.localeCompare(right.key));
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function computeAnalytics(
  state: CRMState,
  options: AnalyticsOptions = {},
): AnalyticsSummary {
  const attempts = state.callAttempts.filter(
    (attempt) =>
      attempt.voidedAt === null &&
      isInRange(attempt.occurredAt, options) &&
      (!options.batchId || attempt.batchIdSnapshot === options.batchId),
  );
  const eligibleLeadIds = new Set(
    options.batchId
      ? state.leads.filter((lead) => lead.batchId === options.batchId).map((lead) => lead.id)
      : state.leads.map((lead) => lead.id),
  );
  const meetings = state.meetings.filter(
    (meeting) =>
      meeting.voidedAt === null &&
      eligibleLeadIds.has(meeting.leadId) &&
      isInRange(meeting.createdAt, options),
  );
  const heldMeetings = state.meetings.filter(
    (meeting) =>
      meeting.voidedAt === null &&
      meeting.status === "completed" &&
      Boolean(meeting.completedAt) &&
      eligibleLeadIds.has(meeting.leadId) &&
      isInRange(meeting.completedAt as string, options),
  );
  const hasDateRange = Boolean(options.from || options.to);
  const terminalEvents = state.activities.filter(
    (activity) =>
      activity.voidedAt === null &&
      activity.leadId !== null &&
      eligibleLeadIds.has(activity.leadId) &&
      isInRange(activity.occurredAt, options),
  );
  const clientsWon = hasDateRange
    ? new Set(
        terminalEvents
          .filter((activity) => activity.metadata.status === "won")
          .map((activity) => activity.leadId),
      ).size
    : state.leads.filter((lead) => eligibleLeadIds.has(lead.id) && lead.status === "won").length;
  const leadsLost = hasDateRange
    ? new Set(
        terminalEvents
          .filter((activity) => activity.metadata.status === "lost")
          .map((activity) => activity.leadId),
      ).size
    : state.leads.filter((lead) => eligibleLeadIds.has(lead.id) && lead.status === "lost").length;

  const answeredCalls = attempts.filter((attempt) => attempt.answered).length;
  const realConversations = attempts.filter((attempt) => attempt.meaningfulConversation).length;
  const uniqueLeadsCalled = new Set(attempts.map((attempt) => attempt.leadId)).size;
  const conversationLeadIds = new Set(
    attempts.filter((attempt) => attempt.meaningfulConversation).map((attempt) => attempt.leadId),
  );
  const meetingLeadIds = new Set(meetings.map((meeting) => meeting.leadId));
  const conversationLeadsWithMeetings = new Set(
    [...conversationLeadIds].filter((leadId) => meetingLeadIds.has(leadId)),
  ).size;

  const attemptsBeforeConversation: number[] = [];
  const attemptsBeforeMeeting: number[] = [];
  for (const leadId of new Set(attempts.map((attempt) => attempt.leadId))) {
    const ordered = attempts
      .filter((attempt) => attempt.leadId === leadId)
      .sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
    const firstConversationIndex = ordered.findIndex((attempt) => attempt.meaningfulConversation);
    if (firstConversationIndex >= 0) attemptsBeforeConversation.push(firstConversationIndex + 1);
    const firstMeeting = meetings
      .filter((meeting) => meeting.leadId === leadId)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())[0];
    if (firstMeeting) {
      attemptsBeforeMeeting.push(
        ordered.filter(
          (attempt) => new Date(attempt.occurredAt).getTime() <= new Date(firstMeeting.createdAt).getTime(),
        ).length,
      );
    }
  }

  const byAttemptMap = new Map<number, CallAttempt[]>();
  for (const attempt of attempts) {
    if (attempt.coldAttemptNumber === null) continue;
    byAttemptMap.set(attempt.coldAttemptNumber, [
      ...(byAttemptMap.get(attempt.coldAttemptNumber) ?? []),
      attempt,
    ]);
  }
  const byAttempt: AttemptPerformanceRow[] = [...byAttemptMap.entries()]
    .sort(([left], [right]) => left - right)
    .map(([attempt, rows]) => ({
      attempt,
      dials: rows.length,
      answered: rows.filter((row) => row.answered).length,
      conversations: rows.filter((row) => row.meaningfulConversation).length,
      connectionRate: rate(rows.filter((row) => row.answered).length, rows.length),
    }));

  return {
    totalDials: attempts.length,
    uniqueLeadsCalled,
    answeredCalls,
    realConversations,
    noAnswers: attempts.filter((attempt) => attempt.outcome === "no_answer").length,
    badNumbers: attempts.filter((attempt) => attempt.outcome === "bad_number").length,
    callbacks: attempts.filter(
      (attempt) => attempt.outcome === "callback" || attempt.outcome === "requested_callback",
    ).length,
    meetingsBooked: meetings.length,
    meetingsHeld: heldMeetings.length,
    clientsWon,
    leadsLost,
    answerRate: rate(answeredCalls, attempts.length),
    conversationRate: rate(realConversations, attempts.length),
    conversationToMeetingRate: rate(conversationLeadsWithMeetings, conversationLeadIds.size),
    dialToMeetingRate: rate(meetings.length, attempts.length),
    meetingShowRate: rate(heldMeetings.length, meetings.length),
    meetingToClientRate: rate(clientsWon, heldMeetings.length),
    leadToClientRate: rate(clientsWon, eligibleLeadIds.size),
    dialToClientRate: rate(clientsWon, attempts.length),
    averageAttemptsBeforeConversation: average(attemptsBeforeConversation),
    averageAttemptsBeforeMeeting: average(attemptsBeforeMeeting),
    byFinding: buildDimensionRows(
      attempts,
      meetings,
      state.leads,
      findingDimension,
    ),
    byContactType: buildDimensionRows(
      attempts,
      meetings,
      state.leads,
      (attempt) => attempt.contactTypeSnapshot,
    ),
    byAttempt,
  };
}

function duplicateIds<T extends { id: string }>(records: T[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) duplicates.add(record.id);
    seen.add(record.id);
  }
  return [...duplicates];
}

export function checkInvariants(state: CRMState): DomainInvariantViolation[] {
  const issues: DomainInvariantViolation[] = [];
  const collections: Array<[string, Array<{ id: string }>]> = [
    ["lead", state.leads],
    ["activity", state.activities],
    ["call attempt", state.callAttempts],
    ["meeting", state.meetings],
    ["post-meeting touch", state.postMeetingTouches],
    ["session", state.sessions],
    ["batch", state.batches],
  ];
  for (const [label, records] of collections) {
    for (const id of duplicateIds(records)) {
      issues.push({ code: "DUPLICATE_ID", message: `Duplicate ${label} ID: ${id}` });
    }
  }

  const leadIds = new Set(state.leads.map((lead) => lead.id));
  const meetingIds = new Set(state.meetings.map((meeting) => meeting.id));
  for (const lead of state.leads) {
    const terminal = TERMINAL_STATUSES.has(lead.status);
    if (terminal && lead.nextAction) {
      issues.push({
        code: "TERMINAL_HAS_ACTION",
        message: `Terminal lead ${lead.id} has a next action`,
        leadId: lead.id,
      });
    }
    if (!terminal && !lead.nextAction) {
      issues.push({
        code: "ACTIVE_MISSING_ACTION",
        message: `Active lead ${lead.id} has no next action`,
        leadId: lead.id,
      });
    }
    if (lead.nextAction && lead.nextAction.leadId !== lead.id) {
      issues.push({
        code: "ACTION_LEAD_MISMATCH",
        message: `Lead ${lead.id} has an action owned by ${lead.nextAction?.leadId ?? "nobody"}`,
        leadId: lead.id,
      });
    }
    if (lead.nextAction && Number.isNaN(new Date(lead.nextAction.dueAt).getTime())) {
      issues.push({
        code: "INVALID_ACTION_DATE",
        message: `Lead ${lead.id} has an invalid next-action date`,
        leadId: lead.id,
      });
    }
    if (lead.status === "do_not_call" && !lead.doNotCall) {
      issues.push({
        code: "DNC_FLAG_MISSING",
        message: `DNC lead ${lead.id} is missing its safety flag`,
        leadId: lead.id,
      });
    }
    if (lead.doNotCall && lead.nextAction?.queueEligible) {
      issues.push({
        code: "DNC_QUEUEABLE",
        message: `DNC lead ${lead.id} has a queueable action`,
        leadId: lead.id,
      });
    }
    if (
      lead.coldAttemptCount < 0 ||
      lead.coldNoAnswerCount < 0 ||
      lead.coldNoAnswerCount > lead.coldAttemptCount
    ) {
      issues.push({
        code: "INVALID_COLD_COUNTER",
        message: `Lead ${lead.id} has inconsistent cold counters`,
        leadId: lead.id,
      });
    }
    if (
      lead.postMeetingTouchCount < 0 ||
      lead.postMeetingTouchCount > state.settings.followUp.maximumPostMeetingTouches
    ) {
      issues.push({
        code: "INVALID_TOUCH_COUNTER",
        message: `Lead ${lead.id} has an invalid post-meeting counter`,
        leadId: lead.id,
      });
    }
  }

  for (const attempt of state.callAttempts) {
    if (!leadIds.has(attempt.leadId)) {
      issues.push({ code: "ORPHAN_CALL", message: `Call ${attempt.id} has no lead` });
    }
  }
  for (const meeting of state.meetings) {
    if (!leadIds.has(meeting.leadId)) {
      issues.push({ code: "ORPHAN_MEETING", message: `Meeting ${meeting.id} has no lead` });
    }
    if (meeting.status === "completed" && !meeting.outcome) {
      issues.push({
        code: "COMPLETED_MEETING_MISSING_OUTCOME",
        message: `Completed meeting ${meeting.id} has no outcome`,
        leadId: meeting.leadId,
      });
    }
    if (meeting.status !== "completed" && meeting.outcome) {
      issues.push({
        code: "UNCOMPLETED_MEETING_HAS_OUTCOME",
        message: `Uncompleted meeting ${meeting.id} already has an outcome`,
        leadId: meeting.leadId,
      });
    }
  }
  for (const touch of state.postMeetingTouches) {
    if (!leadIds.has(touch.leadId)) {
      issues.push({ code: "ORPHAN_TOUCH", message: `Touch ${touch.id} has no lead` });
    }
    if (!meetingIds.has(touch.meetingId)) {
      issues.push({ code: "ORPHAN_TOUCH_MEETING", message: `Touch ${touch.id} has no meeting` });
    }
  }
  if (state.sessions.filter((session) => session.endedAt === null).length > 1) {
    issues.push({ code: "MULTIPLE_ACTIVE_SESSIONS", message: "More than one calling session is active" });
  }
  return issues;
}

export function assertInvariants(state: CRMState): void {
  const issues = checkInvariants(state);
  if (issues.length > 0) {
    throw new DomainError(issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
  }
}

function shifted(iso: ISODateTime, milliseconds: number): ISODateTime {
  return new Date(new Date(iso).getTime() + milliseconds).toISOString();
}

export function createSampleState(now: ISODateTime | Date = new Date()): CRMState {
  const at = asIso(now);
  const seedAt = shifted(at, -16 * DAY_MS);
  let state = createEmptyState(seedAt);
  state = importLeads(
    state,
    [
      {
        clinicName: "Southside Plastic Surgery",
        websiteUrl: "https://southsideplastics.com",
        city: "Miami",
        state: "FL",
        timeZone: "America/New_York",
        decisionMakerName: "Sarah Johnson",
        decisionMakerRole: "Practice Manager",
        contactType: "practice_manager",
        directPhone: "(305) 555-0142",
        email: "sarah@southsideplastics.com",
        pixelPresent: "yes",
        trackingTechnologies: ["Meta Pixel"],
        primaryFinding: "Meta Pixel detected on the consultation form",
        findingCategory: "Tracking / Privacy",
        findingStrength: "A",
        securityGrade: "D",
        researchCompleted: true,
        priority: "high",
      },
      {
        clinicName: "Lakeside Dermatology",
        websiteUrl: "lakesidederm.com",
        city: "Austin",
        state: "TX",
        timeZone: "America/Chicago",
        decisionMakerName: "Michael Torres",
        decisionMakerRole: "Owner",
        contactType: "owner",
        directPhone: "512-555-0187",
        primaryFinding: "Missing Content Security Policy",
        findingCategory: "Security Headers",
        findingStrength: "B",
        researchCompleted: true,
      },
      {
        clinicName: "Pacific Dental Arts",
        websiteUrl: "pacificdentalarts.com",
        city: "San Diego",
        state: "CA",
        timeZone: "America/Los_Angeles",
        decisionMakerName: "Emily Chen",
        decisionMakerRole: "Office Manager",
        contactType: "office_manager",
        directPhone: "619-555-0135",
        pixelPresent: "yes",
        primaryFinding: "Analytics tracking on the appointment page",
        findingCategory: "Tracking / Privacy",
        findingStrength: "A",
        researchCompleted: true,
      },
      {
        clinicName: "Hudson Wellness Center",
        city: "New York",
        state: "NY",
        timeZone: "America/New_York",
        decisionMakerName: "James Cole",
        decisionMakerRole: "Clinic Director",
        contactType: "clinic_director",
        directPhone: "212-555-0119",
        findingCategory: "Configuration",
        findingStrength: "B",
        primaryFinding: "Exposed server version information",
        researchCompleted: true,
      },
      {
        clinicName: "Summit Orthopedics",
        city: "Denver",
        state: "CO",
        timeZone: "America/Denver",
        decisionMakerName: "Priya Shah",
        decisionMakerRole: "Administrator",
        contactType: "administrator",
        directPhone: "303-555-0171",
        findingCategory: "TLS",
        findingStrength: "C",
        primaryFinding: "Legacy TLS configuration",
        researchCompleted: true,
      },
      {
        clinicName: "Harbor Family Medicine",
        city: "Boston",
        state: "MA",
        timeZone: "America/New_York",
        decisionMakerName: "Laura Bennett",
        decisionMakerRole: "Owner",
        contactType: "owner",
        directPhone: "617-555-0158",
        findingCategory: "Security Headers",
        findingStrength: "A",
        primaryFinding: "Security header grade F",
        researchCompleted: true,
      },
      {
        clinicName: "Desert Eye Institute",
        city: "Phoenix",
        state: "AZ",
        timeZone: "America/Phoenix",
        decisionMakerName: "Anthony Reed",
        decisionMakerRole: "Practice Manager",
        contactType: "practice_manager",
        directPhone: "602-555-0193",
        findingCategory: "Information Exposure",
        findingStrength: "B",
        primaryFinding: "Public diagnostic endpoint",
        researchCompleted: true,
      },
      {
        clinicName: "Northstar Pediatrics",
        city: "Minneapolis",
        state: "MN",
        timeZone: "America/Chicago",
        decisionMakerName: "Olivia Park",
        decisionMakerRole: "Office Manager",
        contactType: "office_manager",
        directPhone: "612-555-0128",
        findingCategory: "Security Headers",
        findingStrength: "C",
        primaryFinding: "Missing browser protections",
        researchCompleted: true,
      },
      {
        clinicName: "Blue Ridge ENT",
        city: "Charlotte",
        state: "NC",
        timeZone: "America/New_York",
        decisionMakerName: "Daniel Brooks",
        decisionMakerRole: "Owner",
        contactType: "owner",
        directPhone: "704-555-0164",
        findingCategory: "Tracking / Privacy",
        findingStrength: "A",
        pixelPresent: "yes",
        primaryFinding: "Meta Pixel firing during appointment flow",
        researchCompleted: true,
      },
      {
        clinicName: "Evergreen Aesthetics",
        city: "Seattle",
        state: "WA",
        timeZone: "America/Los_Angeles",
        decisionMakerName: "Sophia Martinez",
        decisionMakerRole: "Practice Manager",
        contactType: "practice_manager",
        directPhone: "206-555-0106",
        findingCategory: "Configuration",
        findingStrength: "B",
        primaryFinding: "Unprotected administrative endpoint",
        researchCompleted: true,
      },
    ],
    { batchName: "August 2026 Demo Batch", source: "Sample data", fileName: "sample-leads.xlsx" },
    seedAt,
  );

  const idFor = (clinicName: string): string => {
    const id = state.leads.find((lead) => lead.clinicName === clinicName)?.id;
    if (!id) throw new DomainError(`Sample lead ${clinicName} is missing`);
    return id;
  };

  state = applyColdOutcome(
    state,
    idFor("Lakeside Dermatology"),
    { outcome: "no_answer", note: "No answer on first attempt" },
    shifted(seedAt, DAY_MS),
  );
  state = applyColdOutcome(
    state,
    idFor("Pacific Dental Arts"),
    { outcome: "callback", callbackAt: shifted(at, -10 * 60_000), note: "Call after morning patients" },
    shifted(seedAt, 2 * DAY_MS),
  );
  state = applyColdOutcome(
    state,
    idFor("Hudson Wellness Center"),
    { outcome: "interested", followUpAt: shifted(at, -45 * 60_000), note: "Wants compliance details" },
    shifted(seedAt, 3 * DAY_MS),
  );
  state = applyColdOutcome(
    state,
    idFor("Summit Orthopedics"),
    { outcome: "meeting_booked", meetingAt: shifted(at, 2 * 3_600_000), note: "Include IT manager" },
    shifted(seedAt, 4 * DAY_MS),
  );

  const harborId = idFor("Harbor Family Medicine");
  state = applyColdOutcome(
    state,
    harborId,
    { outcome: "meeting_booked", meetingAt: shifted(seedAt, 6 * DAY_MS), note: "Strong response" },
    shifted(seedAt, 5 * DAY_MS),
  );
  const harborMeeting = [...state.meetings].reverse().find((meeting) => meeting.leadId === harborId);
  if (harborMeeting) {
    state = completeMeeting(
      state,
      harborMeeting.id,
      {
        outcome: "decision_pending",
        note: "Owner reviewing with operations team",
        interestSummary: "Interested in a security assessment",
        mainObjection: "Needs internal approval",
      },
      shifted(seedAt, 6 * DAY_MS + 3_600_000),
    );
  }

  const desertId = idFor("Desert Eye Institute");
  state = applyColdOutcome(
    state,
    desertId,
    { outcome: "meeting_booked", meetingAt: shifted(seedAt, 8 * DAY_MS) },
    shifted(seedAt, 7 * DAY_MS),
  );
  const desertMeeting = [...state.meetings].reverse().find((meeting) => meeting.leadId === desertId);
  if (desertMeeting) {
    state = completeMeeting(
      state,
      desertMeeting.id,
      { outcome: "won", note: "Signed initial assessment engagement" },
      shifted(seedAt, 8 * DAY_MS + 3_600_000),
    );
  }

  state = applyColdOutcome(
    state,
    idFor("Northstar Pediatrics"),
    { outcome: "not_interested", lostReason: "Existing Provider", note: "Happy with current provider" },
    shifted(seedAt, 9 * DAY_MS),
  );
  state = applyColdOutcome(
    state,
    idFor("Blue Ridge ENT"),
    { outcome: "do_not_call", note: "Requested no further contact" },
    shifted(seedAt, 10 * DAY_MS),
  );
  const evergreenId = idFor("Evergreen Aesthetics");
  state = applyColdOutcome(state, evergreenId, { outcome: "no_answer" }, shifted(seedAt, DAY_MS));
  state = applyColdOutcome(state, evergreenId, { outcome: "no_answer" }, shifted(seedAt, 2 * DAY_MS));
  state = applyColdOutcome(state, evergreenId, { outcome: "no_answer" }, shifted(seedAt, 3 * DAY_MS));

  state = { ...state, undoStack: [], updatedAt: at };
  state = startSession(state, at);
  assertInvariants(state);
  return state;
}
