import type {
  ContactType,
  LeadPriority,
  MeetingOutcome,
  PostMeetingOutcomeKind,
  WorkflowStatus,
} from "../types";

export const STATUS_LABELS: Record<WorkflowStatus, string> = {
  new: "New",
  retry_scheduled: "Retry scheduled",
  recycle_later: "Recycle later",
  extended_retry: "Extended retry",
  callback: "Callback",
  conversation_follow_up: "Conversation follow-up",
  interested: "Interested",
  meeting_booked: "Meeting booked",
  second_meeting_booked: "Second meeting booked",
  decision_pending: "Decision pending",
  proposal_sent: "Proposal sent",
  post_meeting_follow_up: "Post-meeting follow-up",
  contact_data_required: "Contact data required",
  research_required: "Research required",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
  disqualified: "Disqualified",
  archived: "Archived",
  won: "Won / Client",
  lost: "Lost / Closed",
  do_not_call: "Do not call",
  dormant_unreachable: "Dormant — Unreachable",
  dormant_post_meeting_no_response: "Dormant — Post-meeting no response",
};

export const STATUS_TONES: Record<WorkflowStatus, string> = {
  new: "neutral",
  retry_scheduled: "info",
  recycle_later: "muted",
  extended_retry: "info",
  callback: "warning",
  conversation_follow_up: "purple",
  interested: "purple",
  meeting_booked: "info",
  second_meeting_booked: "info",
  decision_pending: "warning",
  proposal_sent: "warning",
  post_meeting_follow_up: "purple",
  contact_data_required: "danger",
  research_required: "warning",
  not_interested: "muted",
  wrong_number: "danger",
  disqualified: "muted",
  archived: "muted",
  won: "success",
  lost: "muted",
  do_not_call: "danger",
  dormant_unreachable: "muted",
  dormant_post_meeting_no_response: "muted",
};

export const PRIORITY_LABELS: Record<LeadPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  owner: "Owner",
  practice_manager: "Practice Manager",
  office_manager: "Office Manager",
  clinic_director: "Clinic Director",
  administrator: "Administrator",
  other: "Other",
  unknown: "Unknown",
};

export const LOST_REASONS = [
  "Not Interested",
  "No Need",
  "Existing Provider",
  "Budget",
  "Timing",
  "Website Not Important",
  "Security Already Assessed",
  "Corporate Decision",
  "Wrong Fit",
  "Other",
] as const;

export const MEETING_OUTCOME_LABELS: Record<MeetingOutcome, string> = {
  won: "Won / Client",
  decision_pending: "Decision pending",
  follow_up_needed: "Follow-up needed",
  second_meeting_needed: "Second meeting needed",
  proposal_sent: "Proposal / agreement sent",
  lost: "Lost",
};

export const POST_MEETING_OUTCOME_LABELS: Record<PostMeetingOutcomeKind, string> = {
  no_answer: "No answer",
  still_deciding: "Spoke — Still deciding",
  needs_internal_approval: "Needs internal approval",
  requested_callback: "Requested callback",
  second_meeting_booked: "Second meeting booked",
  proposal_sent: "Agreement / proposal sent",
  won: "Won",
  lost: "Lost",
  do_not_contact: "Do not contact",
};

export const ROUTES = [
  "dashboard",
  "leads",
  "meetings",
  "follow-ups",
  "finished",
  "import",
  "settings",
] as const;

export type Route = (typeof ROUTES)[number];

export const NAV_ITEMS: Array<{
  route: Route;
  label: string;
  icon: string;
}> = [
  { route: "dashboard", label: "Today", icon: "dashboard" },
  { route: "leads", label: "Leads", icon: "leads" },
  { route: "meetings", label: "Meetings", icon: "calendar" },
  { route: "follow-ups", label: "Follow-Ups", icon: "followUp" },
  { route: "finished", label: "Finished", icon: "checkCircle" },
];
