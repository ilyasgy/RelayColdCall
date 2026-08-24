import { describe, expect, it } from "vitest";
import { createEmptyState } from "../data/defaults";
import type { AnalyticsSummary, CallAttempt, Lead, Meeting } from "../types";
import {
  CRM_BACKUP_FORMAT,
  CRM_BACKUP_VERSION,
  FileUtilityError,
  autoMapHeaders,
  buildExportTable,
  createXlsxBlob,
  duplicateIdentityKeys,
  findDuplicateMatches,
  findPossibleDuplicates,
  normalizeClinicLocation,
  normalizeDomain,
  normalizePhone,
  parseBackup,
  parseBackupEnvelope,
  parseCsv,
  parseLeadImportCsv,
  parseXlsxTable,
  rowToLeadDraft,
  serializeBackup,
  stringifyCsv,
  tableToLeadDrafts,
  validateBackup,
} from "./files";

const NOW = "2026-08-23T12:00:00.000Z";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    clinicName: "Harbor Skin Clinic",
    websiteUrl: "https://harborskin.example/consult",
    websiteDomain: "harborskin.example",
    city: "Miami",
    state: "FL",
    timeZone: "America/New_York",
    specialty: "Dermatology",
    practiceSize: "12",
    decisionMakerName: "Sarah Cole",
    decisionMakerRole: "Practice Manager",
    contactType: "practice_manager",
    directPhone: "+1 (305) 555-0100",
    mobilePhone: "",
    extension: "",
    email: "sarah@harborskin.example",
    alternatePhones: [],
    pixelPresent: "yes",
    trackingTechnologies: ["Meta Pixel", "Google Tag Manager"],
    primaryFinding: "Meta Pixel on appointment form",
    secondaryFinding: "",
    findingCategory: "Tracking / Privacy",
    findingStrength: "A",
    evidenceNotes: "Pixel request observed.",
    pitchNotes: "Lead with patient-facing tracking.",
    securityGrade: "D",
    researchCompleted: true,
    status: "new",
    pipelineStage: "cold",
    priority: "high",
    coldAttemptCount: 0,
    coldNoAnswerCount: 0,
    recycleCycle: 0,
    postMeetingTouchCount: 0,
    firstCalledAt: null,
    lastCalledAt: null,
    lastOutcome: "",
    lastConversationNotes: "",
    callbackAt: null,
    followUpAt: null,
    nextAction: null,
    lostReason: "",
    doNotCall: false,
    badNumber: false,
    importedAt: NOW,
    batchId: "batch-1",
    assignedCaller: "Caller",
    createdAt: NOW,
    updatedAt: NOW,
    revision: 0,
    ...overrides,
    customFields: overrides.customFields ?? {},
  };
}

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "meeting-1",
    leadId: "lead-1",
    scheduledAt: "2026-08-24T15:00:00.000Z",
    durationMinutes: 30,
    meetingType: "Video",
    contactEmail: "sarah@harborskin.example",
    status: "booked",
    outcome: null,
    notes: "Bring evidence.",
    interestSummary: "Compliance",
    mainObjection: "Budget",
    decisionStatus: "",
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    voidedAt: null,
    ...overrides,
  };
}

function callAttempt(overrides: Partial<CallAttempt> = {}): CallAttempt {
  return {
    id: "call-1",
    leadId: "lead-1",
    sessionId: null,
    occurredAt: NOW,
    context: "cold",
    outcome: "no_answer",
    coldAttemptNumber: 1,
    coldNoAnswerNumber: 1,
    postMeetingTouchNumber: null,
    answered: false,
    meaningfulConversation: false,
    note: "",
    durationSeconds: 12,
    batchIdSnapshot: "batch-1",
    contactTypeSnapshot: "practice_manager",
    pixelPresentSnapshot: "yes",
    findingCategorySnapshot: "Tracking / Privacy",
    findingStrengthSnapshot: "A",
    voidedAt: null,
    ...overrides,
  };
}

const analytics: AnalyticsSummary = {
  totalDials: 10,
  uniqueLeadsCalled: 8,
  answeredCalls: 4,
  realConversations: 3,
  noAnswers: 6,
  badNumbers: 1,
  callbacks: 2,
  meetingsBooked: 2,
  meetingsHeld: 1,
  clientsWon: 1,
  leadsLost: 1,
  answerRate: 0.4,
  conversationRate: 0.3,
  conversationToMeetingRate: 2 / 3,
  dialToMeetingRate: 0.2,
  meetingShowRate: 0.5,
  meetingToClientRate: 1,
  leadToClientRate: 0.125,
  dialToClientRate: 0.1,
  averageAttemptsBeforeConversation: 1.5,
  averageAttemptsBeforeMeeting: 2,
  byFinding: [{ key: "Tracking / Privacy", dials: 6, answered: 3, conversations: 2, meetings: 2, clients: 1, answerRate: 0.5, meetingRate: 1 / 3, clientRate: 1 / 6 }],
  byContactType: [{ key: "owner", dials: 4, answered: 2, conversations: 2, meetings: 1, clients: 1, answerRate: 0.5, meetingRate: 0.25, clientRate: 0.25 }],
  byAttempt: [{ attempt: 1, dials: 8, answered: 3, conversations: 2, connectionRate: 0.375 }],
};

describe("CSV parsing", () => {
  it("parses BOM, CRLF, escaped quotes, commas, and embedded newlines", () => {
    const csv = '\ufeffClinic,Notes,Phone\r\n"Harbor, Skin","Said ""call tomorrow""\r\nafter 3",555-0100\r\n';
    expect(parseCsv(csv)).toEqual([
      ["Clinic", "Notes", "Phone"],
      ["Harbor, Skin", 'Said "call tomorrow"\nafter 3', "555-0100"],
    ]);
  });

  it("retains trailing empty fields without inventing a trailing empty row", () => {
    expect(parseCsv("a,b,\n1,2,\n")).toEqual([["a", "b", ""], ["1", "2", ""]]);
  });

  it("rejects an unclosed quoted field", () => {
    expect(() => parseCsv('Clinic,Note\nExample,"unfinished')).toThrow(FileUtilityError);
  });

  it("quotes safely when serializing and protects spreadsheet formulas on request", () => {
    const csv = stringifyCsv([["Clinic", "Note"], ["Harbor, Skin", '=HYPERLINK("bad")']], { protectFormulas: true });
    expect(csv).toContain('"Harbor, Skin"');
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  });
});

describe("lead import mapping", () => {
  const headers = [
    "Practice", "Web Address", "Contact Full Name", "Job Title", "Main Phone #", "Meta Pixel?",
    "Finding Grade", "Research Complete", "List Name",
  ];

  it("auto-maps forgiving header aliases without reusing columns", () => {
    const mapping = autoMapHeaders(headers);
    expect(mapping).toMatchObject({
      clinicName: 0,
      websiteUrl: 1,
      decisionMakerName: 2,
      decisionMakerRole: 3,
      directPhone: 4,
      pixelPresent: 5,
      findingStrength: 6,
      researchCompleted: 7,
      batchId: 8,
    });
    expect(new Set(Object.values(mapping)).size).toBe(Object.values(mapping).length);
  });

  it("converts a mapped row into a normalized LeadImportInput", () => {
    const mapping = autoMapHeaders(headers);
    const draft = rowToLeadDraft(
      ["Harbor Skin", "www.HarborSkin.example/path", "Sarah Cole", "Practice Manager", "+1 305 555 0100", "Detected", "A — Strong", "Yes", "August List"],
      mapping,
      { defaults: { assignedCaller: "Caller 1" } },
    );
    expect(draft).toMatchObject({
      clinicName: "Harbor Skin",
      websiteUrl: "www.HarborSkin.example/path",
      websiteDomain: "harborskin.example",
      decisionMakerName: "Sarah Cole",
      decisionMakerRole: "Practice Manager",
      directPhone: "+1 305 555 0100",
      pixelPresent: "yes",
      findingStrength: "A",
      researchCompleted: true,
      batchId: "August List",
      assignedCaller: "Caller 1",
    });
  });

  it("reports missing clinic names while retaining valid rows", () => {
    const result = parseLeadImportCsv("Clinic,Phone\nHarbor Skin,555-0100\n,555-0101\n");
    expect(result.drafts).toHaveLength(1);
    expect(result.errors).toEqual([{ rowNumber: 3, message: "Clinic Name is required." }]);
  });

  it("keeps imported custom columns under their chosen field names", () => {
    const result = tableToLeadDrafts(
      [["Clinic", "Legacy Score", "Territory"], ["Harbor Skin", "92", "South East"]],
      { mapping: { clinicName: 0 }, customColumns: { 1: "Legacy Score", 2: "Sales Territory" } },
    );

    expect(result.errors).toEqual([]);
    expect(result.drafts[0].customFields).toEqual({
      "Legacy Score": "92",
      "Sales Territory": "South East",
    });
  });
});

describe("duplicate detection", () => {
  it("normalizes domains, US country codes, extensions, and clinic locations", () => {
    expect(normalizeDomain("https://WWW2.Example.com:443/path?q=1")).toBe("example.com");
    expect(normalizePhone("+1 (305) 555-0100 ext. 24")).toBe("3055550100");
    expect(normalizeClinicLocation("Harbor Skin, LLC", "Miami", "FL")).toBe("harbor skin|miami|fl");
  });

  it("identifies all matching keys and does not use an underspecified clinic name", () => {
    const existing = lead();
    const candidate = {
      clinicName: "Harbor Skin Clinic",
      city: "Miami",
      state: "FL",
      websiteUrl: "http://www.harborskin.example/other",
      directPhone: "1-305-555-0100 x22",
    };
    const matches = findDuplicateMatches(candidate, [existing]);
    expect(matches).toHaveLength(1);
    expect(matches[0].reasons).toEqual(["domain", "phone", "clinic_location"]);
    expect(duplicateIdentityKeys({ clinicName: "Only a Name" }).clinicLocation).toBe("");
  });

  it("detects duplicates against earlier rows in the same import", () => {
    const rows = [
      { clinicName: "One", city: "Austin", state: "TX", directPhone: "512-555-0100" },
      { clinicName: "Different", city: "Dallas", state: "TX", directPhone: "+1 512 555 0100" },
    ];
    const duplicates = findPossibleDuplicates(rows, []);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].index).toBe(1);
    expect(duplicates[0].matches[0].reasons).toContain("phone");
  });
});

describe("exports", () => {
  function populatedState() {
    const state = createEmptyState(NOW);
    state.leads = [lead(), lead({ id: "lead-won", clinicName: "Won Clinic", status: "won", pipelineStage: "client" }), lead({ id: "lead-lost", clinicName: "Lost Clinic", status: "lost", pipelineStage: "closed" })];
    state.meetings = [meeting()];
    state.callAttempts = [callAttempt()];
    return state;
  }

  it("builds All Leads, Meetings, Won, Lost, Call History, and Analytics tables", () => {
    const state = populatedState();
    expect(buildExportTable("all-leads", { state }).rows).toHaveLength(3);
    expect(buildExportTable("meetings", { state }).rows[0]).toContain("Harbor Skin Clinic");
    expect(buildExportTable("won", { state }).rows).toHaveLength(1);
    expect(buildExportTable("lost-leads", { state }).rows).toHaveLength(1);
    expect(buildExportTable("call-history", { state }).rows[0]).toContain("Harbor Skin Clinic");
    expect(buildExportTable("analytics", { state, analytics }).rows.some((row) => row[1] === "Total Dials" && row[2] === 10)).toBe(true);
  });

  it("requires actual calculated analytics", () => {
    expect(() => buildExportTable("analytics", { state: populatedState() })).toThrow(FileUtilityError);
  });

  it("writes a browser-safe XLSX that can be read back", async () => {
    const table = buildExportTable("meetings", { state: populatedState() });
    const blob = await createXlsxBlob(table);
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(blob.size).toBeGreaterThan(1_000);
    const rows = await parseXlsxTable(blob);
    expect(rows[0][0]).toBe("Meeting ID");
    expect(rows[1]).toContain("Harbor Skin Clinic");
  });
});

describe("versioned JSON backup", () => {
  it("round-trips a valid state through a versioned envelope", () => {
    const state = createEmptyState(NOW);
    state.leads = [lead()];
    const json = serializeBackup(state, new Date(NOW));
    const envelope = parseBackupEnvelope(json);
    expect(envelope).toMatchObject({
      format: CRM_BACKUP_FORMAT,
      version: CRM_BACKUP_VERSION,
      exportedAt: NOW,
      appSchemaVersion: 2,
    });
    expect(parseBackup(json)).toEqual(state);
  });

  it("returns useful validation issues for incompatible or corrupt backups", () => {
    const state = createEmptyState(NOW);
    const value = JSON.parse(serializeBackup(state, new Date(NOW))) as Record<string, unknown>;
    value.version = 999;
    const result = validateBackup(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toContain("Unsupported backup version");
  });

  it("rejects invalid JSON and broken lead references", () => {
    expect(() => parseBackup("not-json")).toThrow("Backup is not valid JSON");
    const state = createEmptyState(NOW);
    state.callAttempts = [callAttempt({ leadId: "missing-lead" })];
    expect(() => parseBackup(serializeBackup(state, new Date(NOW)))).toThrow("references missing lead");
  });
});
