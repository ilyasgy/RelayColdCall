import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { Badge, Button, Modal, PageHeader, cx } from "../components/UI";
import { createEmptyState } from "../data/defaults";
import { useCRM } from "../data/store";
import { useAppUpdates } from "../desktop/updates";
import { computeAnalytics } from "../domain/engine";
import {
  EXPORT_CHOICES,
  downloadBackup,
  downloadExport,
  parseBackup,
  type CRMExportFormat,
  type CRMExportKind,
} from "../domain/files";
import type { CRMSettings, QueueClass } from "../types";

const SETTINGS_TABS = [
  { id: "calling", label: "Calling", icon: "phone" },
  { id: "queue", label: "Queue", icon: "list" },
  { id: "meetings", label: "Meetings & five-touch", icon: "calendarClock" },
  { id: "interface", label: "Interface", icon: "moon" },
  { id: "keyboard", label: "Keyboard", icon: "keyboard" },
  { id: "data", label: "Data", icon: "database" },
  { id: "about", label: "About & updates", icon: "info" },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];
type ResetTarget = "empty";

const QUEUE_LABELS: Record<QueueClass, string> = {
  exact_callback: "Exact scheduled callback",
  post_meeting_follow_up: "Post-meeting follow-up due",
  interested_follow_up: "Interested prospect follow-up",
  cold_retry: "Cold-call retry",
  new_cold: "New cold lead",
  recycled: "Recycled lead",
};

const SHORTCUT_LABELS: Record<string, string> = {
  noAnswer: "No Answer",
  callback: "Callback",
  meeting: "Meeting Booked",
  interested: "Interested",
  followUp: "Follow-Up",
  lost: "Lost",
  badNumber: "Bad Number",
  wrongPerson: "Wrong Person",
  doNotCall: "Do Not Call",
  notes: "Focus Notes",
  confirm: "Confirm",
  undo: "Undo Last Action",
};

const WEEKDAYS = [
  [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"],
] as const;

function cloneSettings(settings: CRMSettings): CRMSettings {
  return structuredClone(settings);
}

function parseNumberList(value: string, minimum = 0): number[] {
  return value
    .split(/[;,\s]+/)
    .map(Number)
    .filter((item) => Number.isFinite(item) && item >= minimum)
    .map((item) => Math.round(item));
}

function parseTextList(value: string): string[] {
  return [...new Set(value.split(/[;,\n]+/).map((item) => item.trim()).filter(Boolean))];
}

function settingsValidation(settings: CRMSettings): string[] {
  const issues: string[] = [];
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!clock.test(settings.calling.callingHoursStart) || !clock.test(settings.calling.callingHoursEnd)) {
    issues.push("Calling hours must use 24-hour HH:MM format.");
  } else if (settings.calling.callingHoursStart >= settings.calling.callingHoursEnd) {
    issues.push("Calling hours must end after they start.");
  }
  if (settings.calling.dailyCallGoal < 1) issues.push("Daily call goal must be at least 1.");
  if (settings.calling.callingWeekdays.length === 0) issues.push("Select at least one calling weekday.");
  if (new Set(settings.queue.classOrder).size !== 6 || settings.queue.classOrder.length !== 6) {
    issues.push("Every queue priority class must appear exactly once.");
  }
  if (settings.followUp.maximumPostMeetingTouches !== 5 || settings.followUp.cadenceBusinessDays.length !== 5) {
    issues.push("The post-meeting sequence must contain exactly five touches.");
  }
  if (settings.interface.keyboardShortcutsEnabled) {
    const shortcuts = Object.values(settings.interface.shortcuts).map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (shortcuts.length !== Object.keys(settings.interface.shortcuts).length) issues.push("Every enabled keyboard action needs a shortcut.");
    if (new Set(shortcuts).size !== shortcuts.length) issues.push("Keyboard shortcuts must be unique.");
  }
  return issues;
}

export function SettingsPage() {
  const {
    state,
    persistence,
    commit,
    replaceState,
    notify,
    refreshPersistence,
  } = useCRM();
  const updates = useAppUpdates();
  const [tab, setTab] = useState<SettingsTab>("calling");
  const [draft, setDraft] = useState<CRMSettings>(() => cloneSettings(state.settings));
  const [editing, setEditing] = useState(false);
  const [downloadKey, setDownloadKey] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);
  const [resetAcknowledged, setResetAcknowledged] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(cloneSettings(state.settings));
  }, [editing, state.settings]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(state.settings), [draft, state.settings]);
  const validation = useMemo(() => settingsValidation(draft), [draft]);
  const analytics = useMemo(() => computeAnalytics(state), [state]);

  const edit = (recipe: (current: CRMSettings) => CRMSettings) => {
    setDraft((current) => recipe(current));
    setEditing(true);
  };

  const save = () => {
    if (validation.length > 0) return;
    const nextSettings = cloneSettings(draft);
    commit(
      "Update settings",
      (current) => ({
        ...current,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        settings: nextSettings,
      }),
      "Settings saved",
    );
    setEditing(false);
  };

  const discard = () => {
    setDraft(cloneSettings(state.settings));
    setEditing(false);
  };

  const handleExport = async (kind: CRMExportKind, format: CRMExportFormat) => {
    const key = `${kind}:${format}`;
    setDownloadKey(key);
    try {
      const fileName = await downloadExport({ kind, format, state, analytics });
      notify(`${fileName} downloaded`, "success");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Export failed", "danger");
    } finally {
      setDownloadKey("");
    }
  };

  const handleBackup = () => {
    try {
      const now = new Date();
      const fileName = downloadBackup(state, now);
      const timestamp = now.toISOString();
      setDraft((current) => ({ ...current, data: { ...current.data, lastBackupAt: timestamp } }));
      commit(
        "Record backup",
        (current) => ({
          ...current,
          revision: current.revision + 1,
          updatedAt: timestamp,
          settings: { ...current.settings, data: { ...current.settings.data, lastBackupAt: timestamp } },
        }),
        `${fileName} downloaded`,
      );
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Backup failed", "danger");
    }
  };

  const handleRestore = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setRestoreError("");
    try {
      const restored = parseBackup(await file.text());
      setDraft(cloneSettings(restored.settings));
      setEditing(false);
      replaceState(restored, `Restored ${restored.leads.length.toLocaleString()} leads from ${file.name}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Backup validation failed.";
      setRestoreError(message);
      notify(message, "danger");
    }
  };

  const confirmReset = () => {
    if (!resetTarget || !resetAcknowledged) return;
    const next = createEmptyState();
    setDraft(cloneSettings(next.settings));
    setEditing(false);
    replaceState(next, "Workspace reset to empty");
    setResetTarget(null);
    setResetAcknowledged(false);
  };

  const openReset = (target: ResetTarget) => {
    setResetTarget(target);
    setResetAcknowledged(false);
  };

  const sourceLabel = persistence.source === "indexeddb" ? "IndexedDB" : persistence.source === "localstorage" ? "Local storage fallback" : "Memory only";

  return (
    <>
      <PageHeader
        eyebrow="Workspace controls"
        title="Settings"
        description="Tune the calling machine without adding administration to an active session. Changes persist across refreshes and restarts."
        actions={<Badge tone={persistence.persisted ? "success" : persistence.source === "memory" ? "danger" : "warning"} dot>{persistence.persisted ? "Durable storage granted" : sourceLabel}</Badge>}
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_TABS.map((item) => (
            <button key={item.id} className={cx("settings-nav__item", tab === item.id && "is-active")} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>
              <Icon name={item.icon} size={16} /><span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {tab === "calling" ? <CallingSettingsPanel settings={draft} edit={edit} /> : null}
          {tab === "queue" ? <QueueSettingsPanel settings={draft} edit={edit} /> : null}
          {tab === "meetings" ? <MeetingSettingsPanel settings={draft} edit={edit} /> : null}
          {tab === "interface" ? <InterfaceSettingsPanel settings={draft} edit={edit} /> : null}
          {tab === "keyboard" ? <KeyboardSettingsPanel settings={draft} edit={edit} /> : null}
          {tab === "data" ? (
            <DataSettingsPanel
              state={state}
              settings={draft}
              sourceLabel={sourceLabel}
              persisted={persistence.persisted}
              supported={persistence.supported}
              downloadKey={downloadKey}
              restoreError={restoreError}
              restoreInputRef={restoreInputRef}
              onExport={handleExport}
              onBackup={handleBackup}
              onRestore={handleRestore}
              onPersistentStorage={() => void refreshPersistence()}
              onEdit={edit}
              onReset={openReset}
            />
          ) : null}
          {tab === "about" ? <AboutSettingsPanel updates={updates} /> : null}

          <div className="settings-savebar">
            <span className="settings-savebar__status">
              {validation[0] ? <span style={{ color: "var(--danger)" }}>{validation[0]}</span> : dirty ? "Unsaved changes" : "All settings are saved automatically after confirmation"}
            </span>
            <span className="settings-savebar__actions">
              <Button variant="ghost" size="sm" disabled={!dirty} onClick={discard}>Discard</Button>
              <Button variant="primary" size="sm" disabled={!dirty || validation.length > 0} onClick={save} startIcon={<Icon name="check" size={14} />}>Save settings</Button>
            </span>
          </div>
        </div>
      </div>

      <Modal
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        title="Reset to an empty workspace?"
        description="This replaces every lead, call attempt, meeting, follow-up, batch, and setting currently stored. Download a backup first if you may need this data."
        size="sm"
        footer={<><Button variant="ghost" onClick={() => setResetTarget(null)}>Cancel</Button><Button variant="danger" disabled={!resetAcknowledged} onClick={confirmReset}>Delete workspace data</Button></>}
      >
        <label className="check-row">
          <input type="checkbox" checked={resetAcknowledged} onChange={(event) => setResetAcknowledged(event.target.checked)} />
          <span>I understand that the current workspace will be replaced and this action requires a backup to recover later.</span>
        </label>
      </Modal>
    </>
  );
}

function AboutSettingsPanel({ updates }: { updates: ReturnType<typeof useAppUpdates> }) {
  const checking = updates.status === "checking";
  const downloading = updates.status === "downloading";
  const ready = updates.status === "downloaded";
  const available = updates.status === "available";
  const canCheck = updates.isDesktop && updates.isPackaged && !checking && !downloading;
  const action = ready
    ? () => void updates.installUpdate()
    : available
      ? () => void updates.downloadUpdate()
      : () => void updates.checkForUpdates();
  const label = ready
    ? "Install and restart"
    : downloading
      ? `Downloading ${updates.progressPercent ?? 0}%`
      : available
        ? `Download ${updates.availableVersion}`
        : checking
          ? "Checking…"
          : "Check for updates";

  return (
    <>
      <SettingsSection title="About Relay" description="Installed builds check the configured GitHub Releases feed without storing a GitHub token in the application.">
        <SettingsRow title="Version" description="Semantic versions determine whether an installed copy should update."><Badge tone="accent">Version {updates.currentVersion}</Badge></SettingsRow>
        <SettingsRow title="Updates" description={updates.message}><Button variant={ready || available ? "primary" : "secondary"} size="sm" disabled={checking || downloading || !canCheck && !ready && !available} loading={checking || downloading} loadingLabel={label} onClick={action} startIcon={<Icon name={ready ? "refresh" : "download"} size={14} />}>{label}</Button></SettingsRow>
        <SettingsRow title="Latest release" description="Open the latest Relay release on GitHub."><Button variant="secondary" size="sm" onClick={() => window.open("https://github.com/ilyasgy/RelayColdCall/releases/latest", "_blank", "noopener,noreferrer")} startIcon={<Icon name="externalLink" size={14} />}>Download latest version</Button></SettingsRow>
      </SettingsSection>
      <SettingsSection title="Local data location" description="Application updates replace packaged program files only. This per-user folder remains separate from every installed version.">
        <SettingsRow title="Persistent profile" description="IndexedDB, localStorage fallback data, Chromium profile data, and updater cache live outside the installation directory."><code className="about-path">{updates.dataPath ?? "Available in the installed desktop app"}</code></SettingsRow>
      </SettingsSection>
      {!updates.isDesktop ? <p className="field__hint" style={{ padding: "0 18px 18px" }}>You are using the browser development build. Run <code>npm run desktop:dev</code> to preview the desktop shell.</p> : null}
    </>
  );
}

interface SettingsPanelProps {
  settings: CRMSettings;
  edit: (recipe: (current: CRMSettings) => CRMSettings) => void;
}

function CallingSettingsPanel({ settings, edit }: SettingsPanelProps) {
  const calling = settings.calling;
  const update = (patch: Partial<CRMSettings["calling"]>) => edit((current) => ({ ...current, calling: { ...current.calling, ...patch } }));
  return (
    <>
      <SettingsSection title="Calling window" description="Eligibility is evaluated in each prospect's local time zone.">
        <SettingsRow title="Daily call goal" description="Shown prominently in Today and Focus Mode."><NumberInput value={calling.dailyCallGoal} min={1} onChange={(dailyCallGoal) => update({ dailyCallGoal })} suffix="calls" /></SettingsRow>
        <SettingsRow title="Calling hours" description="Leads outside this local window wait automatically."><div style={controlGrid(2)}><input aria-label="Calling hours start" type="time" value={calling.callingHoursStart} onChange={(event) => update({ callingHoursStart: event.target.value })} /><input aria-label="Calling hours end" type="time" value={calling.callingHoursEnd} onChange={(event) => update({ callingHoursEnd: event.target.value })} /></div></SettingsRow>
        <SettingsRow title="Calling weekdays" description="Business-day retry calculations use the same work week."><div className="segmented" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>{WEEKDAYS.map(([value, label]) => <button key={value} className="segmented__item" aria-pressed={calling.callingWeekdays.includes(value)} onClick={() => update({ callingWeekdays: calling.callingWeekdays.includes(value) ? calling.callingWeekdays.filter((day) => day !== value) : [...calling.callingWeekdays, value] })}>{label}</button>)}</div></SettingsRow>
        <SettingsRow title="Exact callback override" description="Honor a prospect-requested exact time even outside the normal window."><Toggle checked={calling.exactCallbacksOverrideCallingHours} label={calling.exactCallbacksOverrideCallingHours ? "Enabled" : "Disabled"} onChange={(exactCallbacksOverrideCallingHours) => update({ exactCallbacksOverrideCallingHours })} /></SettingsRow>
      </SettingsSection>

      <SettingsSection title="Retry rules" description="No Answer schedules attempts 1 and 2; the third unanswered attempt moves the lead to Finished as Unreachable.">
        <SettingsRow title="Default retry delay" description="Fallback when an attempt-specific delay is unavailable."><NumberInput value={calling.defaultRetryDelayBusinessDays} min={0} onChange={(defaultRetryDelayBusinessDays) => update({ defaultRetryDelayBusinessDays })} suffix="business days" /></SettingsRow>
        <SettingsRow title="Attempt retry delays" description="Business-day delays after unanswered attempts 1 and 2."><input type="text" value={calling.retryDelaysBusinessDays.slice(0, 2).join(", ")} onChange={(event) => update({ retryDelaysBusinessDays: parseNumberList(event.target.value).slice(0, 2) })} aria-label="Attempt retry delays" /></SettingsRow>
        <SettingsRow title="Cold-call limit" description="Cold attempts and post-meeting touches are tracked separately."><Badge tone="accent">3 unanswered attempts</Badge></SettingsRow>
        <SettingsRow title="Retry time buckets" description="The engine rotates these local times to avoid repeating the same hour."><input type="text" value={calling.retryTimeBuckets.join(", ")} onChange={(event) => update({ retryTimeBuckets: parseTextList(event.target.value) })} aria-label="Retry time buckets" /></SettingsRow>
        <SettingsRow title="Holiday dates" description="Optional ISO dates (YYYY-MM-DD), separated by commas."><input type="text" value={calling.holidayDates.join(", ")} onChange={(event) => update({ holidayDates: parseTextList(event.target.value) })} aria-label="Holiday dates" placeholder="2026-12-25" /></SettingsRow>
      </SettingsSection>
    </>
  );
}

function QueueSettingsPanel({ settings, edit }: SettingsPanelProps) {
  const queue = settings.queue;
  const update = (patch: Partial<CRMSettings["queue"]>) => edit((current) => ({ ...current, queue: { ...current.queue, ...patch } }));
  const visibleOrder = queue.classOrder.filter((queueClass) => queueClass !== "recycled");
  return (
    <>
      <SettingsSection title="Queue priority order" description="Relay keeps this lifecycle-based order fixed; scoring breaks ties inside each class.">
        <div className="card-list" style={{ padding: 14 }}>
          {visibleOrder.map((queueClass, index) => <div className="context-block" key={queueClass} style={{ display: "flex", alignItems: "center", gap: 10 }}><Badge tone={index < 2 ? "accent" : "neutral"}>{index + 1}</Badge><strong style={{ flex: 1 }}>{QUEUE_LABELS[queueClass]}</strong><Badge tone="neutral">Fixed</Badge></div>)}
        </div>
      </SettingsSection>
      <SettingsSection title="Priority scoring" description="Simple bonuses influence ordering inside a queue class; the caller still sees only NEXT CALL.">
        <SettingsRow title="Pixel priority" description="Bonus for a confirmed tracking-pixel lead."><NumberInput value={queue.pixelPriority} min={0} onChange={(pixelPriority) => update({ pixelPriority })} suffix="points" /></SettingsRow>
        <SettingsRow title="Owner priority" description="Bonus for direct owner contacts."><NumberInput value={queue.ownerPriority} min={0} onChange={(ownerPriority) => update({ ownerPriority })} suffix="points" /></SettingsRow>
        <SettingsRow title="Finding strength priority" description="Tie-break bonuses for A, B, C, and unknown findings."><div style={controlGrid(4)}>{(["A", "B", "C", "unknown"] as const).map((strength) => <label className="field" key={strength}><span className="field__label">{strength}</span><input type="number" min={0} value={queue.findingStrengthPriority[strength]} onChange={(event) => update({ findingStrengthPriority: { ...queue.findingStrengthPriority, [strength]: Number(event.target.value) } })} /></label>)}</div></SettingsRow>
        <SettingsRow title="Manual priority levels" description="Critical, High, Normal, and Low remain visible operator controls."><div style={controlGrid(4)}>{(["critical", "high", "normal", "low"] as const).map((priority) => <label className="field" key={priority}><span className="field__label">{priority}</span><input type="number" min={0} value={queue.manualPriority[priority]} onChange={(event) => update({ manualPriority: { ...queue.manualPriority, [priority]: Number(event.target.value) } })} /></label>)}</div></SettingsRow>
      </SettingsSection>
    </>
  );
}

function MeetingSettingsPanel({ settings, edit }: SettingsPanelProps) {
  const updateMeetings = (patch: Partial<CRMSettings["meetings"]>) => edit((current) => ({ ...current, meetings: { ...current.meetings, ...patch } }));
  const updateFollowUp = (patch: Partial<CRMSettings["followUp"]>) => edit((current) => ({ ...current, followUp: { ...current.followUp, ...patch } }));
  return (
    <>
      <SettingsSection title="Meetings" description="Fast booking defaults and subtle reminders.">
        <SettingsRow title="Default duration" description="Pre-filled in every Meeting Booked form."><NumberInput value={settings.meetings.defaultDurationMinutes} min={5} step={5} onChange={(defaultDurationMinutes) => updateMeetings({ defaultDurationMinutes })} suffix="minutes" /></SettingsRow>
        <SettingsRow title="Reminder timing" description="Minutes before a meeting, comma-separated."><input type="text" value={settings.meetings.reminderMinutes.join(", ")} onChange={(event) => updateMeetings({ reminderMinutes: parseNumberList(event.target.value) })} aria-label="Meeting reminder timing" /></SettingsRow>
      </SettingsSection>
      <SettingsSection title="Five-touch post-meeting sequence" description="Meeting held plus no decision remains an active opportunity. Requested callback times always override this cadence.">
        <SettingsRow title="Maximum touches" description="Cold attempts and post-meeting touches are never combined."><Badge tone="purple">5 touches · fixed</Badge></SettingsRow>
        {Array.from({ length: 5 }, (_, index) => <SettingsRow key={index} title={`Touch ${index + 1}`} description={index === 0 ? "Business days after the completed meeting." : "Business days after the previous scheduled touch."}><NumberInput value={settings.followUp.cadenceBusinessDays[index] ?? 1} min={1} onChange={(value) => { const cadenceBusinessDays = [...settings.followUp.cadenceBusinessDays]; cadenceBusinessDays[index] = value; updateFollowUp({ maximumPostMeetingTouches: 5, cadenceBusinessDays: cadenceBusinessDays.slice(0, 5) }); }} suffix="business days" /></SettingsRow>)}
      </SettingsSection>
    </>
  );
}

function InterfaceSettingsPanel({ settings, edit }: SettingsPanelProps) {
  const update = (patch: Partial<CRMSettings["interface"]>) => edit((current) => ({ ...current, interface: { ...current.interface, ...patch } }));
  return (
    <SettingsSection title="Interface" description="Choose a low-noise workspace that remains comfortable for long calling sessions.">
      <SettingsRow title="Density" description="Compact shows more context; Comfortable adds breathing room."><Segmented choices={["compact", "comfortable"]} value={settings.interface.density} onChange={(density) => update({ density: density as "compact" | "comfortable" })} /></SettingsRow>
      <SettingsRow title="Theme" description="Dark is optimized for the calling cockpit; Light is available everywhere."><Segmented choices={["dark", "light"]} value={settings.interface.theme} onChange={(theme) => update({ theme: theme as "dark" | "light" })} /></SettingsRow>
      <SettingsRow title="Default lead time zone" description="Used only when an imported row has no time zone."><input type="text" value={settings.defaultLeadTimeZone} onChange={(event) => edit((current) => ({ ...current, defaultLeadTimeZone: event.target.value }))} placeholder="America/New_York" aria-label="Default lead time zone" /></SettingsRow>
    </SettingsSection>
  );
}

function KeyboardSettingsPanel({ settings, edit }: SettingsPanelProps) {
  const update = (patch: Partial<CRMSettings["interface"]>) => edit((current) => ({ ...current, interface: { ...current.interface, ...patch } }));
  return (
    <SettingsSection title="Keyboard shortcuts" description="Shortcuts are suppressed while typing in notes or form fields, and permanent actions still require confirmation.">
      <SettingsRow title="Enable shortcuts" description="Operate Focus Mode with minimal mouse movement."><Toggle checked={settings.interface.keyboardShortcutsEnabled} label={settings.interface.keyboardShortcutsEnabled ? "Enabled" : "Disabled"} onChange={(keyboardShortcutsEnabled) => update({ keyboardShortcutsEnabled })} /></SettingsRow>
      <div className="panel__body">
        <div className="shortcut-list">
          {Object.entries(settings.interface.shortcuts).map(([action, shortcut]) => <label className="shortcut-row" key={action}><span className="shortcut-row__label">{SHORTCUT_LABELS[action] ?? action}</span><input style={{ width: 130 }} type="text" value={shortcut} maxLength={16} disabled={!settings.interface.keyboardShortcutsEnabled} onChange={(event) => update({ shortcuts: { ...settings.interface.shortcuts, [action]: event.target.value.toLowerCase() } })} aria-label={`${SHORTCUT_LABELS[action] ?? action} shortcut`} /></label>)}
        </div>
      </div>
    </SettingsSection>
  );
}

interface DataSettingsPanelProps {
  state: ReturnType<typeof createEmptyState>;
  settings: CRMSettings;
  sourceLabel: string;
  persisted: boolean;
  supported: boolean;
  downloadKey: string;
  restoreError: string;
  restoreInputRef: React.RefObject<HTMLInputElement>;
  onExport: (kind: CRMExportKind, format: CRMExportFormat) => Promise<void>;
  onBackup: () => void;
  onRestore: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onPersistentStorage: () => void;
  onEdit: (recipe: (current: CRMSettings) => CRMSettings) => void;
  onReset: (target: ResetTarget) => void;
}

function DataSettingsPanel({ state, settings, sourceLabel, persisted, supported, downloadKey, restoreError, restoreInputRef, onExport, onBackup, onRestore, onPersistentStorage, onEdit, onReset }: DataSettingsPanelProps) {
  return (
    <>
      <SettingsSection title="Durable data storage" description="IndexedDB is the primary database. JSON backups provide a portable recovery copy.">
        <SettingsRow title="Browser database" description={`${state.leads.length.toLocaleString()} leads, ${state.callAttempts.length.toLocaleString()} call attempts, ${state.meetings.length.toLocaleString()} meetings.`}><div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}><Badge tone={persisted ? "success" : "warning"} dot>{sourceLabel}</Badge><Button size="sm" variant="secondary" disabled={!supported || persisted} onClick={onPersistentStorage} startIcon={<Icon name="lock" size={14} />}>{persisted ? "Durable storage granted" : supported ? "Request durable storage" : "Persistence API unavailable"}</Button></div></SettingsRow>
        <SettingsRow title="Backup reminder" description="Warn when a portable backup has not been downloaded recently."><NumberInput value={settings.data.backupReminderDays} min={1} onChange={(backupReminderDays) => onEdit((current) => ({ ...current, data: { ...current.data, backupReminderDays } }))} suffix="days" /></SettingsRow>
      </SettingsSection>

      <SettingsSection title="Import" description="Add a CSV or XLSX list through the guided field-mapping workflow.">
        <SettingsRow title="Import leads" description="Preview rows, resolve duplicates, and record every imported batch before committing it."><Button variant="secondary" size="sm" onClick={() => { window.location.hash = "/import"; }} startIcon={<Icon name="upload" size={14} />}>Open Import</Button></SettingsRow>
      </SettingsSection>

      <SettingsSection title="Export" description="Exports use current stored call, meeting, lead, and analytics data—not placeholder metrics.">
        {EXPORT_CHOICES.map((choice) => <SettingsRow key={choice.kind} title={choice.label} description={exportDescription(choice.kind)}><div style={{ display: "flex", gap: 7 }}><Button size="sm" variant="secondary" loading={downloadKey === `${choice.kind}:csv`} loadingLabel="CSV" onClick={() => void onExport(choice.kind, "csv")} startIcon={<Icon name="download" size={14} />}>CSV</Button><Button size="sm" variant="secondary" loading={downloadKey === `${choice.kind}:xlsx`} loadingLabel="XLSX" onClick={() => void onExport(choice.kind, "xlsx")} startIcon={<Icon name="table" size={14} />}>XLSX</Button></div></SettingsRow>)}
      </SettingsSection>

      <SettingsSection title="Backup and restore" description="A versioned JSON backup contains the complete workspace, including settings, history, batches, queue actions, and separate counters.">
        <SettingsRow title="Download full backup" description={settings.data.lastBackupAt ? `Last backup: ${formatDate(settings.data.lastBackupAt)}` : "No backup has been recorded yet."}><Button variant="primary" size="sm" onClick={onBackup} startIcon={<Icon name="download" size={14} />}>Download JSON backup</Button></SettingsRow>
        <SettingsRow title="Restore from backup" description="The file is validated for version, schema, required collections, IDs, and lead references before replacement."><><Button variant="secondary" size="sm" onClick={() => restoreInputRef.current?.click()} startIcon={<Icon name="upload" size={14} />}>Choose backup</Button><input ref={restoreInputRef} type="file" accept=".json,application/json" hidden onChange={(event) => void onRestore(event)} /></></SettingsRow>
        {restoreError ? <div style={{ padding: "0 18px 14px" }}><p className="field__error"><Icon name="alert" size={14} />{restoreError}</p></div> : null}
      </SettingsSection>

      <SettingsSection title="Imported batches" description="Every source list remains visible for filtering and performance comparison.">
        {state.batches.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Batch</th><th>Source</th><th>Imported</th><th>Duplicates</th><th>Skipped</th><th>Date</th></tr></thead><tbody>{[...state.batches].sort((a, b) => b.importedAt.localeCompare(a.importedAt)).map((batch) => <tr key={batch.id}><td><strong>{batch.name}</strong><small>{batch.fileName || batch.id}</small></td><td>{batch.source}</td><td>{batch.importedCount.toLocaleString()} / {batch.rowCount.toLocaleString()}</td><td>{batch.duplicateCount.toLocaleString()}</td><td>{batch.skippedCount.toLocaleString()}</td><td>{formatDate(batch.importedAt)}</td></tr>)}</tbody></table></div> : <div className="panel__body"><p className="field__hint">No imported batches yet. Use Import to add a CSV or XLSX list.</p></div>}
      </SettingsSection>

      <SettingsSection title="Danger zone" description="These controls replace the full persisted workspace and always require explicit confirmation.">
        <SettingsRow title="Reset to empty" description="Remove all operational data and begin with default settings."><Button variant="danger" size="sm" onClick={() => onReset("empty")} startIcon={<Icon name="trash" size={14} />}>Reset workspace</Button></SettingsRow>
      </SettingsSection>
    </>
  );
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="settings-section"><header className="settings-section__header"><h2 className="settings-section__title">{title}</h2><p className="settings-section__description">{description}</p></header>{children}</section>;
}

function SettingsRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="settings-row"><div><span className="settings-row__title">{title}</span><span className="settings-row__description">{description}</span></div><div className="settings-row__control">{children}</div></div>;
}

function NumberInput({ value, onChange, min = 0, step = 1, suffix }: { value: number; onChange: (value: number) => void; min?: number; step?: number; suffix?: string }) {
  return <div className="input-group" style={{ width: "min(100%, 230px)" }}><input type="number" value={value} min={min} step={step} onChange={(event) => onChange(Math.max(min, Number(event.target.value) || 0))} />{suffix ? <span className="input-suffix">{suffix}</span> : null}</div>;
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <label className="switch"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="switch__track" /><span className="switch__label">{label}</span></label>;
}

function Segmented({ choices, value, onChange }: { choices: string[]; value: string; onChange: (value: string) => void }) {
  return <div className="segmented">{choices.map((choice) => <button className="segmented__item" key={choice} aria-pressed={value === choice} onClick={() => onChange(choice)}>{choice.replace(/\b\w/g, (character) => character.toUpperCase())}</button>)}</div>;
}

function controlGrid(columns: number): React.CSSProperties {
  return { display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(70px, 1fr))`, gap: 7, width: "100%" };
}

function exportDescription(kind: CRMExportKind): string {
  if (kind === "meetings") return "Meeting schedule, context, status, outcomes, and notes.";
  if (kind === "won" || kind === "won-clients") return "All current client records with their complete lead context.";
  if (kind === "lost" || kind === "lost-leads") return "Closed-lost records and retained loss reasons.";
  if (kind === "call-history") return "Every timestamped cold and post-meeting call attempt.";
  if (kind === "analytics") return "Current summary, finding, contact-type, and cold-attempt performance.";
  return "Every retained lead, current state, counters, next action, and research field.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
