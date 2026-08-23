import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { Icon, type IconName } from "./Icon";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "quiet";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    startIcon,
    endIcon,
    loading = false,
    loadingLabel = "Working",
    fullWidth = false,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("button", `button--${variant}`, `button--${size}`, fullWidth && "button--full", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : startIcon ? <span className="button__icon">{startIcon}</span> : null}
      {loading ? <span>{loadingLabel}</span> : children}
      {!loading && endIcon ? <span className="button__icon">{endIcon}</span> : null}
    </button>
  );
});

export type BadgeTone = "neutral" | "accent" | "info" | "success" | "warning" | "danger" | "purple";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: "sm" | "md";
  dot?: boolean;
  icon?: ReactNode;
}

export function Badge({ tone = "neutral", size = "md", dot = false, icon, className, children, ...props }: BadgeProps) {
  return (
    <span className={cx("badge", `badge--${tone}`, `badge--${size}`, className)} {...props}>
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {icon ? <span className="badge__icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  closeLabel?: string;
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement>;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeLabel = "Close dialog",
  dismissible = true,
  initialFocusRef,
  className,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const requested = initialFocusRef?.current;
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      (requested ?? firstFocusable ?? dialogRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.offsetParent !== null,
      );
      if (items.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [dismissible, initialFocusRef, onClose, open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={cx("modal", `modal--${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="modal__header">
          <div className="modal__heading">
            <h2 id={titleId} className="modal__title">{title}</h2>
            {description ? <p id={descriptionId} className="modal__description">{description}</p> : null}
          </div>
          {dismissible ? (
            <Button className="modal__close" variant="ghost" size="icon" onClick={onClose} aria-label={closeLabel}>
              <Icon name="close" size={19} />
            </Button>
          ) : null}
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, secondaryAction, compact, className, ...props }: EmptyStateProps) {
  return (
    <div className={cx("empty-state", compact && "empty-state--compact", className)} {...props}>
      {icon ? <div className="empty-state__icon" aria-hidden="true">{icon}</div> : null}
      <h2 className="empty-state__title">{title}</h2>
      {description ? <p className="empty-state__description">{description}</p> : null}
      {action || secondaryAction ? <div className="empty-state__actions">{action}{secondaryAction}</div> : null}
    </div>
  );
}

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
}

export function PageHeader({ title, description, eyebrow, actions, leading, className, ...props }: PageHeaderProps) {
  return (
    <header className={cx("page-header", className)} {...props}>
      <div className="page-header__main">
        {leading ? <div className="page-header__leading">{leading}</div> : null}
        <div className="page-header__copy">
          {eyebrow ? <div className="page-header__eyebrow">{eyebrow}</div> : null}
          <h1 className="page-header__title">{title}</h1>
          {description ? <p className="page-header__description">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export interface MetricCardProps extends HTMLAttributes<HTMLElement> {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  change?: ReactNode;
  changeLabel?: string;
  trend?: "up" | "down" | "flat";
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
}

export function MetricCard({
  label,
  value,
  icon,
  hint,
  change,
  changeLabel,
  trend = "flat",
  tone = "neutral",
  className,
  ...props
}: MetricCardProps) {
  return (
    <article className={cx("metric-card", `metric-card--${tone}`, className)} {...props}>
      <div className="metric-card__top">
        <span className="metric-card__label">{label}</span>
        {icon ? <span className="metric-card__icon" aria-hidden="true">{icon}</span> : null}
      </div>
      <div className="metric-card__value">{value}</div>
      {change || hint ? (
        <div className="metric-card__meta">
          {change ? (
            <span className={cx("metric-card__change", `metric-card__change--${trend}`)} aria-label={changeLabel}>
              {trend === "up" ? <Icon name="arrowUp" size={13} /> : trend === "down" ? <Icon name="arrowDown" size={13} /> : null}
              {change}
            </span>
          ) : null}
          {hint ? <span className="metric-card__hint">{hint}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  value: number;
  max?: number;
  label?: ReactNode;
  showValue?: boolean;
  valueLabel?: ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: "accent" | "success" | "warning" | "danger";
}

export function Progress({
  value,
  max = 100,
  label,
  showValue = false,
  valueLabel,
  size = "md",
  tone = "accent",
  className,
  ...props
}: ProgressProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value) ? Math.min(Math.max(value, 0), safeMax) : 0;
  const percent = (safeValue / safeMax) * 100;

  return (
    <div className={cx("progress", `progress--${size}`, `progress--${tone}`, className)} {...props}>
      {label || showValue || valueLabel ? (
        <div className="progress__labels">
          <span className="progress__label">{label}</span>
          {showValue || valueLabel ? <span className="progress__value">{valueLabel ?? `${Math.round(percent)}%`}</span> : null}
        </div>
      ) : null}
      <div
        className="progress__track"
        role="progressbar"
        aria-label={typeof label === "string" ? label : "Progress"}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={safeValue}
      >
        <span className="progress__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export type ToastTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  message: ReactNode;
  tone?: ToastTone;
  icon?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}

const toastIcon: Record<ToastTone, IconName> = {
  neutral: "info",
  info: "info",
  success: "checkCircle",
  warning: "warning",
  danger: "alert",
};

export function Toast({
  title,
  message,
  tone = "neutral",
  icon,
  action,
  onDismiss,
  dismissLabel = "Dismiss notification",
  className,
  ...props
}: ToastProps) {
  return (
    <div
      className={cx("toast", `toast--${tone}`, className)}
      role={tone === "danger" ? "alert" : "status"}
      aria-live={tone === "danger" ? "assertive" : "polite"}
      {...props}
    >
      <div className="toast__icon" aria-hidden="true">{icon ?? <Icon name={toastIcon[tone]} size={19} />}</div>
      <div className="toast__copy">
        {title ? <div className="toast__title">{title}</div> : null}
        <div className="toast__message">{message}</div>
      </div>
      {action ? <div className="toast__action">{action}</div> : null}
      {onDismiss ? (
        <Button variant="ghost" size="icon" className="toast__dismiss" onClick={onDismiss} aria-label={dismissLabel}>
          <Icon name="close" size={17} />
        </Button>
      ) : null}
    </div>
  );
}

export interface UndoBarProps extends Omit<ToastProps, "action" | "tone"> {
  onUndo: () => void;
  undoLabel?: string;
}

export function UndoBar({ onUndo, undoLabel = "Undo", ...props }: UndoBarProps) {
  return (
    <Toast
      {...props}
      tone="neutral"
      icon={<Icon name="checkCircle" size={19} />}
      className={cx("undo-bar", props.className)}
      action={
        <Button variant="ghost" size="sm" className="undo-bar__button" onClick={onUndo} startIcon={<Icon name="undo" size={16} />}>
          {undoLabel}
        </Button>
      }
    />
  );
}

export const UndoToast = UndoBar;
