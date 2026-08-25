import { describe, expect, it } from "vitest";
import { createEmptyState } from "../data/defaults";
import { clearState, loadState, migrateState, requestPersistentStorage, saveState } from "../data/db";
import type { CRMState, LeadImportInput } from "../types";
import {
  addBusinessDays,
  applyColdOutcome,
  applyPostMeetingOutcome,
  assertInvariants,
  completeMeeting,
  computeAnalytics,
  createSampleState,
  findDuplicateLeadIds,
  getQueue,
  importLeads,
  reopenLead,
  startSession,
  undoLastAction,
} from "./engine";

const NOW = "2026-08-24T14:00:00.000Z"; // Monday, 10:00 AM in New York.
const DAY = 86_400_000;

function shift(iso: string, milliseconds: number): string {
  return new Date(new Date(iso).getTime() + milliseconds).toISOString();
}

function leadInput(name = "Acme Clinic", overrides: Partial<LeadImportInput> = {}): LeadImportInput {
  return {
    clinicName: name,
    websiteUrl: `${name.toLowerCase().replaceAll(" ", "")}.com`,
    city: "New York",
    state: "NY",
    timeZone: "America/New_York",
    decisionMakerName: "Alex Morgan",
    decisionMakerRole: "Owner",
    contactType: "owner",
    directPhone: "212-555-0100",
    primaryFinding: "Missing Content Security Policy",
    findingCategory: "Security Headers",
    findingStrength: "A",
    pixelPresent: "no",
    researchCompleted: true,
    ...overrides,
  };
}

function imported(inputs = [leadInput()]): CRMState {
  return importLeads(createEmptyState(NOW), inputs, { batchName: "Test Batch" }, NOW);
}

function onlyLead(state: CRMState) {
  expect(state.leads).toHaveLength(1);
  return state.leads[0];
}

function bookAndCompletePending(state: CRMState, leadId: string, at = NOW): CRMState {
  let next = applyColdOutcome(
    state,
    leadId,
    { outcome: "meeting_booked", meetingAt: shift(at, 60 * 60_000) },
    at,
  );
  const meeting = next.meetings.find((row) => row.leadId === leadId);
  expect(meeting).toBeDefined();
  next = completeMeeting(
    next,
    meeting!.id,
    { outcome: "decision_pending", note: "Reviewing internally" },
    shift(at, 2 * 60 * 60_000),
  );
  return next;
}

describe("business-day scheduling", () => {
  it("skips weekends while preserving a prospect-local call time", () => {
    const friday = "2026-08-21T14:00:00.000Z";
    expect(addBusinessDays(friday, 1, "America/New_York", { time: "09:15" })).toBe(
      "2026-08-24T13:15:00.000Z",
    );
  });

  it("converts through a daylight-saving boundary", () => {
    const beforeDstWeekend = "2026-03-06T15:00:00.000Z";
    expect(addBusinessDays(beforeDstWeekend, 1, "America/New_York", { time: "09:15" })).toBe(
      "2026-03-09T13:15:00.000Z",
    );
  });

  it("skips configured holidays", () => {
    const monday = "2026-08-24T14:00:00.000Z";
    expect(
      addBusinessDays(monday, 1, "America/New_York", {
        time: "09:15",
        holidays: ["2026-08-25"],
      }),
    ).toBe("2026-08-26T13:15:00.000Z");
  });
});

describe("imports and invariants", () => {
  it("creates call-ready and correction-required leads without mutating the source state", () => {
    const empty = createEmptyState(NOW);
    const result = importLeads(
      empty,
      [leadInput("Ready Clinic"), leadInput("No Phone Clinic", { directPhone: "" })],
      {},
      NOW,
    );

    expect(empty.leads).toHaveLength(0);
    expect(result.leads[0].status).toBe("new");
    expect(result.leads[0].nextAction?.type).toBe("cold_call");
    expect(result.leads[1].status).toBe("contact_data_required");
    expect(result.leads[1].nextAction?.queueEligible).toBe(false);
    expect(() => assertInvariants(result)).not.toThrow();
  });

  it("uses clinic plus website as the primary re-import match while retaining safe fallbacks", () => {
    const state = imported();
    expect(findDuplicateLeadIds(state, leadInput("Different", { websiteUrl: "acmeclinic.com", directPhone: "646-555-0199" }))).toEqual([]);
    expect(findDuplicateLeadIds(state, leadInput("Acme Clinic", { websiteUrl: "acmeclinic.com", directPhone: "646-555-0199" }))).toEqual([
      state.leads[0].id,
    ]);
    const skipped = importLeads(
      state,
      [leadInput("Duplicate", { websiteUrl: "different.example", directPhone: "212-555-0100" })],
      { duplicateStrategy: "skip" },
      shift(NOW, 1_000),
    );
    expect(skipped.leads).toHaveLength(1);
    expect(skipped.batches.at(-1)?.duplicateCount).toBe(1);
  });

  it("migrates recoverable source columns without disturbing workflow history", () => {
    const state = imported();
    const legacy = structuredClone(state) as CRMState & { schemaVersion: number };
    legacy.schemaVersion = 2;
    const legacyLead = legacy.leads[0] as Partial<(typeof legacy.leads)[number]>;
    delete legacyLead.decisionMakerFirstName;
    delete legacyLead.decisionMakerLastName;
    delete legacyLead.personLinkedinUrl;
    delete legacyLead.trackingTechnologyFound;
    legacyLead.trackingTechnologies = ["Meta Pixel", "GTM", "Google Analytics"];
    legacyLead.customFields = {
      "Decision-Maker First Name": "Alex",
      "Last Name": "Morgan",
      "Person Linkedin Url": "https://linkedin.com/in/alex-morgan",
    };

    const migrated = migrateState(legacy);
    expect(migrated?.leads[0]).toMatchObject({
      decisionMakerFirstName: "Alex",
      decisionMakerLastName: "Morgan",
      personLinkedinUrl: "https://linkedin.com/in/alex-morgan",
      trackingTechnologyFound: "Meta Pixel | GTM | Google Analytics",
      coldAttemptCount: state.leads[0].coldAttemptCount,
    });
    expect(migrated?.activities).toEqual(state.activities);
  });
});

describe("cold-call transitions", () => {
  it("creates next-calling-day retries and finishes an unreachable lead after the third unanswered attempt", () => {
    const initial = imported();
    const leadId = initial.leads[0].id;
    let state = initial;

    state = applyColdOutcome(state, leadId, { outcome: "no_answer" }, NOW);
    expect(state.leads[0]).toMatchObject({
      status: "retry_scheduled",
      coldAttemptCount: 1,
      coldNoAnswerCount: 1,
    });
    const firstRetry = state.leads[0].nextAction!;
    expect(firstRetry).toMatchObject({
      type: "cold_retry",
      queueClass: "cold_retry",
      queueEligible: true,
      reason: "Retry — no answer attempt 1",
    });
    expect(firstRetry.dueAt.slice(0, 10)).toBe("2026-08-25");
    expect(getQueue(state, firstRetry.dueAt).map((candidate) => candidate.lead.id)).toContain(leadId);

    const missingRetry = {
      ...state,
      leads: [{ ...state.leads[0], nextAction: null }],
    };
    expect(() => assertInvariants(missingRetry)).toThrow("NO_ANSWER_MISSING_RETRY");

    state = applyColdOutcome(state, leadId, { outcome: "no_answer" }, firstRetry.dueAt);
    expect(state.leads[0].status).toBe("retry_scheduled");
    const secondRetry = state.leads[0].nextAction!;
    expect(secondRetry.reason).toBe("Retry — no answer attempt 2");
    expect(secondRetry.dueAt.slice(0, 10)).toBe("2026-08-26");

    state = applyColdOutcome(state, leadId, { outcome: "no_answer" }, secondRetry.dueAt);
    expect(state.leads[0]).toMatchObject({
      status: "dormant_unreachable",
      pipelineStage: "dormant",
      coldAttemptCount: 3,
      coldNoAnswerCount: 3,
      nextAction: null,
    });
    expect(() => assertInvariants(state)).not.toThrow();
  });

  it("repairs a saved cold No Answer lead that is missing its retry action", () => {
    let state = imported();
    state = applyColdOutcome(state, state.leads[0].id, { outcome: "no_answer" }, NOW);
    const broken = structuredClone(state);
    broken.leads[0].status = "new";
    broken.leads[0].nextAction = null;

    const repaired = migrateState(broken);
    expect(repaired?.leads[0]).toMatchObject({
      status: "retry_scheduled",
      nextAction: {
        type: "cold_retry",
        queueClass: "cold_retry",
        queueEligible: true,
        reason: "Retry — no answer attempt 1",
      },
    });
    expect(repaired?.leads[0].nextAction?.dueAt).toBeTruthy();
    expect(() => assertInvariants(repaired!)).not.toThrow();
  });

  it("records an exact callback and permanently excludes do-not-call leads", () => {
    let state = imported([leadInput("Callback Clinic"), leadInput("DNC Clinic", { directPhone: "2125550101" })]);
    const callbackId = state.leads[0].id;
    const dncId = state.leads[1].id;
    state = applyColdOutcome(
      state,
      callbackId,
      { outcome: "callback", callbackAt: shift(NOW, -60_000) },
      shift(NOW, -DAY),
    );
    state = applyColdOutcome(state, dncId, { outcome: "do_not_call" }, shift(NOW, -DAY));

    expect(state.leads[0].nextAction).toMatchObject({
      exact: true,
      queueClass: "exact_callback",
    });
    expect(state.leads[1]).toMatchObject({ status: "do_not_call", doNotCall: true, nextAction: null });
    expect(getQueue(state, NOW).map((row) => row.lead.id)).not.toContain(dncId);
    expect(() => assertInvariants(state)).not.toThrow();
  });

  it("finishes a wrong-number lead while retaining its contact data and history", () => {
    let state = imported([leadInput("Alternate Clinic", { alternatePhones: ["917-555-0102"] })]);
    state = applyColdOutcome(state, state.leads[0].id, { outcome: "bad_number" }, NOW);
    expect(state.leads[0]).toMatchObject({
      directPhone: "212-555-0100",
      alternatePhones: ["917-555-0102"],
      badNumber: true,
      status: "wrong_number",
      nextAction: null,
    });
    expect(state.callAttempts).toHaveLength(1);
  });

  it("records direct disqualified, won, and lost outcomes as terminal history", () => {
    let state = imported([
      leadInput("Disqualified Clinic"),
      leadInput("Won Clinic", { directPhone: "2125550101" }),
      leadInput("Lost Clinic", { directPhone: "2125550102" }),
    ]);
    state = applyColdOutcome(state, state.leads[0].id, { outcome: "disqualified", lostReason: "Outside target market" }, NOW);
    state = applyColdOutcome(state, state.leads[1].id, { outcome: "won" }, NOW);
    state = applyColdOutcome(state, state.leads[2].id, { outcome: "lost", lostReason: "No budget" }, NOW);

    expect(state.leads.map((lead) => lead.status)).toEqual(["disqualified", "won", "lost"]);
    expect(state.leads.every((lead) => lead.nextAction === null)).toBe(true);
    expect(state.callAttempts).toHaveLength(3);
    expect(() => assertInvariants(state)).not.toThrow();
  });
});

describe("queue engine", () => {
  it("uses the required class order before lead-level scoring", () => {
    const seed = shift(NOW, -10 * DAY);
    let state = importLeads(
      createEmptyState(seed),
      [
        leadInput("Exact Callback", { directPhone: "2125550101" }),
        leadInput("Post Meeting", { directPhone: "2125550102" }),
        leadInput("Interested", { directPhone: "2125550103" }),
        leadInput("Retry", { directPhone: "2125550104" }),
        leadInput("New Lead", { directPhone: "2125550105", priority: "critical" }),
      ],
      {},
      seed,
    );
    const [callback, post, interested, retry] = state.leads;
    state = applyColdOutcome(
      state,
      callback.id,
      { outcome: "callback", callbackAt: shift(NOW, -60_000) },
      shift(seed, DAY),
    );
    state = bookAndCompletePending(state, post.id, shift(seed, 2 * DAY));
    state = applyColdOutcome(
      state,
      interested.id,
      { outcome: "interested", followUpAt: shift(NOW, -60_000) },
      shift(seed, 3 * DAY),
    );
    state = applyColdOutcome(state, retry.id, { outcome: "no_answer" }, shift(seed, 4 * DAY));

    expect(getQueue(state, NOW).map((candidate) => candidate.action.queueClass).slice(0, 5)).toEqual([
      "post_meeting_follow_up",
      "exact_callback",
      "interested_follow_up",
      "cold_retry",
      "new_cold",
    ]);
  });

  it("restores the next queue lead when a session starts", () => {
    const state = startSession(imported(), NOW);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].currentLeadId).toBe(state.leads[0].id);
  });
});

describe("meeting and post-meeting pipeline", () => {
  it("completes a meeting atomically into a scheduled active opportunity", () => {
    let state = imported();
    state = bookAndCompletePending(state, state.leads[0].id);
    const lead = onlyLead(state);
    expect(lead).toMatchObject({
      status: "decision_pending",
      pipelineStage: "post_meeting",
      postMeetingTouchCount: 0,
    });
    expect(lead.nextAction?.type).toBe("post_meeting_follow_up");
    expect(state.meetings[0]).toMatchObject({ status: "completed", outcome: "decision_pending" });
    expect(() => assertInvariants(state)).not.toThrow();
  });

  it("keeps cold attempts and post-meeting touches completely separate", () => {
    let state = imported();
    const leadId = state.leads[0].id;
    state = applyColdOutcome(state, leadId, { outcome: "no_answer" }, shift(NOW, -2 * DAY));
    state = applyColdOutcome(state, leadId, { outcome: "no_answer" }, shift(NOW, -DAY));
    state = bookAndCompletePending(state, leadId);
    const coldAttemptsBefore = state.leads[0].coldAttemptCount;
    state = applyPostMeetingOutcome(
      state,
      leadId,
      { outcome: "no_answer", touchType: "phone" },
      shift(NOW, 3 * 60 * 60_000),
    );
    expect(state.leads[0].coldAttemptCount).toBe(coldAttemptsBefore);
    expect(state.leads[0].coldNoAnswerCount).toBe(2);
    expect(state.leads[0].postMeetingTouchCount).toBe(1);
    expect(state.callAttempts.at(-1)).toMatchObject({
      context: "post_meeting",
      coldAttemptNumber: null,
      postMeetingTouchNumber: 1,
    });
  });

  it("moves a no-response opportunity to dormant after touch five without deleting history", () => {
    let state = imported();
    const leadId = state.leads[0].id;
    state = bookAndCompletePending(state, leadId);
    for (let touch = 1; touch <= 5; touch += 1) {
      state = applyPostMeetingOutcome(
        state,
        leadId,
        { outcome: "no_answer", touchType: touch % 2 ? "phone" : "email" },
        shift(NOW, touch * DAY),
      );
    }
    expect(state.leads[0]).toMatchObject({
      status: "dormant_post_meeting_no_response",
      pipelineStage: "dormant",
      postMeetingTouchCount: 5,
      nextAction: null,
    });
    expect(state.postMeetingTouches).toHaveLength(5);
    expect(state.activities.filter((activity) => activity.type === "post_meeting_touch")).toHaveLength(5);
    expect(() => assertInvariants(state)).not.toThrow();
  });

  it("keeps an exact agreed callback active at touch five", () => {
    let state = imported();
    const leadId = state.leads[0].id;
    state = bookAndCompletePending(state, leadId);
    for (let touch = 1; touch <= 4; touch += 1) {
      state = applyPostMeetingOutcome(
        state,
        leadId,
        { outcome: "no_answer" },
        shift(NOW, touch * DAY),
      );
    }
    state = applyPostMeetingOutcome(
      state,
      leadId,
      { outcome: "requested_callback", callbackAt: shift(NOW, 7 * DAY) },
      shift(NOW, 5 * DAY),
    );
    expect(state.leads[0]).toMatchObject({
      status: "post_meeting_follow_up",
      postMeetingTouchCount: 5,
    });
    expect(state.leads[0].nextAction).toMatchObject({
      queueClass: "exact_callback",
      exact: true,
    });
  });

  it("reopens dormant post-meeting leads into the correct immediate queue", () => {
    let state = imported();
    const leadId = state.leads[0].id;
    state = bookAndCompletePending(state, leadId);
    for (let touch = 1; touch <= 5; touch += 1) {
      state = applyPostMeetingOutcome(state, leadId, { outcome: "no_answer" }, shift(NOW, touch * DAY));
    }
    const historyLength = state.activities.length;
    state = reopenLead(state, leadId, shift(NOW, 8 * DAY));
    expect(state.leads[0]).toMatchObject({
      status: "post_meeting_follow_up",
      postMeetingTouchCount: 5,
    });
    expect(state.leads[0].nextAction?.queueClass).toBe("post_meeting_follow_up");
    expect(state.activities.length).toBe(historyLength + 1);
    expect(state.activities.at(-1)?.type).toBe("lead_reopened");
  });
});

describe("analytics and undo", () => {
  it("derives metrics only from stored non-void records", () => {
    let state = imported();
    const leadId = state.leads[0].id;
    state = applyColdOutcome(
      state,
      leadId,
      { outcome: "meeting_booked", meetingAt: shift(NOW, 60 * 60_000) },
      NOW,
    );
    const meetingId = state.meetings[0].id;
    state = completeMeeting(state, meetingId, { outcome: "won" }, shift(NOW, 2 * 60 * 60_000));
    const beforeUndo = computeAnalytics(state);
    expect(beforeUndo).toMatchObject({
      totalDials: 1,
      answeredCalls: 1,
      realConversations: 1,
      meetingsBooked: 1,
      meetingsHeld: 1,
      clientsWon: 1,
      answerRate: 100,
      meetingToClientRate: 100,
    });
    expect(beforeUndo.byAttempt[0]).toMatchObject({ attempt: 1, dials: 1, answered: 1 });

    state = undoLastAction(state, shift(NOW, 3 * 60 * 60_000));
    const afterUndo = computeAnalytics(state);
    expect(afterUndo.meetingsHeld).toBe(0);
    expect(afterUndo.clientsWon).toBe(0);
    expect(state.meetings[0].status).toBe("booked");
    expect(state.activities.at(-1)?.type).toBe("action_undone");
    expect(() => assertInvariants(state)).not.toThrow();
  });
});

describe("sample state", () => {
  it("is a coherent, populated, refresh-safe aggregate", () => {
    const state = createSampleState(NOW);
    expect(state.leads.length).toBeGreaterThanOrEqual(10);
    expect(state.callAttempts.length).toBeGreaterThan(5);
    expect(state.meetings.length).toBeGreaterThanOrEqual(3);
    expect(state.sessions).toHaveLength(1);
    expect(computeAnalytics(state).totalDials).toBe(state.callAttempts.length);
    expect(() => assertInvariants(state)).not.toThrow();
  });
});

describe("persistence fallback", () => {
  it("round-trips the complete aggregate in non-browser runtimes", async () => {
    await clearState();
    const sample = createSampleState(NOW);
    const saved = await saveState(sample);
    expect(saved.source).toBe("memory");
    const loaded = await loadState();
    expect(loaded.state).toEqual(sample);
    expect(loaded.status.source).toBe("memory");
    expect(await requestPersistentStorage()).toMatchObject({ supported: false, persisted: false });
    await clearState();
    expect((await loadState()).state).toBeNull();
  });
});
