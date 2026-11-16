/**
 * Theme core: types, persistence and the DOM side.
 * No React here, so main.tsx can apply the saved theme before the first render.
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export type Accent = 'violet' | 'ocean' | 'emerald' | 'rose';

export interface ThemePrefs {
  mode: ThemeMode;
  accent: Accent;
}

export const STORAGE_KEY = 'spendwise-ui:theme';

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

export const ACCENTS: readonly { id: Accent; label: string; swatch: string }[] = [
  { id: 'violet', label: 'Violet', swatch: 'linear-gradient(135deg, #7c5cff, #00d4ff)' },
  { id: 'ocean', label: 'Ocean', swatch: 'linear-gradient(135deg, #0ea5e9, #22d3ee)' },
  { id: 'emerald', label: 'Emerald', swatch: 'linear-gradient(135deg, #10b981, #a3e635)' },
  { id: 'rose', label: 'Rose', swatch: 'linear-gradient(135deg, #f43f5e, #fb923c)' },
];

export const DEFAULT_PREFS: ThemePrefs = { mode: 'system', accent: 'violet' };

const META_THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#0b0f1f', light: '#eef1ff' };
const DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const isMode = (v: unknown): v is ThemeMode => THEME_MODES.includes(v as ThemeMode);
const isAccent = (v: unknown): v is Accent => ACCENTS.some((a) => a.id === v);

/** Saved preferences, or the defaults if nothing valid is stored. */
export function readPrefs(): ThemePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFS;
    const { mode, accent } = parsed as Record<string, unknown>;
    return {
      mode: isMode(mode) ? mode : DEFAULT_PREFS.mode,
      accent: isAccent(accent) ? accent : DEFAULT_PREFS.accent,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(prefs: ThemePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked or full: the choice still applies for this visit.
  }
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function resolveMode(mode: ThemeMode, system: ResolvedTheme = systemTheme()): ResolvedTheme {
  return mode === 'system' ? system : mode;
}

/** Calls back when the OS switches between light and dark. Returns an unsubscribe function. */
export function subscribeSystemTheme(callback: (theme: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  const onChange = (e: MediaQueryListEvent) => callback(e.matches ? 'dark' : 'light');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

let transitionTimer: number | undefined;

/** Writes the theme onto <html>: .dark class, data-theme, data-accent, color-scheme and the browser bar colour. */
export function applyTheme(theme: ResolvedTheme, accent: Accent, options: { animate?: boolean } = {}): void {
  const root = document.documentElement;

  if (options.animate && !window.matchMedia?.(REDUCED_MOTION_QUERY).matches) {
    root.classList.add('theme-transition');
    window.clearTimeout(transitionTimer);
    transitionTimer = window.setTimeout(() => root.classList.remove('theme-transition'), 350);
  }

  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
  root.dataset.accent = accent;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_THEME_COLOR[theme]);
}
