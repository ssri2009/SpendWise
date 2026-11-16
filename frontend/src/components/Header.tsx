import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Loader2, LogIn, LogOut, Menu, RotateCw, Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useLogout } from '../auth/session';
import { ApiError, useHealth, useMe } from '../lib/api';
import { findNavItem } from '../lib/nav';
import { ThemePicker, ThemeToggle } from '../theme/ThemeControls';

export function Header({ onOpenNav }: { onOpenNav: () => void }) {
  const { pathname } = useLocation();
  const item = findNavItem(pathname);
  const title = item?.label ?? 'SpendWise';

  useEffect(() => {
    document.title = item ? `${item.label} · SpendWise` : 'SpendWise';
  }, [item]);

  return (
    <header className="glass sticky top-0 z-20 border-b border-line">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-10">
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open menu"
          className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-fg transition-colors hover:bg-subtle lg:hidden"
        >
          <Menu className="size-5" aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <h1 className="truncate text-lg font-bold leading-tight sm:text-xl">{title}</h1>
              {item && <p className="hidden truncate text-xs text-muted sm:block">{item.description}</p>}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ApiStatus />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */

const STATUS = {
  pending: { label: 'Connecting', dot: 'bg-warning' },
  success: { label: 'Online', dot: 'bg-income' },
  error: { label: 'Offline', dot: 'bg-expense' },
} as const;

function ApiStatus() {
  const { status } = useHealth();
  const s = STATUS[status];

  return (
    <div
      role="status"
      title={status === 'error' ? 'The SpendWise server is not responding' : `Server: ${s.label}`}
      className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted md:flex"
    >
      <span className="relative flex size-2">
        {status === 'success' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-income opacity-60" />}
        <span className={`relative inline-flex size-2 rounded-full ${s.dot}`} />
      </span>
      {s.label}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function initials(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full accent-gradient font-semibold text-accent-fg ${
        large ? 'size-10 text-sm' : 'size-8 text-xs'
      }`}
    >
      {initials(name)}
    </span>
  );
}

const MENU_ITEM =
  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors hover:bg-subtle disabled:opacity-60';

function UserMenu() {
  const me = useMe();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (me.isPending) {
    return <span className="sw-skeleton size-10 rounded-full" aria-label="Loading account" role="status" />;
  }

  if (me.isError) {
    const signedOut = me.error instanceof ApiError && me.error.status === 401;
    return signedOut ? (
      <Link
        to="/login"
        className="flex h-10 items-center gap-2 rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/25"
      >
        <LogIn className="size-4" aria-hidden />
        <span className="hidden sm:inline">Sign in</span>
      </Link>
    ) : (
      <button
        type="button"
        onClick={() => me.refetch()}
        title={me.error.message}
        className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-muted transition-colors hover:text-fg"
      >
        <RotateCw className={`size-4 ${me.isFetching ? 'animate-spin' : ''}`} aria-hidden />
        <span className="hidden sm:inline">Retry</span>
      </button>
    );
  }

  const user = me.data;
  const name = user.displayName?.trim() || user.email;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        aria-label={`Account menu for ${name}`}
        className="flex h-10 items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2 transition-colors hover:border-accent/60 sm:pr-3"
      >
        <Avatar name={name} />
        <span className="hidden max-w-[10rem] truncate text-sm font-medium md:block">{name}</span>
        <ChevronDown className={`size-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label="Account"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            style={{ transformOrigin: 'top right' }}
            className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-72 rounded-2xl border border-line bg-elevated p-2 shadow-glass"
          >
            <div className="flex items-center gap-3 px-2 py-2">
              <Avatar name={name} large />
              <div className="min-w-0">
                <p className="truncate font-semibold">{name}</p>
                <p className="truncate text-xs text-muted">{user.email}</p>
              </div>
              <span className="ml-auto shrink-0 rounded-md bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {user.currency}
              </span>
            </div>

            <div className="my-2 h-px bg-line" />
            <div className="px-2 py-1">
              <ThemePicker idPrefix="account-theme" />
            </div>
            <div className="my-2 h-px bg-line" />

            <Link to="/settings" onClick={() => setOpen(false)} className={`${MENU_ITEM} text-fg`}>
              <Settings className="size-4 text-muted" aria-hidden />
              Settings
            </Link>
            <button
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              aria-busy={logout.isPending || undefined}
              className={`${MENU_ITEM} text-expense`}
            >
              {logout.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <LogOut className="size-4" aria-hidden />
              )}
              {logout.isPending ? 'Signing out…' : logout.isError ? 'Sign out failed. Try again' : 'Sign out'}
            </button>
            {logout.isError && (
              <p role="alert" className="px-3 pb-1 pt-0.5 text-xs text-muted">
                {logout.error.message} You are still signed in.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
