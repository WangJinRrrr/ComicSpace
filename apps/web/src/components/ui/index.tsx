import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-canvas shadow-soft hover:bg-ink-soft hover:shadow-lift disabled:bg-ink/40 disabled:shadow-none",
  secondary:
    "bg-surface text-ink border border-line shadow-soft hover:border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-muted hover:bg-surface-3/70 hover:text-ink",
  danger: "bg-danger/10 text-danger border border-danger/25 hover:bg-danger/15",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-xs rounded-full gap-1.5",
  md: "h-10 px-5 text-sm rounded-full gap-2",
  lg: "h-12 px-6 text-base rounded-full gap-2.5",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={cn(
        "press inline-flex items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,box-shadow,color,transform] duration-200 disabled:cursor-not-allowed disabled:opacity-60",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "press inline-flex size-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-3/70 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-full border border-line bg-surface px-4 text-sm text-ink transition-[border-color,box-shadow] placeholder:text-muted/70 hover:border-line-strong focus:border-accent-soft focus:outline-none focus:ring-4 focus:ring-accent-soft/20",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "select-chevron h-10 w-full cursor-pointer rounded-full border border-line bg-surface pl-4 text-sm text-ink transition-[border-color,box-shadow] hover:border-line-strong focus:border-accent-soft focus:outline-none focus:ring-4 focus:ring-accent-soft/20",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "danger" | "success";
  className?: string;
}) {
  const tones = {
    neutral: "border-line bg-surface-2 text-ink-soft",
    accent: "border-accent/30 bg-accent/10 text-accent",
    danger: "border-danger/30 bg-danger/10 text-danger",
    success: "border-success/30 bg-success/10 text-success",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ label = "加载中" }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-3 py-12 text-sm text-muted"
      role="status"
    >
      <span className="relative size-5" aria-hidden="true">
        <span className="absolute inset-0 animate-spin rounded-full border-[1.5px] border-line border-t-accent" />
        <span className="absolute inset-[5px] animate-spin rounded-full border-[1.5px] border-transparent border-b-signal-ink [animation-direction:reverse] [animation-duration:1.4s]" />
      </span>
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("shimmer rounded-lg", className)}
      aria-hidden="true"
    />
  );
}

export function ProgressBar({
  value,
  label,
}: {
  value: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="space-y-1">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "进度"}
      >
        <div
          className="h-full rounded-full bg-linear-to-r from-accent-soft to-accent transition-[width] duration-300 ease-out-expo"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
  icon,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-64 flex-col items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface/70 px-6 py-14 text-center">
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--cs-grid)_1px,transparent_1px),linear-gradient(90deg,var(--cs-grid)_1px,transparent_1px)] bg-size-[20px_20px] mask-[radial-gradient(circle_at_center,#000,transparent_75%)]"
        aria-hidden="true"
      />
      <CornerTicks />
      {icon ? (
        <div className="relative mb-5 grid size-14 place-items-center rounded-full bg-surface text-muted shadow-soft ring-1 ring-line">
          {icon}
        </div>
      ) : null}
      <h2 className="relative text-title font-semibold text-ink">{title}</h2>
      {description ? (
        <div className="relative mt-2 max-w-xl text-sm leading-6 text-muted">
          {description}
        </div>
      ) : null}
      {children ? <div className="relative mt-6">{children}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "加载失败",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-danger/25 bg-danger/5 px-5 py-6 text-sm"
    >
      <div className="label-mono mb-1.5 text-danger/70">Error</div>
      <div className="font-semibold text-danger">{title}</div>
      {message ? <p className="mt-1 text-muted">{message}</p> : null}
      {onRetry ? (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small monospace section code shown above the title, e.g. "01 / Discover". */
  eyebrow?: string;
}) {
  return (
    <header className="animate-rise flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-6">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="label-mono mb-3 flex items-center gap-2.5 text-muted">
            <span className="h-px w-6 bg-accent-soft" aria-hidden="true" />
            <span className="caret">{eyebrow}</span>
          </div>
        ) : null}
        <h1 className="text-headline font-semibold break-words text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

/** Section heading with an index number and a hairline rule. */
export function SectionHeader({
  index,
  title,
  meta,
  actions,
}: {
  index?: string;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-baseline gap-3">
        {index ? (
          <span className="label-mono text-accent tabular">{index}</span>
        ) : null}
        <h2 className="text-title font-semibold text-ink">{title}</h2>
        {meta ? <span className="text-xs text-muted">{meta}</span> : null}
      </div>
      <span
        className="hidden h-px min-w-8 flex-1 bg-line sm:block"
        aria-hidden="true"
      />
      {actions ? (
        <div className="ml-auto flex items-center gap-2 sm:ml-0">{actions}</div>
      ) : null}
    </div>
  );
}

function CornerTicks() {
  const base = "pointer-events-none absolute size-3 border-line-strong";
  return (
    <>
      <span className={cn(base, "left-3 top-3 border-l border-t")} aria-hidden="true" />
      <span className={cn(base, "right-3 top-3 border-r border-t")} aria-hidden="true" />
      <span className={cn(base, "bottom-3 left-3 border-b border-l")} aria-hidden="true" />
      <span className={cn(base, "bottom-3 right-3 border-b border-r")} aria-hidden="true" />
    </>
  );
}

export function Field({
  label,
  description,
  error,
  children,
  htmlFor,
}: {
  label: string;
  description?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-ink"
      >
        {label}
      </label>
      {children}
      {description ? (
        <p className="text-xs leading-5 text-muted">{description}</p>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-surface p-4 shadow-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}
