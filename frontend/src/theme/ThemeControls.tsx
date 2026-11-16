import { AnimatePresence, motion } from 'framer-motion';
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { ACCENTS, type ThemeMode } from './theme';

/** Icon button that flips light/dark with an animated sun/moon. */
export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-surface text-fg transition-colors hover:border-accent/60 hover:bg-subtle"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={resolved}
          initial={{ y: 14, opacity: 0, rotate: -90 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -14, opacity: 0, rotate: 90 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="grid place-items-center"
        >
          {resolved === 'dark' ? <Moon className="size-[18px]" aria-hidden /> : <Sun className="size-[18px]" aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

const MODE_OPTIONS: { id: ThemeMode; label: string; icon: LucideIcon }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
];

/** Appearance (light / dark / system) and accent colour. Used in the account menu and later in Settings. */
export function ThemePicker({ idPrefix = 'theme' }: { idPrefix?: string }) {
  const { mode, setMode, accent, setAccent } = useTheme();

  return (
    <div className="space-y-3">
      <div>
        <p id={`${idPrefix}-mode-label`} className="mb-1.5 text-xs font-medium text-muted">
          Appearance
        </p>
        <div role="group" aria-labelledby={`${idPrefix}-mode-label`} className="grid grid-cols-3 gap-1 rounded-xl bg-subtle p-1">
          {MODE_OPTIONS.map(({ id, label, icon: Icon }) => {
            const active = id === mode;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => setMode(id)}
                className={`relative flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                  active ? 'text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={`${idPrefix}-mode-pill`}
                    className="absolute inset-0 rounded-lg bg-elevated shadow-sm ring-1 ring-line"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
                  />
                )}
                <Icon className="relative size-3.5" aria-hidden />
                <span className="relative">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p id={`${idPrefix}-accent-label`} className="mb-1.5 text-xs font-medium text-muted">
          Accent
        </p>
        <div role="group" aria-labelledby={`${idPrefix}-accent-label`} className="flex gap-2">
          {ACCENTS.map((a) => {
            const active = a.id === accent;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={active}
                aria-label={a.label}
                title={a.label}
                onClick={() => setAccent(a.id)}
                style={{ backgroundImage: a.swatch }}
                className={`grid size-8 place-items-center rounded-full transition-transform hover:scale-110 ${
                  active ? 'ring-2 ring-fg/70 ring-offset-2 ring-offset-elevated' : ''
                }`}
              >
                <AnimatePresence>
                  {active && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="grid place-items-center">
                      <Check className="size-4 text-white drop-shadow" strokeWidth={3} aria-hidden />
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
