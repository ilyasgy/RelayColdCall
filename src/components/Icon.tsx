import type { ReactNode, SVGProps } from "react";

const glyphs: Record<string, ReactNode> = {
  activity: <><path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" /></>,
  alert: <><path d="M12 3 2.8 19a1.3 1.3 0 0 0 1.1 2h16.2a1.3 1.3 0 0 0 1.1-2L12 3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  analytics: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
  arrowDown: <><path d="m6 9 6 6 6-6" /></>,
  arrowLeft: <><path d="m15 18-6-6 6-6" /></>,
  arrowRight: <><path d="m9 18 6-6-6-6" /></>,
  arrowUp: <><path d="m18 15-6-6-6 6" /></>,
  badNumber: <><path d="M8.3 3.6 6.9 2.2a1.4 1.4 0 0 0-2 0L3.2 3.9c-1.7 1.7.2 6.3 4.3 10.4s8.7 6 10.4 4.3l1.7-1.7a1.4 1.4 0 0 0 0-2l-1.4-1.4a1.4 1.4 0 0 0-1.8-.2l-1.7 1.2a17 17 0 0 1-5.1-5.1l1.2-1.7a1.4 1.4 0 0 0-.2-1.8L9.4 4.7" /><path d="m15 3 6 6" /><path d="m21 3-6 6" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></>,
  building: <><path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16" /><path d="M17 9h2a2 2 0 0 1 2 2v10" /><path d="M8 7h2M8 11h2M8 15h2M13 7h1M13 11h1M13 15h1M2 21h20" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  calendarClock: <><path d="M16 3v4M8 3v4M3 10h11M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5" /><path d="M13 21H6a3 3 0 0 1-3-3V8" /><circle cx="18" cy="18" r="4" /><path d="M18 16v2l1.5 1" /></>,
  callback: <><path d="M9 7H5V3" /><path d="M5.2 7A8 8 0 1 1 4 15" /><path d="M15.5 11.5c-.9-.9-2.1-.5-2.5.1l-.7 1a11 11 0 0 1-2.9-2.9l1-.7c.6-.4 1-1.6.1-2.5l-.9-.9c-.6-.6-1.5-.6-2.1 0l-1 1c-1.1 1.1.2 4 2.6 6.4s5.3 3.7 6.4 2.6l1-1c.6-.6.6-1.5 0-2.1l-1-1Z" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.6 2.6L16.5 9" /></>,
  chevronDown: <><path d="m6 9 6 6 6-6" /></>,
  chevronLeft: <><path d="m15 18-6-6 6-6" /></>,
  chevronRight: <><path d="m9 18 6-6-6-6" /></>,
  chevronUp: <><path d="m18 15-6-6-6 6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  edit: <><path d="M12 20H5a1 1 0 0 1-1-1v-7L14.7 1.3a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L8 16H4" /><path d="m13 3 5 5" /></>,
  externalLink: <><path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  file: <><path d="M6 2h8l4 4v16H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" /><path d="M14 2v5h5M8 12h8M8 16h8" /></>,
  filter: <><path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" /></>,
  followUp: <><path d="M17 2v4h4" /><path d="M20.5 6A9 9 0 1 0 21 17" /><path d="M8 12h8M12 8l4 4-4 4" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  handshake: <><path d="m8 11 3-3a2 2 0 0 1 2.8 0l5.7 5.7a2 2 0 0 1-2.8 2.8l-4.2-4.2" /><path d="m15.5 15.5-2 2a2 2 0 0 1-2.8 0l-1.2-1.2" /><path d="m8.5 15.5-1 1a2 2 0 0 1-2.8-2.8L10.4 8a2 2 0 0 1 2.1-.5" /><path d="M2 9.5 6 5l3 3M22 9.5 18 5l-2.5 2.5" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.7.3-.7.9-.7 1.6" /><path d="M12 17h.01" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  import: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  keyboard: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M7 16h10" /></>,
  leads: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2" /><circle cx="17" cy="9" r="2" /><path d="M16 14a5 5 0 0 1 5 5v1" /></>,
  link: <><path d="M10 13a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11 6.3" /><path d="M14 11a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7L13 17.7" /></>,
  list: <><path d="M9 6h12M9 12h12M9 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  location: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  lost: <><circle cx="12" cy="12" r="9" /><path d="m8.5 8.5 7 7M15.5 8.5l-7 7" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  moon: <><path d="M20 15.3A8.5 8.5 0 0 1 8.7 4 8.5 8.5 0 1 0 20 15.3Z" /></>,
  note: <><path d="M5 3h14a2 2 0 0 1 2 2v10l-6 6H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M15 21v-6h6M7 8h10M7 12h7" /></>,
  pause: <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>,
  phone: <><path d="M8.3 3.6 6.9 2.2a1.4 1.4 0 0 0-2 0L3.2 3.9c-1.7 1.7.2 6.3 4.3 10.4s8.7 6 10.4 4.3l1.7-1.7a1.4 1.4 0 0 0 0-2l-1.4-1.4a1.4 1.4 0 0 0-1.8-.2l-1.7 1.2a17 17 0 0 1-5.1-5.1l1.2-1.7a1.4 1.4 0 0 0-.2-1.8L9.4 4.7" /></>,
  phoneIncoming: <><path d="M15 3h6v6M21 3l-7 7" /><path d="M8.3 4.6 6.9 3.2a1.4 1.4 0 0 0-2 0L3.2 4.9c-1.7 1.7.2 6.3 4.3 10.4s8.7 6 10.4 4.3l1.7-1.7a1.4 1.4 0 0 0 0-2l-1.4-1.4a1.4 1.4 0 0 0-1.8-.2l-1.7 1.2a17 17 0 0 1-5.1-5.1l1.2-1.7a1.4 1.4 0 0 0-.2-1.8L9.4 5.7" /></>,
  play: <><path d="m8 5 11 7-11 7V5Z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  recycle: <><path d="M20 7h-5V2" /><path d="M20 7a9 9 0 0 0-15.5-2M4 17h5v5" /><path d="M4 17a9 9 0 0 0 15.5 2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5 5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m8.5 12 2 2 5-5" /></>,
  sidebar: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>,
  spark: <><path d="m12 2 1.4 5.6L19 9l-5.6 1.4L12 16l-1.4-5.6L5 9l5.6-1.4L12 2Z" /><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" /></>,
  stop: <><rect x="5" y="5" width="14" height="14" rx="2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16M15 4v16" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>,
  timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6M12 2v3" /></>,
  trash: <><path d="M4 7h16M9 3h6l1 4H8l1-4ZM6 7l1 14h10l1-14M10 11v6M14 11v6" /></>,
  undo: <><path d="M9 7H4v-5" /><path d="M4.5 7A9 9 0 1 1 3 15" /></>,
  upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  warning: <><path d="M12 3 2.8 19a1.3 1.3 0 0 0 1.1 2h16.2a1.3 1.3 0 0 0 1.1-2L12 3Z" /><path d="M12 9v4M12 17h.01" /></>,
  won: <><path d="M8 21h8M12 17v4" /><path d="M6 3h12v5a6 6 0 0 1-12 0V3Z" /><path d="M6 5H3v2a4 4 0 0 0 4 4M18 5h3v2a4 4 0 0 1-4 4" /></>,
  x: <><path d="m6 6 12 12M18 6 6 18" /></>,
  zap: <><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></>,
};

const aliases: Record<string, string> = {
  "arrow-down": "arrowDown",
  "arrow-left": "arrowLeft",
  "arrow-right": "arrowRight",
  "arrow-up": "arrowUp",
  "bad-number": "badNumber",
  "bar-chart": "analytics",
  "calendar-clock": "calendarClock",
  "check-circle": "checkCircle",
  "chevron-down": "chevronDown",
  "chevron-left": "chevronLeft",
  "chevron-right": "chevronRight",
  "chevron-up": "chevronUp",
  clients: "won",
  close: "x",
  contact: "user",
  "external-link": "externalLink",
  "follow-up": "followUp",
  followups: "followUp",
  home: "dashboard",
  "layout-dashboard": "dashboard",
  meetings: "calendar",
  "phone-call": "phone",
  "phone-incoming": "phoneIncoming",
  "refresh-cw": "recycle",
  retry: "recycle",
  trophy: "won",
  users: "leads",
  "x-circle": "lost",
};

export type IconName = keyof typeof glyphs;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName | string;
  size?: number | string;
  title?: string;
}

/** Lightweight, dependency-free line icons. Unknown names render a neutral help icon. */
export function Icon({ name, size = 20, title, className = "", ...props }: IconProps) {
  const resolvedName = aliases[name] ?? name;
  const glyph = glyphs[resolvedName] ?? glyphs.help;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`icon ${className}`.trim()}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {glyph}
    </svg>
  );
}

