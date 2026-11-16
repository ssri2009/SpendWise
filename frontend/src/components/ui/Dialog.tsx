import { motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';

/**
 * Modal built on the native <dialog> element: focus is trapped, Escape closes it and it
 * sits in the browser's top layer above the sticky header. Render it only while open.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  onSubmit,
  size = 'md',
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** When set, the body is a <form> and Enter submits it. */
  onSubmit?: () => void;
  size?: 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!dlg.open) dlg.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    dlg.addEventListener('cancel', onCancel);
    return () => {
      dlg.removeEventListener('cancel', onCancel);
      if (dlg.open) dlg.close();
      opener?.focus?.();
    };
  }, []);

  const body = (
    <>
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-bold tracking-tight">
            {title}
          </h2>
          {description && (
            <p id={descId} className="mt-1 text-sm text-muted">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 -mt-1 grid size-9 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-subtle hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="px-6 py-5">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
    </>
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-none bg-transparent p-0 text-fg backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      style={{ maxWidth: size === 'lg' ? '40rem' : '28rem' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden rounded-3xl border border-line bg-elevated shadow-glass"
      >
        {onSubmit ? (
          <form
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {body}
          </form>
        ) : (
          body
        )}
      </motion.div>
    </dialog>
  );
}

const BTN = 'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-[opacity,transform,background-color] disabled:cursor-not-allowed disabled:opacity-60';

export function PrimaryButton({
  children,
  pending = false,
  disabled,
  type = 'submit',
  onClick,
  tone = 'accent',
}: {
  children: ReactNode;
  pending?: boolean;
  disabled?: boolean;
  type?: 'submit' | 'button';
  onClick?: () => void;
  tone?: 'accent' | 'danger';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      className={`${BTN} ${
        tone === 'danger' ? 'bg-expense text-white' : 'accent-gradient text-accent-fg shadow-lg shadow-accent/25'
      } hover:-translate-y-px active:translate-y-0`}
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function GhostButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${BTN} border border-line bg-surface text-fg hover:bg-subtle`}>
      {children}
    </button>
  );
}

/** Label + control + error, for dialogs. */
export function DialogField({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="pt-1.5 text-xs font-medium text-expense">
          {error}
        </p>
      ) : hint ? (
        <p className="pt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const CONTROL =
  'h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-fg outline-none transition-[border-color,box-shadow] placeholder:text-muted/70 hover:border-accent/40 focus:border-accent focus:ring-4 focus:ring-accent/15 focus-visible:outline-none disabled:opacity-60 aria-[invalid=true]:border-expense/70';
