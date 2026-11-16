import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';

/**
 * Right-hand side panel on the native <dialog> element (focus trap, Escape, top layer).
 * Full screen on phones. Render it only while open.
 */
export function Drawer({
  title,
  description,
  onClose,
  children,
  footer,
  onSubmit,
  width = 'md',
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** When set, the drawer is a <form>; Enter in a field and Ctrl/⌘+Enter anywhere submit it. */
  onSubmit?: () => void;
  width?: 'md' | 'lg' | 'xl';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!dlg.open) dlg.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmitRef.current) {
        e.preventDefault();
        onSubmitRef.current();
      }
    };
    dlg.addEventListener('cancel', onCancel);
    dlg.addEventListener('keydown', onKey);
    document.documentElement.style.overflow = 'hidden';
    return () => {
      dlg.removeEventListener('cancel', onCancel);
      dlg.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
      if (dlg.open) dlg.close();
      opener?.focus?.();
    };
  }, []);

  const maxW = { md: '30rem', lg: '40rem', xl: '64rem' }[width];

  const inner = (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-bold tracking-tight">
            {title}
          </h2>
          {description && (
            <p id={descId} className="mt-0.5 text-sm text-muted">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 grid size-9 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-subtle hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">{footer}</footer>}
    </>
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 ml-auto h-dvh max-h-none w-full bg-transparent p-0 text-fg backdrop:bg-black/45 backdrop:backdrop-blur-[2px]"
      style={{ maxWidth: maxW }}
    >
      <motion.div
        initial={{ x: 48, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        className="flex h-full flex-col border-l border-line bg-elevated shadow-glass"
      >
        {onSubmit ? (
          <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {inner}
          </form>
        ) : (
          inner
        )}
      </motion.div>
    </dialog>
  );
}
