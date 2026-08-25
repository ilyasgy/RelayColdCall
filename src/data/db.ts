import { createEmptyState, cloneDefaultSettings, TERMINAL_STATUSES } from "./defaults";
import { CRM_SCHEMA_VERSION, type CRMSettings, type CRMState, type Lead, type PersistenceStatus } from "../types";

const DATABASE_NAME = "relay-cold-call-crm";
const DATABASE_VERSION = 1;
const OBJECT_STORE = "aggregate";
const STATE_KEY = "crm-state";
const LOCAL_STORAGE_KEY = "relay-cold-call-crm:state:v1";

let memoryFallback: CRMState | null = null;
let lastSource: PersistenceStatus["source"] = "memory";

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function canUseLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function repairedColdRetryDueAt(
  lead: Partial<Lead>,
  now: string,
  settings: CRMSettings,
): string {
  const basis = new Date(lead.lastCalledAt ?? lead.updatedAt ?? now);
  const candidate = Number.isNaN(basis.getTime()) ? new Date(now) : basis;
  const weekdays = settings.calling.callingWeekdays;
  const holidays = new Set(settings.calling.holidayDates);
  for (let offset = 0; offset < 14; offset += 1) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
    const dateKey = candidate.toISOString().slice(0, 10);
    if (weekdays.includes(candidate.getUTCDay()) && !holidays.has(dateKey)) return candidate.toISOString();
  }
  candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate.toISOString();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE)) {
        database.createObjectStore(OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade was blocked by another tab"));
  });
}

async function readIndexedDb(): Promise<unknown> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readonly");
      const request = transaction.objectStore(OBJECT_STORE).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to read CRM state"));
      transaction.onabort = () => reject(transaction.error ?? new Error("CRM read was aborted"));
    });
  } finally {
    database.close();
  }
}

async function writeIndexedDb(state: CRMState): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      transaction.objectStore(OBJECT_STORE).put(state, STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to save CRM state"));
      transaction.onabort = () => reject(transaction.error ?? new Error("CRM save was aborted"));
    });
  } finally {
    database.close();
  }
}

async function clearIndexedDb(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      transaction.objectStore(OBJECT_STORE).delete(STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to clear CRM state"));
      transaction.onabort = () => reject(transaction.error ?? new Error("CRM clear was aborted"));
    });
  } finally {
    database.close();
  }
}

function mergeSettings(raw: Partial<CRMSettings> | undefined): CRMSettings {
  const defaults = cloneDefaultSettings();
  if (!raw) return defaults;
  return {
    ...defaults,
    ...raw,
    calling: {
      ...defaults.calling,
      ...raw.calling,
      callingWeekdays: [...(raw.calling?.callingWeekdays ?? defaults.calling.callingWeekdays)],
      retryDelaysBusinessDays: [
        ...(raw.calling?.retryDelaysBusinessDays ?? defaults.calling.retryDelaysBusinessDays),
      ],
      retryTimeBuckets: [...(raw.calling?.retryTimeBuckets ?? defaults.calling.retryTimeBuckets)],
      holidayDates: [...(raw.calling?.holidayDates ?? defaults.calling.holidayDates)],
    },
    queue: {
      ...defaults.queue,
      ...raw.queue,
      classOrder: [...(raw.queue?.classOrder ?? defaults.queue.classOrder)],
      findingStrengthPriority: {
        ...defaults.queue.findingStrengthPriority,
        ...raw.queue?.findingStrengthPriority,
      },
      manualPriority: { ...defaults.queue.manualPriority, ...raw.queue?.manualPriority },
    },
    meetings: {
      ...defaults.meetings,
      ...raw.meetings,
      reminderMinutes: [...(raw.meetings?.reminderMinutes ?? defaults.meetings.reminderMinutes)],
    },
    followUp: {
      ...defaults.followUp,
      ...raw.followUp,
      cadenceBusinessDays: [
        ...(raw.followUp?.cadenceBusinessDays ?? defaults.followUp.cadenceBusinessDays),
      ],
    },
    interface: {
      ...defaults.interface,
      ...raw.interface,
      shortcuts: { ...defaults.interface.shortcuts, ...raw.interface?.shortcuts },
    },
    data: { ...defaults.data, ...raw.data },
  };
}

/**
 * Adds defaults for newly introduced fields. Future schema migrations should be
 * added here and should never discard activity/history records.
 */
export function migrateState(raw: unknown): CRMState | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<CRMState>;
  const now = source.updatedAt ?? new Date().toISOString();
  const empty = createEmptyState(now);
  const mergedSettings = mergeSettings(source.settings);
  const settings: CRMSettings = {
    ...mergedSettings,
    calling: {
      ...mergedSettings.calling,
      retryDelaysBusinessDays: [1, 1],
      maximumInitialAttempts: 3,
      maximumLifetimeAttempts: 3,
    },
    queue: {
      ...mergedSettings.queue,
      classOrder: [
        "post_meeting_follow_up",
        "exact_callback",
        "interested_follow_up",
        "cold_retry",
        "new_cold",
        "recycled",
      ],
    },
  };
  const priorSchemaVersion = typeof source.schemaVersion === "number" ? source.schemaVersion : 1;
  const leads = Array.isArray(source.leads)
    ? source.leads.map((lead) => {
        const sourceLead = lead as Partial<Lead>;
        const customFields = sourceLead.customFields && typeof sourceLead.customFields === "object"
          ? { ...sourceLead.customFields }
          : {};
        const takeCustomField = (...names: string[]) => {
          const key = Object.keys(customFields).find((candidate) =>
            names.some((name) => candidate.trim().toLowerCase() === name.toLowerCase()),
          );
          if (!key) return "";
          const value = customFields[key] ?? "";
          delete customFields[key];
          return value;
        };
        const decisionMakerFirstName = sourceLead.decisionMakerFirstName
          ?? takeCustomField("Decision-Maker First Name", "Decision Maker First Name", "First Name");
        const decisionMakerLastName = sourceLead.decisionMakerLastName
          ?? takeCustomField("Last Name", "Decision-Maker Last Name", "Decision Maker Last Name");
        const personLinkedinUrl = sourceLead.personLinkedinUrl
          ?? takeCustomField("Person Linkedin Url", "Person LinkedIn URL", "LinkedIn URL");
        const trackingTechnologyFound = sourceLead.trackingTechnologyFound
          ?? (takeCustomField("Tracking Technology Found") || (sourceLead.trackingTechnologies ?? []).join(" | "));
        let migrated = {
          ...lead,
          decisionMakerFirstName,
          decisionMakerLastName,
          decisionMakerName: sourceLead.decisionMakerName
            ?? [decisionMakerFirstName, decisionMakerLastName].filter(Boolean).join(" "),
          personLinkedinUrl,
          trackingTechnologyFound,
          customFields,
        } as Lead;
        if (
          priorSchemaVersion < 2
          && (migrated.status === "recycle_later" || migrated.status === "extended_retry")
          && migrated.coldNoAnswerCount >= 3
        ) {
          migrated = {
            ...migrated,
            status: "dormant_unreachable" as const,
            pipelineStage: "dormant" as const,
            nextAction: null,
            updatedAt: now,
          };
        }
        if (
          migrated.lastOutcome === "no_answer"
          && migrated.pipelineStage === "cold"
          && migrated.coldNoAnswerCount >= 3
          && !TERMINAL_STATUSES.has(migrated.status)
        ) {
          migrated = {
            ...migrated,
            status: "dormant_unreachable",
            pipelineStage: "dormant",
            nextAction: null,
            updatedAt: now,
          };
        } else if (
          migrated.lastOutcome === "no_answer"
          && migrated.pipelineStage === "cold"
          && migrated.coldNoAnswerCount > 0
          && migrated.coldNoAnswerCount < 3
          && (
            migrated.nextAction?.type !== "cold_retry"
            || !migrated.nextAction.dueAt
            || Number.isNaN(new Date(migrated.nextAction.dueAt).getTime())
          )
        ) {
          const dueAt = repairedColdRetryDueAt(migrated, now, settings);
          migrated = {
            ...migrated,
            status: "retry_scheduled",
            nextAction: {
              id: `action_repaired_${migrated.id}`,
              leadId: migrated.id,
              type: "cold_retry",
              dueAt,
              exact: false,
              queueClass: "cold_retry",
              queueEligible: true,
              reason: `Retry — no answer attempt ${migrated.coldNoAnswerCount}`,
              createdAt: migrated.lastCalledAt ?? now,
              scheduleTimeZone: migrated.timeZone,
            },
            updatedAt: now,
          };
        }
        return migrated;
      })
    : [];
  const postMeetingTouches = Array.isArray(source.postMeetingTouches)
    ? source.postMeetingTouches.map((touch) => ({
        ...touch,
        dueAt: touch.dueAt ?? touch.occurredAt,
        status: "completed" as const,
        completedAt: touch.completedAt ?? touch.occurredAt,
      }))
    : [];
  return {
    ...empty,
    ...source,
    schemaVersion: CRM_SCHEMA_VERSION,
    revision: source.revision ?? 0,
    nextSequence: source.nextSequence ?? 1,
    leads,
    activities: Array.isArray(source.activities) ? source.activities : [],
    callAttempts: Array.isArray(source.callAttempts) ? source.callAttempts : [],
    meetings: Array.isArray(source.meetings) ? source.meetings : [],
    postMeetingTouches,
    sessions: Array.isArray(source.sessions) ? source.sessions : [],
    batches: Array.isArray(source.batches) ? source.batches : [],
    undoStack: Array.isArray(source.undoStack) ? source.undoStack : [],
    settings,
    createdAt: source.createdAt ?? now,
    updatedAt: now,
  };
}

async function statusFor(source: PersistenceStatus["source"]): Promise<PersistenceStatus> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  let persisted = false;
  if (storage?.persisted) {
    try {
      persisted = await storage.persisted();
    } catch {
      persisted = false;
    }
  }
  return { supported: canUseIndexedDb(), persisted, source };
}

export interface LoadedCRMState {
  state: CRMState | null;
  status: PersistenceStatus;
}

export async function loadState(): Promise<LoadedCRMState> {
  if (canUseIndexedDb()) {
    try {
      const stored = migrateState(await readIndexedDb());
      if (stored) {
        memoryFallback = stored;
        lastSource = "indexeddb";
        return { state: stored, status: await statusFor(lastSource) };
      }
    } catch {
      // Continue to the localStorage fallback.
    }
  }

  if (canUseLocalStorage()) {
    try {
      const value = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (value) {
        const stored = migrateState(JSON.parse(value));
        if (stored) {
          memoryFallback = stored;
          lastSource = "localstorage";
          return { state: stored, status: await statusFor(lastSource) };
        }
      }
    } catch {
      // Continue to the in-memory fallback.
    }
  }
  lastSource = "memory";
  return {
    state: memoryFallback ? migrateState(memoryFallback) : null,
    status: await statusFor(lastSource),
  };
}

export async function saveState(state: CRMState): Promise<PersistenceStatus> {
  memoryFallback = state;
  if (canUseIndexedDb()) {
    try {
      await writeIndexedDb(state);
      lastSource = "indexeddb";
      return statusFor(lastSource);
    } catch {
      // Continue to the localStorage fallback.
    }
  }

  if (canUseLocalStorage()) {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
      lastSource = "localstorage";
      return statusFor(lastSource);
    } catch {
      // The in-memory copy remains available for this runtime.
    }
  }
  lastSource = "memory";
  return statusFor(lastSource);
}

export async function clearState(): Promise<void> {
  memoryFallback = null;
  if (canUseIndexedDb()) {
    try {
      await clearIndexedDb();
    } catch {
      // Continue so the fallbacks are still cleared.
    }
  }
  if (canUseLocalStorage()) {
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // No remaining recoverable fallback.
    }
  }
  lastSource = canUseIndexedDb() ? "indexeddb" : canUseLocalStorage() ? "localstorage" : "memory";
}

export async function requestPersistentStorage(): Promise<PersistenceStatus> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage?.persist) {
    return { supported: false, persisted: false, source: lastSource };
  }
  try {
    const alreadyPersisted = storage.persisted ? await storage.persisted() : false;
    const persisted = alreadyPersisted || (await storage.persist());
    return { supported: true, persisted, source: lastSource };
  } catch {
    return { supported: true, persisted: false, source: lastSource };
  }
}

export function getPersistenceSource(): PersistenceStatus["source"] {
  return lastSource;
}
