import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Icon } from "../components/Icon";
import { Badge, Button, EmptyState, PageHeader, cx } from "../components/UI";
import { useCRM } from "../data/store";
import { importLeads, updateLead, type LeadPatch } from "../domain/engine";
import {
  LEAD_IMPORT_FIELDS,
  findPossibleDuplicates,
  parseLeadImportFile,
  tableToLeadDrafts,
  type DuplicateCandidateResult,
  type HeaderMapping,
} from "../domain/files";
import type { CRMState, Lead, LeadImportInput } from "../types";

const IMPORT_STEPS = [
  { title: "Upload", hint: "CSV or XLSX" },
  { title: "Preview", hint: "Check the file" },
  { title: "Map Columns", hint: "Match your fields" },
  { title: "Resolve Duplicates", hint: "Never delete silently" },
  { title: "Review", hint: "Confirm the batch" },
  { title: "Results", hint: "Import summary" },
] as const;

type DuplicateDecision = "unresolved" | "merge" | "replace" | "keep" | "skip";

interface ImportResult {
  batchId: string;
  batchName: string;
  source: string;
  imported: number;
  updated: number;
  skipped: number;
  duplicates: number;
  rejected: number;
}

interface ImportPageProps {
  onViewLeads?: () => void;
}

function mergeLeadInputs(base: LeadImportInput, incoming: LeadImportInput, mode: "merge" | "replace"): LeadImportInput {
  const merged = { ...base } as LeadImportInput & Record<string, unknown>;
  for (const [key, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) {
      const prior = Array.isArray(merged[key]) ? merged[key] as string[] : [];
      merged[key] = [...new Set([...prior, ...value].filter(Boolean))];
    } else if (typeof value === "string") {
      if (value.trim() && (mode === "replace" || !String(merged[key] ?? "").trim())) merged[key] = value.trim();
    } else if (key === "customFields" && value && typeof value === "object") {
      merged[key] = mode === "replace"
        ? { ...((merged[key] as Record<string, string>) ?? {}), ...(value as Record<string, string>) }
        : { ...(value as Record<string, string>), ...((merged[key] as Record<string, string>) ?? {}) };
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }
  merged.clinicName = mode === "replace" ? incoming.clinicName.trim() || base.clinicName : base.clinicName;
  merged.researchCompleted = Boolean(base.researchCompleted || incoming.researchCompleted);
  return merged;
}

function mergeImportIntoLead(state: CRMState, leadId: string, input: LeadImportInput, mode: "merge" | "replace"): CRMState {
  const existing = state.leads.find((lead) => lead.id === leadId);
  if (!existing) return state;
  const patch: LeadPatch = {};
  const stringFields: Array<keyof Pick<
    Lead,
    | "clinicName" | "websiteUrl" | "city" | "state" | "timeZone" | "specialty" | "practiceSize"
    | "decisionMakerName" | "decisionMakerRole" | "directPhone" | "mobilePhone" | "extension" | "email"
    | "primaryFinding" | "secondaryFinding" | "findingCategory" | "evidenceNotes" | "pitchNotes"
    | "securityGrade" | "lastConversationNotes" | "assignedCaller"
  >> = [
    "clinicName", "websiteUrl", "city", "state", "timeZone", "specialty", "practiceSize",
    "decisionMakerName", "decisionMakerRole", "directPhone", "mobilePhone", "extension", "email",
    "primaryFinding", "secondaryFinding", "findingCategory", "evidenceNotes", "pitchNotes",
    "securityGrade", "lastConversationNotes", "assignedCaller",
  ];
  for (const field of stringFields) {
    const value = input[field];
    if (typeof value === "string" && value.trim() && (mode === "replace" || !existing[field].trim())) {
      (patch as Record<string, unknown>)[field] = value.trim();
    }
  }
  if (input.alternatePhones?.length) {
    patch.alternatePhones = [...new Set([...existing.alternatePhones, ...input.alternatePhones])];
  }
  if (input.trackingTechnologies?.length) {
    patch.trackingTechnologies = [...new Set([...existing.trackingTechnologies, ...input.trackingTechnologies])];
  }
  if (input.contactType && input.contactType !== "unknown" && (mode === "replace" || existing.contactType === "unknown")) patch.contactType = input.contactType;
  if (input.pixelPresent && input.pixelPresent !== "unknown" && (mode === "replace" || existing.pixelPresent === "unknown")) patch.pixelPresent = input.pixelPresent;
  if (input.findingStrength && input.findingStrength !== "unknown" && (mode === "replace" || existing.findingStrength === "unknown")) patch.findingStrength = input.findingStrength;
  if (input.priority && (mode === "replace" || existing.priority === "normal")) patch.priority = input.priority;
  if (input.researchCompleted) patch.researchCompleted = true;
  if (input.customFields) patch.customFields = mode === "replace" ? { ...existing.customFields, ...input.customFields } : { ...input.customFields, ...existing.customFields };
  return updateLead(state, leadId, patch);
}

interface PlannedImport {
  state: CRMState;
  imported: number;
  updated: number;
  skipped: number;
  batchId: string;
}

function applyImportPlan(
  state: CRMState,
  drafts: LeadImportInput[],
  duplicates: DuplicateCandidateResult[],
  decisions: Record<number, DuplicateDecision>,
  batchName: string,
  source: string,
  fileName: string,
  originalRowCount: number,
  rejectedRows: number,
): PlannedImport {
  const duplicateByIndex = new Map(duplicates.map((duplicate) => [duplicate.index, duplicate]));
  const effectiveDrafts = drafts.map((draft) => ({ ...draft }));
  const shouldImport = drafts.map(() => true);
  const destinations = new Map<number, { kind: "existing"; leadId: string } | { kind: "import"; index: number } | null>();
  const existingMerges: Array<{ leadId: string; input: LeadImportInput; mode: "merge" | "replace" }> = [];
  let updated = 0;
  let skipped = 0;

  drafts.forEach((draft, index) => {
    const duplicate = duplicateByIndex.get(index);
    if (!duplicate) {
      destinations.set(index, { kind: "import", index });
      return;
    }
    const decision = decisions[index] ?? "unresolved";
    if (decision === "skip") {
      shouldImport[index] = false;
      destinations.set(index, null);
      skipped += 1;
      return;
    }
    if (decision !== "merge" && decision !== "replace") {
      destinations.set(index, { kind: "import", index });
      return;
    }

    const preferred = duplicate.matches.find((match) => Boolean(match.lead.id)) ?? duplicate.matches[0];
    if (preferred?.lead.id) {
      shouldImport[index] = false;
      destinations.set(index, { kind: "existing", leadId: preferred.lead.id });
      existingMerges.push({ leadId: preferred.lead.id, input: draft, mode: decision });
      updated += 1;
      return;
    }

    const earlierIndex = drafts.findIndex((candidate) => candidate === preferred?.lead);
    const destination = earlierIndex >= 0 ? destinations.get(earlierIndex) : null;
    if (destination?.kind === "existing") {
      shouldImport[index] = false;
      destinations.set(index, destination);
      existingMerges.push({ leadId: destination.leadId, input: draft, mode: decision });
      updated += 1;
    } else if (destination?.kind === "import") {
      shouldImport[index] = false;
      destinations.set(index, destination);
      effectiveDrafts[destination.index] = mergeLeadInputs(effectiveDrafts[destination.index], draft, decision);
      updated += 1;
    } else {
      // The earlier row was skipped; preserve this row instead of dropping data.
      destinations.set(index, { kind: "import", index });
    }
  });

  let next = state;
  existingMerges.forEach(({ leadId, input, mode }) => {
    next = mergeImportIntoLead(next, leadId, input, mode);
  });
  const inputs = effectiveDrafts.filter((_, index) => shouldImport[index]);
  next = importLeads(next, inputs, {
    batchName: batchName.trim() || undefined,
    source: source.trim() || undefined,
    fileName,
    duplicateStrategy: "keep",
  });

  const batchIndex = next.batches.length - 1;
  const createdBatch = next.batches[batchIndex];
  if (createdBatch) {
    const batches = [...next.batches];
    batches[batchIndex] = {
      ...createdBatch,
      rowCount: originalRowCount,
      importedCount: inputs.length,
      duplicateCount: duplicates.length,
      skippedCount: skipped + rejectedRows,
    };
    next = { ...next, batches };
  }

  return {
    state: next,
    imported: inputs.length,
    updated,
    skipped,
    batchId: createdBatch?.id ?? "",
  };
}

export function ImportPage({ onViewLeads }: ImportPageProps) {
  const { state, commit, notify } = useCRM();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<HeaderMapping>({});
  const [customColumns, setCustomColumns] = useState<Record<number, string>>({});
  const [batchName, setBatchName] = useState("");
  const [source, setSource] = useState("Lead list import");
  const [decisions, setDecisions] = useState<Record<number, DuplicateDecision>>({});
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const parsed = useMemo(
    () => tableToLeadDrafts(table, { mapping, customColumns }),
    [customColumns, mapping, table],
  );
  const duplicates = useMemo(
    () => findPossibleDuplicates(parsed.drafts, state.leads),
    [parsed.drafts, state.leads],
  );
  const duplicateByIndex = useMemo(
    () => new Map(duplicates.map((duplicate) => [duplicate.index, duplicate])),
    [duplicates],
  );
  const unresolvedDuplicates = duplicates.filter((duplicate) => (decisions[duplicate.index] ?? "unresolved") === "unresolved").length;
  const rejectedRows = parsed.errors.filter((item) => item.rowNumber > 1).length;

  const reset = () => {
    setStep(0);
    setFileName("");
    setFileSize(0);
    setTable([]);
    setMapping({});
    setCustomColumns({});
    setBatchName("");
    setSource("Lead list import");
    setDecisions({});
    setError("");
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const imported = await parseLeadImportFile(file);
      setFileName(file.name);
      setFileSize(file.size);
      setTable([imported.headers, ...imported.rows]);
      setMapping(imported.mapping);
      setCustomColumns({});
      setBatchName(file.name.replace(/\.(csv|xlsx)$/i, ""));
      setDecisions({});
      setResult(null);
      setStep(1);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "This file could not be read.";
      setError(message);
      notify(message, "danger");
    } finally {
      setBusy(false);
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void loadFile(event.target.files?.[0]);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void loadFile(event.dataTransfer.files?.[0]);
  };

  const setColumnMapping = (column: number, field: string) => {
    setMapping((current) => {
      const next = { ...current };
      for (const [key, mappedColumn] of Object.entries(next)) {
        if (mappedColumn === column || key === field) delete next[key as keyof HeaderMapping];
      }
      if (field && field !== "__custom__") next[field as keyof HeaderMapping] = column;
      return next;
    });
    setCustomColumns((current) => {
      const next = { ...current };
      delete next[column];
      if (field === "__custom__") next[column] = table[0]?.[column]?.trim() || `Custom field ${column + 1}`;
      return next;
    });
  };

  const goToDuplicates = () => {
    const initial: Record<number, DuplicateDecision> = {};
    duplicates.forEach((duplicate) => { initial[duplicate.index] = "unresolved"; });
    setDecisions(initial);
    setStep(3);
  };

  const runImport = () => {
    if (!batchName.trim()) {
      setError("Give this import batch a name.");
      return;
    }
    let summary: PlannedImport | null = null;
    commit(
      "Import lead batch",
      (current) => {
        summary = applyImportPlan(
          current,
          parsed.drafts,
          duplicates,
          decisions,
          batchName,
          source,
          fileName,
          parsed.rows.length,
          rejectedRows,
        );
        return summary.state;
      },
      `${parsed.drafts.length - decisionsToSkipped(decisions)} import rows processed`,
    );
    const fallback = summary ?? {
      imported: parsed.drafts.length - decisionsToSkipped(decisions),
      updated: decisionsToCount(decisions, "merge") + decisionsToCount(decisions, "replace"),
      skipped: decisionsToSkipped(decisions),
      batchId: "",
    };
    setResult({
      batchId: fallback.batchId,
      batchName,
      source,
      imported: fallback.imported,
      updated: fallback.updated,
      skipped: fallback.skipped,
      duplicates: duplicates.length,
      rejected: rejectedRows,
    });
    setStep(5);
  };

  return (
    <>
      <PageHeader
        eyebrow="Data intake"
        title="Import Leads"
        description="Bring in 500+ leads at once. Columns are mapped safely, duplicates stay under your control, and every batch remains traceable."
        actions={step > 0 && step < 5 ? <Button variant="ghost" onClick={reset} startIcon={<Icon name="close" size={15} />}>Cancel import</Button> : undefined}
      />

      <div className="import-layout">
        <ol className="import-stepper" aria-label="Import progress">
          {IMPORT_STEPS.map((item, index) => (
            <li key={item.title} className={cx("import-step", index === step && "is-active", index < step && "is-complete")} aria-current={index === step ? "step" : undefined}>
              <span className="import-step__number">{index < step ? <Icon name="check" size={14} /> : index + 1}</span>
              <span className="import-step__copy"><span className="import-step__title">{item.title}</span><span className="import-step__hint">{item.hint}</span></span>
            </li>
          ))}
        </ol>

        <div className="settings-content">
          {step === 0 ? (
            <section className="panel">
              <div className="panel__header"><div><h2 className="panel__title">Choose a lead file</h2><p className="panel__subtitle">CSV and XLSX files are supported. Your original file is never modified.</p></div></div>
              <div className="panel__body">
                <div
                  className={cx("dropzone", dragging && "is-dragging")}
                  onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
                  onDrop={handleDrop}
                >
                  <div>
                    <span className="dropzone__icon"><Icon name="upload" size={25} /></span>
                    <h2 className="dropzone__title">Drop your spreadsheet here</h2>
                    <p className="dropzone__copy">Headers do not need to match perfectly. You will review every column before anything is saved.</p>
                    <div className="dropzone__actions">
                      <Button variant="primary" loading={busy} loadingLabel="Reading file" onClick={() => fileInputRef.current?.click()} startIcon={<Icon name="file" size={16} />}>Browse files</Button>
                    </div>
                    <input ref={fileInputRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFileInput} hidden />
                  </div>
                </div>
                {error ? <p className="field__error" style={{ marginTop: 12 }}><Icon name="alert" size={14} />{error}</p> : null}
              </div>
            </section>
          ) : null}

          {step === 1 ? (
            <section className="panel">
              <div className="panel__header"><div><h2 className="panel__title">Preview spreadsheet</h2><p className="panel__subtitle">{fileName} · {formatFileSize(fileSize)} · {parsed.rows.length.toLocaleString()} data rows · {parsed.headers.length} columns</p></div><Badge tone="info">Nothing imported yet</Badge></div>
              <div className="panel__body"><p className="field__hint import-preview-hint">Check the headers and first rows exactly as Relay detected them. Every column will be available on the next screen.</p><div className="table-wrap import-preview-table"><table className="data-table"><thead><tr>{parsed.headers.map((header, index) => <th key={`${header}-${index}`}>{header || `Column ${index + 1}`}</th>)}</tr></thead><tbody>{parsed.rows.slice(0, 8).map((row, rowIndex) => <tr key={rowIndex}>{parsed.headers.map((_, column) => <td key={column}>{row[column] || "—"}</td>)}</tr>)}</tbody></table></div>{parsed.rows.length > 8 ? <p className="field__hint">Showing 8 of {parsed.rows.length.toLocaleString()} rows.</p> : null}</div>
              <div className="panel__footer" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><Button variant="ghost" onClick={() => setStep(0)} startIcon={<Icon name="arrowLeft" size={15} />}>Choose another file</Button><Button variant="primary" onClick={() => setStep(2)} endIcon={<Icon name="arrowRight" size={15} />}>Map all columns</Button></div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="panel">
              <div className="panel__header"><div><h2 className="panel__title">Map spreadsheet columns</h2><p className="panel__subtitle">{fileName} · {formatFileSize(fileSize)} · {parsed.rows.length.toLocaleString()} data rows</p></div><Badge tone={mapping.clinicName === undefined ? "danger" : "success"}>{mapping.clinicName === undefined ? "Clinic Name required" : "Required field mapped"}</Badge></div>
              <div className="panel__body" style={{ padding: 0 }}>
                {parsed.headers.map((header, column) => {
                  const mappedField = customColumns[column] ? "__custom__" : Object.entries(mapping).find(([, value]) => value === column)?.[0] ?? "";
                  const samples = parsed.rows.slice(0, 4).map((row) => row[column]).filter(Boolean).join(" · ");
                  return (
                    <div className="mapping-row" key={`${header}-${column}`}>
                      <span className="mapping-row__source">{header || `Column ${column + 1}`}</span>
                      <Icon name="arrowRight" size={16} />
                      <select aria-label={`Map ${header || `column ${column + 1}`}`} value={mappedField} onChange={(event) => setColumnMapping(column, event.target.value)}>
                        <option value="">Do not import</option>
                        {LEAD_IMPORT_FIELDS.map((field) => <option key={field.key} value={field.key}>{field.label}{field.key === "clinicName" ? " *" : ""}</option>)}
                        <option value="__custom__">Other / custom field</option>
                      </select>
                      {mappedField === "__custom__" ? <input className="mapping-row__custom" value={customColumns[column] ?? ""} onChange={(event) => setCustomColumns((current) => ({ ...current, [column]: event.target.value }))} aria-label={`Custom field name for ${header || `column ${column + 1}`}`} /> : <span className="mapping-row__sample" title={samples}>{samples || "No sample value"}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="panel__footer" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <Button variant="ghost" onClick={() => setStep(1)} startIcon={<Icon name="arrowLeft" size={15} />}>Back</Button>
                <Button variant="primary" disabled={mapping.clinicName === undefined || parsed.drafts.length === 0} onClick={goToDuplicates} endIcon={<Icon name="arrowRight" size={15} />}>Continue with {parsed.drafts.length.toLocaleString()} valid leads</Button>
              </div>
              {parsed.errors.length ? <div style={{ padding: "0 18px 14px" }}><p className="field__error"><Icon name="warning" size={14} />{parsed.errors.length} mapping or row issue{parsed.errors.length === 1 ? "" : "s"}. Invalid rows will not be imported.</p></div> : null}
            </section>
          ) : null}

          {step === 3 ? (
            <section className="panel">
              <div className="panel__header"><div><h2 className="panel__title">Resolve possible duplicates</h2><p className="panel__subtitle">Matches use normalized website domain, phone, or clinic plus location. Nothing is silently deleted.</p></div><Badge tone={duplicates.length ? "warning" : "success"}>{duplicates.length} possible duplicate{duplicates.length === 1 ? "" : "s"}</Badge></div>
              <div className="panel__body">
                {duplicates.length ? (
                  <div className="card-list">
                    {duplicates.map((duplicate) => {
                      const draft = parsed.drafts[duplicate.index];
                      const match = duplicate.matches.find((item) => item.lead.id) ?? duplicate.matches[0];
                      const decision = decisions[duplicate.index] ?? "unresolved";
                      return (
                        <article className="duplicate-card" key={duplicate.index}>
                          <div className="duplicate-card__record"><span className="duplicate-card__label">Incoming row</span><span className="duplicate-card__name">{draft.clinicName}</span><small>{draft.directPhone || draft.websiteUrl || `${draft.city ?? ""}, ${draft.state ?? ""}`}</small></div>
                          <div className="duplicate-card__record"><span className="duplicate-card__label">Possible match · {match?.reasons.map(readableReason).join(", ")}</span><span className="duplicate-card__name">{match?.lead.clinicName ?? "Earlier import row"}</span><small>{match?.lead.directPhone || match?.lead.websiteUrl || `${match?.lead.city ?? ""}, ${match?.lead.state ?? ""}`}</small></div>
                          <div className="duplicate-card__actions" role="group" aria-label={`Resolve ${draft.clinicName}`}>
                            <Button size="sm" variant={decision === "merge" ? "primary" : "secondary"} aria-pressed={decision === "merge"} onClick={() => setDecisions((current) => ({ ...current, [duplicate.index]: "merge" }))}>Merge</Button>
                            <Button size="sm" variant={decision === "replace" ? "primary" : "secondary"} aria-pressed={decision === "replace"} onClick={() => setDecisions((current) => ({ ...current, [duplicate.index]: "replace" }))}>Replace Existing</Button>
                            <Button size="sm" variant={decision === "keep" ? "primary" : "secondary"} aria-pressed={decision === "keep"} onClick={() => setDecisions((current) => ({ ...current, [duplicate.index]: "keep" }))}>Import Anyway</Button>
                            <Button size="sm" variant={decision === "skip" ? "danger" : "secondary"} aria-pressed={decision === "skip"} onClick={() => setDecisions((current) => ({ ...current, [duplicate.index]: "skip" }))}>Skip</Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : <EmptyState compact icon={<Icon name="checkCircle" size={24} />} title="No duplicates found" description="Every valid row can continue to the review step." />}
              </div>
              <div className="panel__footer" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <Button variant="ghost" onClick={() => setStep(2)} startIcon={<Icon name="arrowLeft" size={15} />}>Back</Button>
                <Button variant="primary" disabled={unresolvedDuplicates > 0} onClick={() => setStep(4)} endIcon={<Icon name="arrowRight" size={15} />}>{unresolvedDuplicates ? `Resolve ${unresolvedDuplicates} remaining` : "Review import"}</Button>
              </div>
            </section>
          ) : null}

          {step === 4 ? (
            <section className="panel">
              <div className="panel__header"><div><h2 className="panel__title">Review and import</h2><p className="panel__subtitle">Confirm batch details and spot-check the first records.</p></div><Badge tone="accent">{parsed.drafts.length.toLocaleString()} valid rows</Badge></div>
              <div className="panel__body">
                <div className="form-grid" style={{ marginBottom: 18 }}>
                  <label className="field"><span className="field__label">Batch name *</span><input type="text" value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="August 2026 clinic list" /></label>
                  <label className="field"><span className="field__label">Source</span><input type="text" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Supplier or research source" /></label>
                </div>
                <div className="import-result-grid" style={{ marginBottom: 18 }}>
                  <ImportStat value={parsed.drafts.length - decisionsToSkipped(decisions) - decisionsToCount(decisions, "merge") - decisionsToCount(decisions, "replace")} label="New leads" />
                  <ImportStat value={decisionsToCount(decisions, "merge") + decisionsToCount(decisions, "replace")} label="Updated" />
                  <ImportStat value={decisionsToSkipped(decisions) + rejectedRows} label="Skipped / invalid" />
                </div>
                <div className="table-wrap">
                  <table className="data-table"><thead><tr><th>Clinic</th><th>Contact</th><th>Phone</th><th>Location</th><th>Pixel</th><th>Decision</th></tr></thead>
                    <tbody>{parsed.drafts.slice(0, 8).map((draft, index) => <tr key={`${draft.clinicName}-${index}`}><td><strong>{draft.clinicName}</strong><small>{draft.websiteUrl}</small></td><td>{draft.decisionMakerName || "—"}<small>{draft.decisionMakerRole}</small></td><td>{draft.directPhone || draft.mobilePhone || "—"}</td><td>{[draft.city, draft.state].filter(Boolean).join(", ") || "—"}</td><td>{draft.pixelPresent ?? "unknown"}</td><td>{duplicateByIndex.has(index) ? readableDecision(decisions[index]) : "Import"}</td></tr>)}</tbody>
                  </table>
                </div>
                {parsed.drafts.length > 8 ? <p className="field__hint" style={{ marginTop: 10 }}>Previewing 8 of {parsed.drafts.length.toLocaleString()} valid rows.</p> : null}
                {error ? <p className="field__error" style={{ marginTop: 12 }}><Icon name="alert" size={14} />{error}</p> : null}
              </div>
              <div className="panel__footer" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <Button variant="ghost" onClick={() => setStep(3)} startIcon={<Icon name="arrowLeft" size={15} />}>Back</Button>
                <Button variant="primary" disabled={!batchName.trim()} onClick={runImport} startIcon={<Icon name="import" size={16} />}>Import batch</Button>
              </div>
            </section>
          ) : null}

          {step === 5 && result ? (
            <section className="panel">
              <div className="panel__body">
                <EmptyState
                  icon={<Icon name="checkCircle" size={28} />}
                  title="Import complete"
                  description={`${result.batchName} is stored as a traceable batch. New call-ready leads now have an explicit next action.`}
                />
                <div className="import-result-grid">
                  <ImportStat value={result.imported} label="New leads" />
                  <ImportStat value={result.updated} label="Updated" />
                  <ImportStat value={result.skipped + result.rejected} label="Skipped / invalid" />
                  <ImportStat value={result.duplicates} label="Duplicates reviewed" />
                </div>
                <div className="context-block" style={{ marginTop: 16 }}><span className="context-block__label">Batch record</span><span className="context-block__value">{result.batchName} · {result.source || "Manual import"}{result.batchId ? ` · ${result.batchId}` : ""}</span></div>
              </div>
              <div className="panel__footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button variant="secondary" onClick={reset} startIcon={<Icon name="upload" size={15} />}>Import another file</Button>
                {onViewLeads ? <Button variant="primary" onClick={onViewLeads} endIcon={<Icon name="arrowRight" size={15} />}>View leads</Button> : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function ImportStat({ value, label }: { value: number; label: string }) {
  return <div className="import-result"><span className="import-result__value">{value.toLocaleString()}</span><span className="import-result__label">{label}</span></div>;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function readableReason(value: string): string {
  return value.replace(/_/g, " ");
}

function readableDecision(value: DuplicateDecision | undefined): string {
  if (value === "merge") return "Merge";
  if (value === "replace") return "Replace existing";
  if (value === "keep") return "Import anyway";
  if (value === "skip") return "Skip";
  return "Review";
}

function decisionsToCount(decisions: Record<number, DuplicateDecision>, decision: DuplicateDecision): number {
  return Object.values(decisions).filter((value) => value === decision).length;
}

function decisionsToSkipped(decisions: Record<number, DuplicateDecision>): number {
  return decisionsToCount(decisions, "skip");
}
