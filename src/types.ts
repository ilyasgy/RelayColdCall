export const CRM_SCHEMA_VERSION = 3 as const;

export type ISODateTime = string;
export type LeadPriority = "critical" | "high" | "normal" | "low";
export type PixelPresence = "yes" | "no" | "unknown";
export type FindingStrength = "A" | "B" | "C" | "unknown";
export type ContactType =
  | "owner"
  | "practice_manager"
  | "office_manager"
  | "clinic_director"
  | "administrator"
  | "other"
  | "unknown";

export type WorkflowStatus =
  | "new"
  | "retry_scheduled"
  | "recycle_later"
  | "extended_retry"
  | "callback"
  | "conversation_follow_up"
  | "interested"
  | "meeting_booked"
  | "second_meeting_booked"
  | "decision_pending"
  | "proposal_sent"
  | "post_meeting_follow_up"
  | "contact_data_required"
  | "research_required"
  | "not_interested"
  | "wrong_number"
  | "disqualified"
  | "archived"
  | "won"
  | "lost"
  | "do_not_call"
  | "dormant_unreachable"
  | "dormant_post_meeting_no_response";

export type PipelineStage =
  | "cold"
  | "engaged"
  | "meeting"
  | "post_meeting"
  | "client"
  | "closed"
  | "dormant";

export type NextActionType =
  | "cold_call"
  | "cold_retry"
  | "recycled_call"
  | "callback"
  | "interested_follow_up"
  | "post_meeting_follow_up"
  | "meeting"
  | "contact_data_correction"
  | "research"
  | "manual_review";

export type QueueClass =
  | "exact_callback"
  | "post_meeting_follow_up"
  | "interested_follow_up"
  | "cold_retry"
  | "new_cold"
  | "recycled";

export interface NextAction {
  id: string;
  leadId: string;
  type: NextActionType;
  dueAt: ISODateTime;
  exact: boolean;
  queueClass: QueueClass | "non_call";
  queueEligible: boolean;
  reason: string;
  createdAt: ISODateTime;
  scheduleTimeZone: string;
}

export interface Lead {
  id: string;
  clinicName: string;
  websiteUrl: string;
  websiteDomain: string;
  city: string;
  state: string;
  timeZone: string;
  specialty: string;
  practiceSize: string;

  decisionMakerFirstName: string;
  decisionMakerLastName: string;
  decisionMakerName: string;
  decisionMakerRole: string;
  personLinkedinUrl: string;
  contactType: ContactType;
  directPhone: string;
  mobilePhone: string;
  extension: string;
  email: string;
  alternatePhones: string[];

  pixelPresent: PixelPresence;
  trackingTechnologyFound: string;
  trackingTechnologies: string[];
  primaryFinding: string;
  secondaryFinding: string;
  findingCategory: string;
  findingStrength: FindingStrength;
  evidenceNotes: string;
  pitchNotes: string;
  securityGrade: string;
  researchCompleted: boolean;

  status: WorkflowStatus;
  pipelineStage: PipelineStage;
  priority: LeadPriority;
  coldAttemptCount: number;
  coldNoAnswerCount: number;
  recycleCycle: number;
  postMeetingTouchCount: number;
  firstCalledAt: ISODateTime | null;
  lastCalledAt: ISODateTime | null;
  lastOutcome: string;
  lastConversationNotes: string;
  callbackAt: ISODateTime | null;
  followUpAt: ISODateTime | null;
  nextAction: NextAction | null;
  lostReason: string;
  doNotCall: boolean;
  badNumber: boolean;

  importedAt: ISODateTime;
  batchId: string;
  assignedCaller: string;
  customFields: Record<string, string>;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  revision: number;
}

export type ActivityType =
  | "lead_imported"
  | "lead_updated"
  | "call_attempt"
  | "note"
  | "callback_scheduled"
  | "follow_up_scheduled"
  | "meeting_booked"
  | "meeting_completed"
  | "post_meeting_touch"
  | "status_changed"
  | "session_started"
  | "session_ended"
  | "lead_reopened"
  | "action_undone";

export interface Activity {
  id: string;
  leadId: string | null;
  type: ActivityType;
  occurredAt: ISODateTime;
  title: string;
  note: string;
  metadata: Record<string, string | number | boolean | null>;
  voidedAt: ISODateTime | null;
}

export type CallContext =
  | "cold"
  | "cold_retry"
  | "recycled"
  | "callback"
  | "interested_follow_up"
  | "post_meeting";

export type ColdCallOutcome =
  | "no_answer"
  | "callback"
  | "meeting_booked"
  | "interested"
  | "follow_up"
  | "not_interested"
  | "disqualified"
  | "won"
  | "lost"
  | "do_not_call"
  | "wrong_person"
  | "bad_number"
  | "other";

export interface CallAttempt {
  id: string;
  leadId: string;
  sessionId: string | null;
  occurredAt: ISODateTime;
  context: CallContext;
  outcome: ColdCallOutcome | PostMeetingOutcomeKind;
  coldAttemptNumber: number | null;
  coldNoAnswerNumber: number | null;
  postMeetingTouchNumber: number | null;
  answered: boolean;
  meaningfulConversation: boolean;
  note: string;
  durationSeconds: number | null;
  batchIdSnapshot: string;
  contactTypeSnapshot: ContactType;
  pixelPresentSnapshot: PixelPresence;
  findingCategorySnapshot: string;
  findingStrengthSnapshot: FindingStrength;
  voidedAt: ISODateTime | null;
}

export type MeetingStatus = "booked" | "completed" | "cancelled" | "no_show" | "reschedule_needed";
export type MeetingOutcome =
  | "won"
  | "decision_pending"
  | "follow_up_needed"
  | "second_meeting_needed"
  | "proposal_sent"
  | "lost";

export interface Meeting {
  id: string;
  leadId: string;
  scheduledAt: ISODateTime;
  durationMinutes: number;
  meetingType: string;
  contactEmail: string;
  status: MeetingStatus;
  outcome: MeetingOutcome | null;
  notes: string;
  interestSummary: string;
  mainObjection: string;
  decisionStatus: string;
  completedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  voidedAt: ISODateTime | null;
}

export type PostMeetingTouchType = "phone" | "email" | "callback" | "other";
export type PostMeetingOutcomeKind =
  | "no_answer"
  | "still_deciding"
  | "needs_internal_approval"
  | "requested_callback"
  | "second_meeting_booked"
  | "proposal_sent"
  | "won"
  | "lost"
  | "do_not_contact";

export interface PostMeetingTouch {
  id: string;
  leadId: string;
  meetingId: string;
  touchNumber: number;
  type: PostMeetingTouchType;
  outcome: PostMeetingOutcomeKind;
  dueAt: ISODateTime;
  status: "completed";
  completedAt: ISODateTime;
  occurredAt: ISODateTime;
  note: string;
  approver: string;
  nextScheduledAt: ISODateTime | null;
  callAttemptId: string | null;
  voidedAt: ISODateTime | null;
}

export interface CallingSession {
  id: string;
  startedAt: ISODateTime;
  endedAt: ISODateTime | null;
  currentLeadId: string | null;
  dailyGoalSnapshot: number;
}

export interface ImportBatch {
  id: string;
  name: string;
  source: string;
  fileName: string;
  importedAt: ISODateTime;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  skippedCount: number;
}

export interface CallingSettings {
  dailyCallGoal: number;
  callingHoursStart: string;
  callingHoursEnd: string;
  callingWeekdays: number[];
  defaultRetryDelayBusinessDays: number;
  retryDelaysBusinessDays: number[];
  maximumInitialAttempts: number;
  recycleDelayBusinessDays: number;
  maximumLifetimeAttempts: number;
  highValueExtendedAttemptsOnly: boolean;
  retryTimeBuckets: string[];
  exactCallbacksOverrideCallingHours: boolean;
  holidayDates: string[];
}

export interface QueueSettings {
  classOrder: QueueClass[];
  pixelPriority: number;
  findingStrengthPriority: Record<FindingStrength, number>;
  ownerPriority: number;
  manualPriority: Record<LeadPriority, number>;
}

export interface MeetingSettings {
  defaultDurationMinutes: number;
  reminderMinutes: number[];
}

export interface FollowUpSettings {
  maximumPostMeetingTouches: number;
  cadenceBusinessDays: number[];
}

export interface InterfaceSettings {
  density: "compact" | "comfortable";
  theme: "dark" | "light";
  keyboardShortcutsEnabled: boolean;
  shortcuts: Record<string, string>;
}

export interface DataSettings {
  lastBackupAt: ISODateTime | null;
  backupReminderDays: number;
  persistentStorageGranted: boolean | null;
}

export interface CRMSettings {
  calling: CallingSettings;
  queue: QueueSettings;
  meetings: MeetingSettings;
  followUp: FollowUpSettings;
  interface: InterfaceSettings;
  data: DataSettings;
  defaultLeadTimeZone: string;
}

export interface UndoEntry {
  id: string;
  label: string;
  createdAt: ISODateTime;
  leadBefore: Lead;
  meetingBefore: Meeting | null;
  createdActivityIds: string[];
  createdCallAttemptIds: string[];
  createdMeetingIds: string[];
  createdTouchIds: string[];
}

export interface CRMState {
  schemaVersion: number;
  revision: number;
  nextSequence: number;
  leads: Lead[];
  activities: Activity[];
  callAttempts: CallAttempt[];
  meetings: Meeting[];
  postMeetingTouches: PostMeetingTouch[];
  sessions: CallingSession[];
  batches: ImportBatch[];
  settings: CRMSettings;
  undoStack: UndoEntry[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ColdOutcomeInput {
  outcome: ColdCallOutcome;
  note?: string;
  callbackAt?: ISODateTime;
  followUpAt?: ISODateTime;
  meetingAt?: ISODateTime;
  meetingType?: string;
  meetingDurationMinutes?: number;
  contactEmail?: string;
  lostReason?: string;
  replacementName?: string;
  replacementRole?: string;
  replacementPhone?: string;
  nextActionAt?: ISODateTime;
  durationSeconds?: number;
}

export interface MeetingOutcomeInput {
  outcome: MeetingOutcome;
  note?: string;
  nextAt?: ISODateTime;
  secondMeetingAt?: ISODateTime;
  secondMeetingType?: string;
  lostReason?: string;
  interestSummary?: string;
  mainObjection?: string;
  decisionStatus?: string;
}

export interface PostMeetingOutcomeInput {
  outcome: PostMeetingOutcomeKind;
  touchType?: PostMeetingTouchType;
  note?: string;
  approver?: string;
  callbackAt?: ISODateTime;
  nextAt?: ISODateTime;
  secondMeetingAt?: ISODateTime;
  secondMeetingType?: string;
  lostReason?: string;
  durationSeconds?: number;
}

export interface LeadImportInput
  extends Partial<
    Omit<
      Lead,
      | "id"
      | "status"
      | "pipelineStage"
      | "coldAttemptCount"
      | "coldNoAnswerCount"
      | "recycleCycle"
      | "postMeetingTouchCount"
      | "firstCalledAt"
      | "lastCalledAt"
      | "lastOutcome"
      | "callbackAt"
      | "followUpAt"
      | "nextAction"
      | "doNotCall"
      | "badNumber"
      | "importedAt"
      | "createdAt"
      | "updatedAt"
      | "revision"
    >
  > {
  clinicName: string;
}

export interface QueueCandidate {
  lead: Lead;
  action: NextAction;
  classRank: number;
  priorityScore: number;
  overdueMinutes: number;
  prospectLocalTime: string;
  rankReason: string[];
}

export interface AnalyticsDimensionRow {
  key: string;
  dials: number;
  answered: number;
  conversations: number;
  meetings: number;
  clients: number;
  answerRate: number;
  meetingRate: number;
  clientRate: number;
}

export interface AttemptPerformanceRow {
  attempt: number;
  dials: number;
  answered: number;
  conversations: number;
  connectionRate: number;
}

export interface AnalyticsSummary {
  totalDials: number;
  uniqueLeadsCalled: number;
  answeredCalls: number;
  realConversations: number;
  noAnswers: number;
  badNumbers: number;
  callbacks: number;
  meetingsBooked: number;
  meetingsHeld: number;
  clientsWon: number;
  leadsLost: number;
  answerRate: number;
  conversationRate: number;
  conversationToMeetingRate: number;
  dialToMeetingRate: number;
  meetingShowRate: number;
  meetingToClientRate: number;
  leadToClientRate: number;
  dialToClientRate: number;
  averageAttemptsBeforeConversation: number;
  averageAttemptsBeforeMeeting: number;
  byFinding: AnalyticsDimensionRow[];
  byContactType: AnalyticsDimensionRow[];
  byAttempt: AttemptPerformanceRow[];
}

export interface AnalyticsOptions {
  from?: ISODateTime;
  to?: ISODateTime;
  batchId?: string;
}

export interface DomainInvariantViolation {
  code: string;
  message: string;
  leadId?: string;
}

export interface PersistenceStatus {
  supported: boolean;
  persisted: boolean;
  source: "indexeddb" | "localstorage" | "memory";
}
