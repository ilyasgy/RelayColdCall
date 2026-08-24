import {
  CRM_SCHEMA_VERSION,
  type CRMSettings,
  type CRMState,
  type QueueClass,
  type WorkflowStatus,
} from "../types";

export const DEFAULT_QUEUE_CLASS_ORDER: QueueClass[] = [
  "post_meeting_follow_up",
  "exact_callback",
  "interested_follow_up",
  "cold_retry",
  "new_cold",
  "recycled",
];

export const TERMINAL_STATUSES: ReadonlySet<WorkflowStatus> = new Set([
  "won",
  "lost",
  "not_interested",
  "wrong_number",
  "disqualified",
  "archived",
  "do_not_call",
  "dormant_unreachable",
  "dormant_post_meeting_no_response",
]);

export const DEFAULT_SETTINGS: CRMSettings = {
  calling: {
    dailyCallGoal: 100,
    callingHoursStart: "08:30",
    callingHoursEnd: "17:30",
    callingWeekdays: [1, 2, 3, 4, 5],
    defaultRetryDelayBusinessDays: 1,
    retryDelaysBusinessDays: [1, 2],
    maximumInitialAttempts: 3,
    recycleDelayBusinessDays: 14,
    maximumLifetimeAttempts: 3,
    highValueExtendedAttemptsOnly: false,
    retryTimeBuckets: ["09:15", "13:30", "16:15"],
    exactCallbacksOverrideCallingHours: true,
    holidayDates: [],
  },
  queue: {
    classOrder: [...DEFAULT_QUEUE_CLASS_ORDER],
    pixelPriority: 20,
    findingStrengthPriority: { A: 30, B: 15, C: 5, unknown: 0 },
    ownerPriority: 10,
    manualPriority: { critical: 400, high: 200, normal: 100, low: 0 },
  },
  meetings: {
    defaultDurationMinutes: 30,
    reminderMinutes: [30],
  },
  followUp: {
    maximumPostMeetingTouches: 5,
    cadenceBusinessDays: [1, 3, 5, 7, 4],
  },
  interface: {
    density: "compact",
    theme: "dark",
    keyboardShortcutsEnabled: true,
    shortcuts: {
      noAnswer: "n",
      callback: "c",
      meeting: "m",
      interested: "i",
      followUp: "f",
      lost: "l",
      badNumber: "b",
      wrongPerson: "w",
      doNotCall: "d",
      notes: "space",
      confirm: "enter",
      undo: "ctrl+z",
    },
  },
  data: {
    lastBackupAt: null,
    backupReminderDays: 7,
    persistentStorageGranted: null,
  },
  defaultLeadTimeZone: "America/New_York",
};

export function cloneDefaultSettings(): CRMSettings {
  return {
    ...DEFAULT_SETTINGS,
    calling: {
      ...DEFAULT_SETTINGS.calling,
      callingWeekdays: [...DEFAULT_SETTINGS.calling.callingWeekdays],
      retryDelaysBusinessDays: [...DEFAULT_SETTINGS.calling.retryDelaysBusinessDays],
      retryTimeBuckets: [...DEFAULT_SETTINGS.calling.retryTimeBuckets],
      holidayDates: [...DEFAULT_SETTINGS.calling.holidayDates],
    },
    queue: {
      ...DEFAULT_SETTINGS.queue,
      classOrder: [...DEFAULT_SETTINGS.queue.classOrder],
      findingStrengthPriority: { ...DEFAULT_SETTINGS.queue.findingStrengthPriority },
      manualPriority: { ...DEFAULT_SETTINGS.queue.manualPriority },
    },
    meetings: {
      ...DEFAULT_SETTINGS.meetings,
      reminderMinutes: [...DEFAULT_SETTINGS.meetings.reminderMinutes],
    },
    followUp: {
      ...DEFAULT_SETTINGS.followUp,
      cadenceBusinessDays: [...DEFAULT_SETTINGS.followUp.cadenceBusinessDays],
    },
    interface: {
      ...DEFAULT_SETTINGS.interface,
      shortcuts: { ...DEFAULT_SETTINGS.interface.shortcuts },
    },
    data: { ...DEFAULT_SETTINGS.data },
  };
}

export function createEmptyState(now: string = new Date().toISOString()): CRMState {
  return {
    schemaVersion: CRM_SCHEMA_VERSION,
    revision: 0,
    nextSequence: 1,
    leads: [],
    activities: [],
    callAttempts: [],
    meetings: [],
    postMeetingTouches: [],
    sessions: [],
    batches: [],
    settings: cloneDefaultSettings(),
    undoStack: [],
    createdAt: now,
    updatedAt: now,
  };
}
