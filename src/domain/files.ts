import {
  CRM_SCHEMA_VERSION,
  type AnalyticsSummary,
  type CallAttempt,
  type ContactType,
  type CRMState,
  type FindingStrength,
  type Lead,
  type LeadImportInput,
  type LeadPriority,
  type Meeting,
  type PixelPresence,
} from "../types";

export class FileUtilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileUtilityError";
  }
}

export interface ParseCsvOptions {
  delimiter?: string;
  skipEmptyRows?: boolean;
}

/**
 * RFC-4180-style CSV parser with support for escaped quotes, CRLF, and
 * line-breaks inside quoted cells. It is intentionally independent of the DOM
 * so imports can be tested without a browser.
 */
export function parseCsv(text: string, options: ParseCsvOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ",";
  const skipEmptyRows = options.skipEmptyRows ?? true;
  if (delimiter.length !== 1) {
    throw new FileUtilityError("CSV delimiter must be exactly one character.");
  }

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (source.length === 0) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let rowNumber = 1;

  const finishRow = () => {
    row.push(field);
    if (!skipEmptyRows || row.some((cell) => cell.trim().length > 0)) rows.push(row);
    row = [];
    field = "";
    rowNumber += 1;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else if (character === "\r") {
        field += "\n";
        if (source[index + 1] === "\n") index += 1;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.trim().length === 0) {
      field = "";
      inQuotes = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      finishRow();
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new FileUtilityError(`CSV contains an unclosed quoted field near row ${rowNumber}.`);
  }

  if (row.length > 0 || field.length > 0 || source.endsWith(delimiter)) finishRow();
  return rows;
}

export type LeadImportField =
  | "clinicName"
  | "websiteUrl"
  | "websiteDomain"
  | "city"
  | "state"
  | "timeZone"
  | "specialty"
  | "practiceSize"
  | "decisionMakerName"
  | "decisionMakerRole"
  | "contactType"
  | "directPhone"
  | "mobilePhone"
  | "extension"
  | "email"
  | "alternatePhones"
  | "pixelPresent"
  | "trackingTechnologies"
  | "primaryFinding"
  | "secondaryFinding"
  | "findingCategory"
  | "findingStrength"
  | "evidenceNotes"
  | "pitchNotes"
  | "securityGrade"
  | "researchCompleted"
  | "priority"
  | "lastConversationNotes"
  | "batchId"
  | "assignedCaller";

export interface LeadImportFieldDefinition {
  key: LeadImportField;
  label: string;
  aliases: readonly string[];
}

export const LEAD_IMPORT_FIELDS: readonly LeadImportFieldDefinition[] = [
  { key: "clinicName", label: "Clinic Name", aliases: ["clinic", "clinic name", "business name", "practice name", "company name", "organization"] },
  { key: "websiteUrl", label: "Website URL", aliases: ["website", "website url", "site", "site url", "web address", "clinic website"] },
  { key: "websiteDomain", label: "Website Domain", aliases: ["domain", "website domain", "site domain"] },
  { key: "city", label: "City", aliases: ["city", "town"] },
  { key: "state", label: "State", aliases: ["state", "province", "state code", "region"] },
  { key: "timeZone", label: "Time Zone", aliases: ["time zone", "timezone", "tz", "prospect time zone"] },
  { key: "specialty", label: "Specialty", aliases: ["specialty", "practice specialty", "clinic specialty", "vertical"] },
  { key: "practiceSize", label: "Practice Size", aliases: ["practice size", "clinic size", "business size", "employees", "locations"] },
  { key: "decisionMakerName", label: "Decision-Maker Name", aliases: ["decision maker", "decision maker name", "contact name", "prospect name", "full name", "contact"] },
  { key: "decisionMakerRole", label: "Decision-Maker Role", aliases: ["decision maker role", "contact role", "role", "title", "job title", "position"] },
  { key: "contactType", label: "Owner / Manager", aliases: ["owner manager", "owner or manager", "contact type", "decision maker type", "contact classification", "classification"] },
  { key: "directPhone", label: "Direct Phone", aliases: ["direct phone", "phone", "phone number", "telephone", "work phone", "main phone", "direct number"] },
  { key: "mobilePhone", label: "Mobile Phone", aliases: ["mobile", "mobile phone", "cell", "cell phone", "cellphone"] },
  { key: "extension", label: "Extension", aliases: ["extension", "ext", "phone extension"] },
  { key: "email", label: "Email", aliases: ["email", "email address", "contact email", "e mail"] },
  { key: "alternatePhones", label: "Alternate Phones", aliases: ["alternate phone", "alternate phones", "other phone", "other phones", "secondary phone"] },
  { key: "pixelPresent", label: "Tracking Pixel Present", aliases: ["tracking pixel", "pixel", "pixel present", "meta pixel", "tracking pixel present", "has pixel"] },
  { key: "trackingTechnologies", label: "Tracking Technology", aliases: ["tracking technology", "tracking technologies", "analytics technology", "pixel technology", "tags"] },
  { key: "primaryFinding", label: "Primary Finding", aliases: ["primary finding", "main finding", "finding", "security finding", "primary security finding"] },
  { key: "secondaryFinding", label: "Secondary Finding", aliases: ["secondary finding", "additional finding", "second finding"] },
  { key: "findingCategory", label: "Finding Category", aliases: ["finding category", "security category", "issue category", "category"] },
  { key: "findingStrength", label: "Finding Strength", aliases: ["finding strength", "strength", "finding grade", "lead strength"] },
  { key: "evidenceNotes", label: "Evidence / Notes", aliases: ["evidence", "evidence notes", "research notes", "technical notes", "finding evidence"] },
  { key: "pitchNotes", label: "Pitch Notes", aliases: ["pitch notes", "pitch", "talking point", "talking points", "approach notes"] },
  { key: "securityGrade", label: "Security Grade", aliases: ["security grade", "headers grade", "security headers grade", "grade"] },
  { key: "researchCompleted", label: "Research Completed", aliases: ["research completed", "research complete", "researched", "qualified", "technical research complete"] },
  { key: "priority", label: "Priority", aliases: ["priority", "lead priority", "call priority"] },
  { key: "lastConversationNotes", label: "Notes", aliases: ["notes", "lead notes", "conversation notes", "call notes", "comments"] },
  { key: "batchId", label: "Batch / Source", aliases: ["batch", "batch id", "source", "lead source", "source batch", "list name"] },
  { key: "assignedCaller", label: "Assigned Caller", aliases: ["assigned caller", "caller", "assigned to", "owner rep", "sales rep"] },
] as const;

export type HeaderMapping = Partial<Record<LeadImportField, number>>;

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function headerScore(header: string, alias: string): number {
  const normalizedHeader = normalizeHeader(header);
  const normalizedAlias = normalizeHeader(alias);
  if (!normalizedHeader || !normalizedAlias) return 0;
  if (normalizedHeader === normalizedAlias) return 1_000 + normalizedAlias.length;

  const headerTokens = normalizedHeader.split(" ");
  const aliasTokens = normalizedAlias.split(" ");
  const allAliasTokensPresent = aliasTokens.every((token) => headerTokens.includes(token));
  if (allAliasTokensPresent) return 700 + aliasTokens.length * 20 + normalizedAlias.length;

  if (normalizedAlias.length >= 5 && normalizedHeader.includes(normalizedAlias)) {
    return 600 + normalizedAlias.length;
  }
  if (normalizedHeader.length >= 5 && normalizedAlias.includes(normalizedHeader)) {
    return 450 + normalizedHeader.length;
  }

  const matchingTokens = aliasTokens.filter((token) => headerTokens.includes(token));
  const coverage = matchingTokens.length / Math.max(headerTokens.length, aliasTokens.length);
  return coverage >= 0.67 ? 300 + Math.round(coverage * 100) : 0;
}

/** Maps imperfect spreadsheet headings to CRM fields without reusing a column. */
export function autoMapHeaders(headers: readonly string[]): HeaderMapping {
  const candidates: Array<{ field: LeadImportField; column: number; score: number }> = [];

  for (const definition of LEAD_IMPORT_FIELDS) {
    for (let column = 0; column < headers.length; column += 1) {
      const score = Math.max(
        headerScore(headers[column] ?? "", definition.label),
        ...definition.aliases.map((alias) => headerScore(headers[column] ?? "", alias)),
      );
      if (score > 0) candidates.push({ field: definition.key, column, score });
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.column - right.column);
  const mapping: HeaderMapping = {};
  const claimedColumns = new Set<number>();
  for (const candidate of candidates) {
    if (mapping[candidate.field] !== undefined || claimedColumns.has(candidate.column)) continue;
    mapping[candidate.field] = candidate.column;
    claimedColumns.add(candidate.column);
  }
  return mapping;
}

function mappedValue(row: readonly string[], mapping: HeaderMapping, field: LeadImportField): string {
  const column = mapping[field];
  return column === undefined ? "" : (row[column] ?? "").trim();
}

function splitList(value: string): string[] {
  if (!value.trim()) return [];
  return [...new Set(value.split(/[;,|\n]+/).map((item) => item.trim()).filter(Boolean))];
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = normalizeHeader(value);
  if (["yes", "y", "true", "1", "complete", "completed", "done"].includes(normalized)) return true;
  if (["no", "n", "false", "0", "incomplete", "not completed", "pending"].includes(normalized)) return false;
  return undefined;
}

function parsePixelPresence(value: string): PixelPresence | undefined {
  const normalized = normalizeHeader(value);
  if (!normalized) return undefined;
  if (["yes", "y", "true", "1", "present", "detected", "meta pixel", "pixel detected"].includes(normalized)) return "yes";
  if (["no", "n", "false", "0", "none", "not present", "not detected", "no pixel"].includes(normalized)) return "no";
  return "unknown";
}

function parseFindingStrength(value: string): FindingStrength | undefined {
  const match = value.trim().toUpperCase().match(/^[ABC](?:\b|\s|\W)/);
  if (match) return match[0][0] as FindingStrength;
  if (value.trim().toUpperCase() === "A" || value.trim().toUpperCase() === "B" || value.trim().toUpperCase() === "C") {
    return value.trim().toUpperCase() as FindingStrength;
  }
  return value.trim() ? "unknown" : undefined;
}

function parsePriority(value: string): LeadPriority | undefined {
  const normalized = normalizeHeader(value);
  if (["critical", "urgent", "highest"].includes(normalized)) return "critical";
  if (["high", "important"].includes(normalized)) return "high";
  if (["normal", "medium", "standard"].includes(normalized)) return "normal";
  if (["low", "lowest"].includes(normalized)) return "low";
  return undefined;
}

function parseContactType(value: string): ContactType | undefined {
  const normalized = normalizeHeader(value);
  if (!normalized) return undefined;
  if (normalized.includes("owner")) return "owner";
  if (normalized.includes("practice") && normalized.includes("manager")) return "practice_manager";
  if (normalized.includes("office") && normalized.includes("manager")) return "office_manager";
  if (normalized.includes("clinic") && normalized.includes("director")) return "clinic_director";
  if (normalized.includes("administrator") || normalized === "admin") return "administrator";
  if (normalized === "manager") return "practice_manager";
  if (normalized === "other") return "other";
  return "unknown";
}

export function normalizeDomain(value: string): string {
  let candidate = value.trim().toLowerCase();
  if (!candidate) return "";
  candidate = candidate.replace(/^mailto:/, "").split("@").at(-1) ?? candidate;
  try {
    const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return parsed.hostname.replace(/^www\d*\./, "").replace(/\.$/, "").toLowerCase();
  } catch {
    return candidate
      .replace(/^[a-z]+:\/\//, "")
      .split(/[/?#]/)[0]
      .replace(/^www\d*\./, "")
      .replace(/:\d+$/, "")
      .replace(/\.$/, "");
  }
}

export function normalizePhone(value: string): string {
  const withoutExtension = value.split(/(?:ext\.?|extension|x)\s*\d+/i)[0];
  const digits = withoutExtension.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 7 ? digits : "";
}

function normalizeIdentityText(value: string): string {
  return normalizeHeader(value)
    .replace(/\b(?:llc|inc|incorporated|pllc|pc|ltd)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeClinicLocation(clinicName: string, city = "", state = ""): string {
  const clinic = normalizeIdentityText(clinicName);
  const normalizedCity = normalizeIdentityText(city);
  const normalizedState = normalizeIdentityText(state);
  if (!clinic || (!normalizedCity && !normalizedState)) return "";
  return `${clinic}|${normalizedCity}|${normalizedState}`;
}

export interface RowToLeadDraftOptions {
  defaults?: Partial<LeadImportInput>;
}

/** Converts one mapped spreadsheet row into the store's import-safe lead shape. */
export function rowToLeadDraft(
  row: readonly string[],
  mapping: HeaderMapping,
  options: RowToLeadDraftOptions = {},
): LeadImportInput {
  const defaults = options.defaults ?? {};
  const clinicName = mappedValue(row, mapping, "clinicName") || defaults.clinicName || "";
  const websiteUrl = mappedValue(row, mapping, "websiteUrl") || defaults.websiteUrl || "";
  const mappedDomain = mappedValue(row, mapping, "websiteDomain");
  const draft: LeadImportInput = { ...defaults, clinicName };

  const strings: Array<[LeadImportField, keyof LeadImportInput]> = [
    ["city", "city"], ["state", "state"], ["timeZone", "timeZone"],
    ["specialty", "specialty"], ["practiceSize", "practiceSize"],
    ["decisionMakerName", "decisionMakerName"], ["decisionMakerRole", "decisionMakerRole"],
    ["directPhone", "directPhone"], ["mobilePhone", "mobilePhone"],
    ["extension", "extension"], ["email", "email"],
    ["primaryFinding", "primaryFinding"], ["secondaryFinding", "secondaryFinding"],
    ["findingCategory", "findingCategory"], ["evidenceNotes", "evidenceNotes"],
    ["pitchNotes", "pitchNotes"], ["securityGrade", "securityGrade"],
    ["lastConversationNotes", "lastConversationNotes"], ["batchId", "batchId"],
    ["assignedCaller", "assignedCaller"],
  ];
  for (const [field, key] of strings) {
    const value = mappedValue(row, mapping, field);
    if (value) (draft as unknown as Record<string, unknown>)[key] = value;
  }

  if (websiteUrl) draft.websiteUrl = websiteUrl;
  if (mappedDomain || websiteUrl) draft.websiteDomain = normalizeDomain(mappedDomain || websiteUrl);

  const alternatePhones = splitList(mappedValue(row, mapping, "alternatePhones"));
  if (alternatePhones.length > 0) draft.alternatePhones = alternatePhones;

  const technologies = splitList(mappedValue(row, mapping, "trackingTechnologies"));
  if (technologies.length > 0) draft.trackingTechnologies = technologies;

  const contactType = parseContactType(mappedValue(row, mapping, "contactType"));
  if (contactType) draft.contactType = contactType;
  const pixelPresent = parsePixelPresence(mappedValue(row, mapping, "pixelPresent"));
  if (pixelPresent) draft.pixelPresent = pixelPresent;
  const findingStrength = parseFindingStrength(mappedValue(row, mapping, "findingStrength"));
  if (findingStrength) draft.findingStrength = findingStrength;
  const researchCompleted = parseBoolean(mappedValue(row, mapping, "researchCompleted"));
  if (researchCompleted !== undefined) draft.researchCompleted = researchCompleted;
  const priority = parsePriority(mappedValue(row, mapping, "priority"));
  if (priority) draft.priority = priority;

  return draft;
}

export interface LeadImportRowError {
  rowNumber: number;
  message: string;
}

export interface ParsedLeadImport {
  headers: string[];
  rows: string[][];
  mapping: HeaderMapping;
  drafts: LeadImportInput[];
  errors: LeadImportRowError[];
  unmappedHeaders: string[];
}

export interface ParseLeadImportOptions extends RowToLeadDraftOptions {
  mapping?: HeaderMapping;
  customColumns?: Record<number, string>;
}

export function tableToLeadDrafts(
  table: readonly (readonly string[])[],
  options: ParseLeadImportOptions = {},
): ParsedLeadImport {
  if (table.length === 0) {
    return { headers: [], rows: [], mapping: {}, drafts: [], errors: [], unmappedHeaders: [] };
  }

  const headers = [...table[0]].map((header) => header.trim());
  const inferred = autoMapHeaders(headers);
  const mapping = { ...inferred, ...options.mapping };
  const claimedColumns = new Set([
    ...Object.values(mapping).filter((value): value is number => value !== undefined),
    ...Object.keys(options.customColumns ?? {}).map(Number),
  ]);
  const unmappedHeaders = headers.filter((header, index) => header && !claimedColumns.has(index));
  const rows = table.slice(1).map((row) => [...row]);
  const drafts: LeadImportInput[] = [];
  const errors: LeadImportRowError[] = [];

  if (mapping.clinicName === undefined) {
    errors.push({ rowNumber: 1, message: "Map a Clinic Name column before importing." });
    return { headers, rows, mapping, drafts, errors, unmappedHeaders };
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.every((value) => value.trim().length === 0)) return;
    const draft = rowToLeadDraft(row, mapping, { defaults: options.defaults });
    if (!draft.clinicName.trim()) {
      errors.push({ rowNumber, message: "Clinic Name is required." });
      return;
    }
    const customFields = Object.entries(options.customColumns ?? {}).reduce<Record<string, string>>((fields, [column, name]) => {
      const value = row[Number(column)]?.trim();
      const key = name.trim();
      if (key && value) fields[key] = value;
      return fields;
    }, {});
    drafts.push(Object.keys(customFields).length ? { ...draft, customFields } : draft);
  });

  return { headers, rows, mapping, drafts, errors, unmappedHeaders };
}

export function parseLeadImportCsv(csv: string, options: ParseLeadImportOptions = {}): ParsedLeadImport {
  return tableToLeadDrafts(parseCsv(csv), options);
}

function excelCellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  if (record.result !== undefined) return excelCellToString(record.result);
  if (typeof record.text === "string") return record.text;
  if (Array.isArray(record.richText)) {
    return record.richText
      .map((part) => (typeof part === "object" && part !== null && "text" in part ? String((part as { text: unknown }).text) : ""))
      .join("");
  }
  return String(value);
}

export async function parseXlsxTable(input: ArrayBuffer | Blob): Promise<string[][]> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  const buffer = input instanceof Blob ? await input.arrayBuffer() : input;
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows: string[][] = [];
  const columnCount = Math.max(worksheet.actualColumnCount, worksheet.columnCount);
  for (let rowNumber = 1; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values = Array.from({ length: columnCount }, (_, index) => excelCellToString(row.getCell(index + 1).value));
    if (values.some((value) => value.trim().length > 0)) rows.push(values);
  }
  return rows;
}

export async function parseLeadImportXlsx(
  input: ArrayBuffer | Blob,
  options: ParseLeadImportOptions = {},
): Promise<ParsedLeadImport> {
  return tableToLeadDrafts(await parseXlsxTable(input), options);
}

export async function parseLeadImportFile(file: File, options: ParseLeadImportOptions = {}): Promise<ParsedLeadImport> {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension === "csv") return parseLeadImportCsv(await file.text(), options);
  if (extension === "xlsx") return parseLeadImportXlsx(await file.arrayBuffer(), options);
  throw new FileUtilityError("Unsupported import file. Choose a CSV or XLSX file.");
}

export interface DuplicateIdentity {
  id?: string;
  clinicName: string;
  websiteUrl?: string;
  websiteDomain?: string;
  city?: string;
  state?: string;
  directPhone?: string;
  mobilePhone?: string;
  alternatePhones?: readonly string[];
}

export type DuplicateReason = "domain" | "phone" | "clinic_location";

export interface DuplicateMatch {
  lead: DuplicateIdentity;
  reasons: DuplicateReason[];
  matchingValues: string[];
}

export function duplicateIdentityKeys(lead: DuplicateIdentity): {
  domain: string;
  phones: string[];
  clinicLocation: string;
} {
  const phones = [lead.directPhone, lead.mobilePhone, ...(lead.alternatePhones ?? [])]
    .map((phone) => normalizePhone(phone ?? ""))
    .filter(Boolean);
  return {
    domain: normalizeDomain(lead.websiteDomain || lead.websiteUrl || ""),
    phones: [...new Set(phones)],
    clinicLocation: normalizeClinicLocation(lead.clinicName, lead.city, lead.state),
  };
}

export function findDuplicateMatches(
  candidate: DuplicateIdentity,
  existingLeads: readonly DuplicateIdentity[],
): DuplicateMatch[] {
  const candidateKeys = duplicateIdentityKeys(candidate);
  return existingLeads.flatMap((lead) => {
    const existingKeys = duplicateIdentityKeys(lead);
    const reasons: DuplicateReason[] = [];
    const matchingValues: string[] = [];

    if (candidateKeys.domain && candidateKeys.domain === existingKeys.domain) {
      reasons.push("domain");
      matchingValues.push(candidateKeys.domain);
    }
    const matchingPhones = candidateKeys.phones.filter((phone) => existingKeys.phones.includes(phone));
    if (matchingPhones.length > 0) {
      reasons.push("phone");
      matchingValues.push(...matchingPhones);
    }
    if (candidateKeys.clinicLocation && candidateKeys.clinicLocation === existingKeys.clinicLocation) {
      reasons.push("clinic_location");
      matchingValues.push(candidateKeys.clinicLocation);
    }

    return reasons.length > 0 ? [{ lead, reasons, matchingValues: [...new Set(matchingValues)] }] : [];
  });
}

export interface DuplicateCandidateResult {
  index: number;
  candidate: DuplicateIdentity;
  matches: DuplicateMatch[];
}

/** Detects matches against saved leads and earlier rows in the same import. */
export function findPossibleDuplicates(
  candidates: readonly DuplicateIdentity[],
  existingLeads: readonly DuplicateIdentity[],
): DuplicateCandidateResult[] {
  const prior: DuplicateIdentity[] = [...existingLeads];
  return candidates.map((candidate, index) => {
    const matches = findDuplicateMatches(candidate, prior);
    prior.push(candidate);
    return { index, candidate, matches };
  }).filter((result) => result.matches.length > 0);
}

export type ExportCell = string | number | boolean | Date | null;

export interface ExportTable {
  sheetName: string;
  headers: string[];
  rows: ExportCell[][];
}

export type CRMExportKind =
  | "all-leads"
  | "meetings"
  | "won"
  | "won-clients"
  | "lost"
  | "lost-leads"
  | "call-history"
  | "analytics";

export type CRMExportFormat = "csv" | "xlsx";

export interface CRMExportSource {
  state: CRMState;
  analytics?: AnalyticsSummary;
}

export const EXPORT_CHOICES: readonly { kind: CRMExportKind; label: string }[] = [
  { kind: "all-leads", label: "All Leads" },
  { kind: "meetings", label: "Meetings" },
  { kind: "won", label: "Won Clients" },
  { kind: "lost", label: "Lost Leads" },
  { kind: "call-history", label: "Call History" },
  { kind: "analytics", label: "Analytics" },
] as const;

function readableEnum(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateCell(value: string | null): ExportCell {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date;
}

const LEAD_EXPORT_HEADERS = [
  "Lead ID", "Clinic Name", "Website URL", "Website Domain", "City", "State", "Time Zone",
  "Specialty", "Practice Size", "Decision Maker", "Decision Maker Role", "Contact Type", "Direct Phone",
  "Mobile Phone", "Extension", "Email", "Alternate Phones", "Pixel Present", "Tracking Technologies",
  "Primary Finding", "Secondary Finding", "Finding Category", "Finding Strength", "Evidence Notes", "Pitch Notes",
  "Security Grade", "Research Completed", "Status", "Pipeline Stage", "Priority", "Cold Attempts",
  "Cold No Answers", "Recycle Cycle", "Post-Meeting Touches", "First Called At", "Last Called At", "Last Outcome",
  "Last Conversation Notes", "Callback At", "Follow-Up At", "Next Action", "Next Action Due", "Lost Reason",
  "Do Not Call", "Bad Number", "Imported At", "Batch ID", "Assigned Caller", "Custom Fields", "Updated At",
];

function leadExportRow(lead: Lead): ExportCell[] {
  return [
    lead.id, lead.clinicName, lead.websiteUrl, lead.websiteDomain, lead.city, lead.state, lead.timeZone,
    lead.specialty, lead.practiceSize, lead.decisionMakerName, lead.decisionMakerRole, readableEnum(lead.contactType),
    lead.directPhone, lead.mobilePhone, lead.extension, lead.email, lead.alternatePhones.join("; "),
    readableEnum(lead.pixelPresent), lead.trackingTechnologies.join("; "), lead.primaryFinding, lead.secondaryFinding,
    readableEnum(lead.findingCategory), lead.findingStrength, lead.evidenceNotes, lead.pitchNotes, lead.securityGrade,
    lead.researchCompleted, readableEnum(lead.status), readableEnum(lead.pipelineStage), readableEnum(lead.priority),
    lead.coldAttemptCount, lead.coldNoAnswerCount, lead.recycleCycle, lead.postMeetingTouchCount,
    dateCell(lead.firstCalledAt), dateCell(lead.lastCalledAt), readableEnum(lead.lastOutcome), lead.lastConversationNotes,
    dateCell(lead.callbackAt), dateCell(lead.followUpAt), readableEnum(lead.nextAction?.type), dateCell(lead.nextAction?.dueAt ?? null),
    lead.lostReason, lead.doNotCall, lead.badNumber, dateCell(lead.importedAt), lead.batchId, lead.assignedCaller,
    Object.entries(lead.customFields ?? {}).map(([key, value]) => `${key}: ${value}`).join("; "), dateCell(lead.updatedAt),
  ];
}

function buildLeadExportTable(leads: readonly Lead[], sheetName: string): ExportTable {
  return { sheetName, headers: [...LEAD_EXPORT_HEADERS], rows: leads.map(leadExportRow) };
}

function buildMeetingExportTable(meetings: readonly Meeting[], leads: readonly Lead[]): ExportTable {
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  return {
    sheetName: "Meetings",
    headers: [
      "Meeting ID", "Lead ID", "Clinic Name", "Decision Maker", "Role", "Phone", "Email", "Website",
      "Primary Finding", "Scheduled At", "Duration Minutes", "Meeting Type", "Status", "Outcome", "Meeting Notes",
      "Interest Summary", "Main Objection", "Decision Status", "Completed At", "Created At", "Updated At", "Voided At",
    ],
    rows: meetings.map((meeting) => {
      const lead = leadById.get(meeting.leadId);
      return [
        meeting.id, meeting.leadId, lead?.clinicName ?? "", lead?.decisionMakerName ?? "",
        lead?.decisionMakerRole ?? "", lead?.directPhone || lead?.mobilePhone || "",
        meeting.contactEmail || lead?.email || "", lead?.websiteUrl ?? "", lead?.primaryFinding ?? "",
        dateCell(meeting.scheduledAt), meeting.durationMinutes, meeting.meetingType, readableEnum(meeting.status),
        readableEnum(meeting.outcome), meeting.notes, meeting.interestSummary, meeting.mainObjection,
        meeting.decisionStatus, dateCell(meeting.completedAt), dateCell(meeting.createdAt), dateCell(meeting.updatedAt), dateCell(meeting.voidedAt),
      ];
    }),
  };
}

function buildCallHistoryExportTable(attempts: readonly CallAttempt[], leads: readonly Lead[]): ExportTable {
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  return {
    sheetName: "Call History",
    headers: [
      "Call ID", "Lead ID", "Clinic Name", "Decision Maker", "Occurred At", "Session ID", "Context", "Outcome",
      "Cold Attempt Number", "Cold No-Answer Number", "Post-Meeting Touch Number", "Answered", "Meaningful Conversation",
      "Notes", "Duration Seconds", "Batch", "Contact Type", "Pixel Present", "Finding Category", "Finding Strength", "Voided At",
    ],
    rows: attempts.map((attempt) => {
      const lead = leadById.get(attempt.leadId);
      return [
        attempt.id, attempt.leadId, lead?.clinicName ?? "", lead?.decisionMakerName ?? "", dateCell(attempt.occurredAt),
        attempt.sessionId ?? "", readableEnum(attempt.context), readableEnum(attempt.outcome),
        attempt.coldAttemptNumber, attempt.coldNoAnswerNumber, attempt.postMeetingTouchNumber,
        attempt.answered, attempt.meaningfulConversation, attempt.note, attempt.durationSeconds,
        attempt.batchIdSnapshot, readableEnum(attempt.contactTypeSnapshot), readableEnum(attempt.pixelPresentSnapshot),
        readableEnum(attempt.findingCategorySnapshot), attempt.findingStrengthSnapshot, dateCell(attempt.voidedAt),
      ];
    }),
  };
}

function buildAnalyticsExportTable(analytics: AnalyticsSummary): ExportTable {
  const headers = [
    "Section", "Metric / Dimension", "Value", "Dials", "Answered", "Conversations", "Meetings", "Clients",
    "Answer Rate", "Meeting Rate", "Client Rate",
  ];
  const rows: ExportCell[][] = [];
  const summary: Array<[string, number]> = [
    ["Total Dials", analytics.totalDials], ["Unique Leads Called", analytics.uniqueLeadsCalled],
    ["Answered Calls", analytics.answeredCalls], ["Real Conversations", analytics.realConversations],
    ["No Answers", analytics.noAnswers], ["Bad Numbers", analytics.badNumbers], ["Callbacks", analytics.callbacks],
    ["Meetings Booked", analytics.meetingsBooked], ["Meetings Held", analytics.meetingsHeld],
    ["Clients Won", analytics.clientsWon], ["Leads Lost", analytics.leadsLost], ["Answer Rate", analytics.answerRate],
    ["Conversation Rate", analytics.conversationRate], ["Conversation to Meeting Rate", analytics.conversationToMeetingRate],
    ["Dial to Meeting Rate", analytics.dialToMeetingRate], ["Meeting Show Rate", analytics.meetingShowRate],
    ["Meeting to Client Rate", analytics.meetingToClientRate], ["Lead to Client Rate", analytics.leadToClientRate],
    ["Dial to Client Rate", analytics.dialToClientRate],
    ["Average Attempts Before Conversation", analytics.averageAttemptsBeforeConversation],
    ["Average Attempts Before Meeting", analytics.averageAttemptsBeforeMeeting],
  ];
  summary.forEach(([metric, value]) => rows.push(["Summary", metric, value, null, null, null, null, null, null, null, null]));
  analytics.byFinding.forEach((item) => rows.push([
    "Finding", item.key, null, item.dials, item.answered, item.conversations, item.meetings, item.clients,
    item.answerRate, item.meetingRate, item.clientRate,
  ]));
  analytics.byContactType.forEach((item) => rows.push([
    "Contact Type", readableEnum(item.key), null, item.dials, item.answered, item.conversations, item.meetings, item.clients,
    item.answerRate, item.meetingRate, item.clientRate,
  ]));
  analytics.byAttempt.forEach((item) => rows.push([
    "Cold Attempt", `Attempt ${item.attempt}`, item.connectionRate, item.dials, item.answered, item.conversations,
    null, null, item.connectionRate, null, null,
  ]));
  return { sheetName: "Analytics", headers, rows };
}

export function buildExportTable(kind: CRMExportKind, source: CRMExportSource): ExportTable {
  switch (kind) {
    case "all-leads":
      return buildLeadExportTable(source.state.leads, "All Leads");
    case "meetings":
      return buildMeetingExportTable(source.state.meetings, source.state.leads);
    case "won":
    case "won-clients":
      return buildLeadExportTable(source.state.leads.filter((lead) => lead.status === "won"), "Won Clients");
    case "lost":
    case "lost-leads":
      return buildLeadExportTable(source.state.leads.filter((lead) => ["lost", "not_interested", "disqualified"].includes(lead.status)), "Lost Leads");
    case "call-history":
      return buildCallHistoryExportTable(source.state.callAttempts, source.state.leads);
    case "analytics":
      if (!source.analytics) throw new FileUtilityError("Analytics must be calculated before it can be exported.");
      return buildAnalyticsExportTable(source.analytics);
    default: {
      const neverKind: never = kind;
      throw new FileUtilityError(`Unsupported export type: ${String(neverKind)}`);
    }
  }
}

function exportCellText(cell: ExportCell): string {
  if (cell === null) return "";
  if (cell instanceof Date) return cell.toISOString();
  return String(cell);
}

function protectCsvFormula(value: string): string {
  return /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export interface StringifyCsvOptions {
  delimiter?: string;
  protectFormulas?: boolean;
}

export function stringifyCsv(
  rows: readonly (readonly ExportCell[])[],
  options: StringifyCsvOptions = {},
): string {
  const delimiter = options.delimiter ?? ",";
  const protectFormulas = options.protectFormulas ?? false;
  if (delimiter.length !== 1) throw new FileUtilityError("CSV delimiter must be exactly one character.");

  return rows.map((row) => row.map((cell) => {
    let value = exportCellText(cell);
    if (protectFormulas && typeof cell === "string") value = protectCsvFormula(value);
    if (value.includes(delimiter) || /["\r\n]/.test(value) || /^\s|\s$/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }).join(delimiter)).join("\r\n");
}

export function exportTableToCsv(table: ExportTable): string {
  return stringifyCsv([table.headers, ...table.rows], { protectFormulas: true });
}

export function createCsvBlob(table: ExportTable): Blob {
  return new Blob(["\ufeff", exportTableToCsv(table)], { type: "text/csv;charset=utf-8" });
}

function excelColumnName(columnNumber: number): string {
  let value = columnNumber;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function arrayBufferFromUnknown(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.byteLength);
    bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return bytes.buffer as ArrayBuffer;
  }
  throw new FileUtilityError("The spreadsheet writer returned an unsupported binary value.");
}

export async function createXlsxBlob(table: ExportTable): Promise<Blob> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "Relay Cold Call CRM";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(table.sheetName.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });

  worksheet.addRow(table.headers);
  table.rows.forEach((row) => worksheet.addRow(row));
  const header = worksheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF172033" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });

  table.headers.forEach((heading, index) => {
    const column = worksheet.getColumn(index + 1);
    const longest = Math.max(
      heading.length,
      ...table.rows.slice(0, 250).map((row) => exportCellText(row[index] ?? null).length),
    );
    column.width = Math.min(48, Math.max(11, longest + 2));
    if (/rate$/i.test(heading)) column.numFmt = "0.0%";
    if (/ at$|date$/i.test(heading)) {
      column.width = Math.max(column.width ?? 11, 22);
      column.numFmt = "yyyy-mm-dd hh:mm";
    }
  });
  worksheet.autoFilter = `A1:${excelColumnName(table.headers.length)}1`;

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = arrayBufferFromUnknown(buffer);
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function safeFileSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function exportFileName(kind: CRMExportKind, format: CRMExportFormat, now = new Date()): string {
  const canonical = kind === "won-clients" ? "won" : kind === "lost-leads" ? "lost" : kind;
  return `relay-${safeFileSegment(canonical)}-${timestampForFile(now)}.${format}`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new FileUtilityError("Downloads are only available in a browser window.");
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface DownloadExportOptions extends CRMExportSource {
  kind: CRMExportKind;
  format: CRMExportFormat;
  fileName?: string;
  now?: Date;
}

export async function downloadExport(options: DownloadExportOptions): Promise<string> {
  const table = buildExportTable(options.kind, options);
  const blob = options.format === "csv" ? createCsvBlob(table) : await createXlsxBlob(table);
  const fileName = options.fileName ?? exportFileName(options.kind, options.format, options.now);
  downloadBlob(blob, fileName);
  return fileName;
}

export const CRM_BACKUP_FORMAT = "relay-cold-call-crm-backup" as const;
export const CRM_BACKUP_VERSION = 1 as const;

export interface CRMBackupEnvelope {
  format: typeof CRM_BACKUP_FORMAT;
  version: typeof CRM_BACKUP_VERSION;
  exportedAt: string;
  appSchemaVersion: number;
  state: CRMState;
}

export interface BackupValidationSuccess {
  ok: true;
  backup: CRMBackupEnvelope;
}

export interface BackupValidationFailure {
  ok: false;
  issues: string[];
}

export type BackupValidationResult = BackupValidationSuccess | BackupValidationFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string";
}

function hasUniqueStringIds(items: unknown[], label: string, issues: string[]): void {
  const ids = new Set<string>();
  items.forEach((item, index) => {
    if (!isRecord(item) || !hasString(item, "id") || !String(item.id).trim()) {
      issues.push(`${label}[${index}] must have a non-empty string id.`);
      return;
    }
    const id = String(item.id);
    if (ids.has(id)) issues.push(`${label} contains duplicate id ${id}.`);
    ids.add(id);
  });
}

/** Validates backup format, schema compatibility, core shape, and references. */
export function validateBackup(value: unknown): BackupValidationResult {
  const issues: string[] = [];
  if (!isRecord(value)) return { ok: false, issues: ["Backup must be a JSON object."] };
  if (value.format !== CRM_BACKUP_FORMAT) issues.push("This is not a Relay CRM backup file.");
  if (value.version !== CRM_BACKUP_VERSION) issues.push(`Unsupported backup version: ${String(value.version)}.`);
  if (!hasString(value, "exportedAt")) issues.push("Backup exportedAt must be an ISO date string.");
  if (value.appSchemaVersion !== CRM_SCHEMA_VERSION) {
    issues.push(`Backup schema ${String(value.appSchemaVersion)} is incompatible with schema ${CRM_SCHEMA_VERSION}.`);
  }
  if (!isRecord(value.state)) {
    issues.push("Backup state is missing or invalid.");
    return { ok: false, issues };
  }

  const state = value.state;
  if (state.schemaVersion !== CRM_SCHEMA_VERSION) issues.push("State schema version is incompatible.");
  if (typeof state.revision !== "number" || !Number.isFinite(state.revision)) issues.push("State revision must be a number.");
  if (typeof state.nextSequence !== "number" || !Number.isFinite(state.nextSequence)) issues.push("State nextSequence must be a number.");
  if (!hasString(state, "createdAt") || !hasString(state, "updatedAt")) issues.push("State timestamps are invalid.");

  const arrayFields = [
    "leads", "activities", "callAttempts", "meetings", "postMeetingTouches", "sessions", "batches", "undoStack",
  ] as const;
  arrayFields.forEach((field) => {
    if (!Array.isArray(state[field])) issues.push(`State ${field} must be an array.`);
  });
  if (!isRecord(state.settings)) issues.push("State settings are missing or invalid.");
  else {
    ["calling", "queue", "meetings", "followUp", "interface", "data"].forEach((key) => {
      if (!isRecord(state.settings) || !isRecord(state.settings[key])) issues.push(`State settings.${key} is missing or invalid.`);
    });
  }

  if (Array.isArray(state.leads)) {
    hasUniqueStringIds(state.leads, "leads", issues);
    state.leads.forEach((item, index) => {
      if (!isRecord(item)) return;
      if (!hasString(item, "clinicName") || !String(item.clinicName).trim()) issues.push(`leads[${index}] has no clinicName.`);
      if (!hasString(item, "status")) issues.push(`leads[${index}] has no status.`);
    });
  }
  if (Array.isArray(state.activities)) hasUniqueStringIds(state.activities, "activities", issues);
  if (Array.isArray(state.callAttempts)) hasUniqueStringIds(state.callAttempts, "callAttempts", issues);
  if (Array.isArray(state.meetings)) hasUniqueStringIds(state.meetings, "meetings", issues);
  if (Array.isArray(state.postMeetingTouches)) hasUniqueStringIds(state.postMeetingTouches, "postMeetingTouches", issues);
  if (Array.isArray(state.sessions)) hasUniqueStringIds(state.sessions, "sessions", issues);
  if (Array.isArray(state.batches)) hasUniqueStringIds(state.batches, "batches", issues);

  if (Array.isArray(state.leads)) {
    const leadIds = new Set(state.leads.filter(isRecord).map((lead) => lead.id).filter((id): id is string => typeof id === "string"));
    const references: Array<[string, unknown]> = [
      ["callAttempts", state.callAttempts], ["meetings", state.meetings], ["postMeetingTouches", state.postMeetingTouches],
    ];
    references.forEach(([label, items]) => {
      if (!Array.isArray(items)) return;
      items.forEach((item, index) => {
        if (isRecord(item) && typeof item.leadId === "string" && !leadIds.has(item.leadId)) {
          issues.push(`${label}[${index}] references missing lead ${item.leadId}.`);
        }
      });
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, backup: value as unknown as CRMBackupEnvelope };
}

export function createBackupEnvelope(state: CRMState, now = new Date()): CRMBackupEnvelope {
  return {
    format: CRM_BACKUP_FORMAT,
    version: CRM_BACKUP_VERSION,
    exportedAt: now.toISOString(),
    appSchemaVersion: CRM_SCHEMA_VERSION,
    state,
  };
}

export function serializeBackup(state: CRMState, now = new Date()): string {
  return JSON.stringify(createBackupEnvelope(state, now), null, 2);
}

export function parseBackupEnvelope(text: string): CRMBackupEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new FileUtilityError("Backup is not valid JSON.");
  }
  const validation = validateBackup(value);
  if (!validation.ok) throw new FileUtilityError(`Backup validation failed: ${validation.issues.join(" ")}`);
  return validation.backup;
}

export function parseBackup(text: string): CRMState {
  return parseBackupEnvelope(text).state;
}

export function createBackupBlob(state: CRMState, now = new Date()): Blob {
  return new Blob([serializeBackup(state, now)], { type: "application/json;charset=utf-8" });
}

export function backupFileName(now = new Date()): string {
  return `relay-backup-v${CRM_BACKUP_VERSION}-${timestampForFile(now)}.json`;
}

export function downloadBackup(state: CRMState, now = new Date(), fileName = backupFileName(now)): string {
  downloadBlob(createBackupBlob(state, now), fileName);
  return fileName;
}
