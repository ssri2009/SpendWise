import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useOutlet } from 'react-router';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { Backdrop } from '../components/ambient/Backdrop';
import { findNavItem } from '../lib/nav';
import { PAGE_TRANSITION } from '../lib/motion';

const COLLAPSE_KEY = 'spendwise-ui:sidebar-collapsed';
const DESKTOP_QUERY = '(min-width: 1024px)';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppLayout() {
  const location = useLocation();
  // useOutlet (not <Outlet/>) so the leaving page keeps rendering during its exit animation.
  const outlet = useOutlet();

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // New page: close the drawer and start at the top.
  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  // The drawer is mobile-only; close it if the window grows to desktop size.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e: MediaQueryListEvent) => e.matches && setMobileOpen(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // No background scrolling behind the open drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  return (
    <div className="flex min-h-dvh text-fg">
      <Backdrop />

      <a
        href="#main"
        className="sr-only z-[60] rounded-lg bg-elevated px-4 py-2 text-sm font-medium shadow-glass focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenNav={openMobile} />

        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              // One key per screen, so /budget/2026-10 → /budget/2026-11 updates in place instead of remounting.
              key={findNavItem(location.pathname)?.path ?? location.pathname}
              variants={PAGE_TRANSITION}
              initial="enter"
              animate="show"
              exit="leave"
              className="mx-auto w-full max-w-7xl"
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
