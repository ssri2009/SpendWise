import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  applyTheme,
  readPrefs,
  resolveMode,
  STORAGE_KEY,
  subscribeSystemTheme,
  systemTheme,
  writePrefs,
  type Accent,
  type ResolvedTheme,
  type ThemeMode,
  type ThemePrefs,
} from './theme';

interface ThemeContextValue {
  /** What the user picked: light, dark or follow the system. */
  mode: ThemeMode;
  /** What is actually showing right now. */
  resolved: ResolvedTheme;
  accent: Accent;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: Accent) => void;
  /** Flip between light and dark (leaves "system"). */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<ThemePrefs>(readPrefs);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const resolved = resolveMode(prefs.mode, system);
  const firstApply = useRef(true);

  // Follow the OS setting while mode is "system".
  useEffect(() => subscribeSystemTheme(setSystem), []);

  // Keep several open tabs in step.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPrefs(readPrefs());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => writePrefs(prefs), [prefs]);

  // Layout effect so the DOM changes before paint.
  useLayoutEffect(() => {
    applyTheme(resolved, prefs.accent, { animate: !firstApply.current });
    firstApply.current = false;
  }, [resolved, prefs.accent]);

  const setMode = useCallback((mode: ThemeMode) => setPrefs((p) => ({ ...p, mode })), []);
  const setAccent = useCallback((accent: Accent) => setPrefs((p) => ({ ...p, accent })), []);
  const toggle = useCallback(
    () => setPrefs((p) => ({ ...p, mode: resolveMode(p.mode, system) === 'dark' ? 'light' : 'dark' })),
    [system],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ mode: prefs.mode, resolved, accent: prefs.accent, setMode, setAccent, toggle }),
    [prefs.mode, prefs.accent, resolved, setMode, setAccent, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
