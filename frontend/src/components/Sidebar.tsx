import { AnimatePresence, motion } from 'framer-motion';
import { ChevronsLeft, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { NAV_SECTIONS, SETTINGS_ITEM, type NavItem } from '../lib/nav';

const WIDTH_EXPANDED = 264;
const WIDTH_COLLAPSED = 80;

type Variant = 'desktop' | 'mobile';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onCloseMobile]);

  return (
    <>
      {/* Desktop: sticky, collapsible */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="sticky top-0 z-30 hidden h-dvh shrink-0 overflow-hidden lg:block"
        aria-label="Main navigation"
      >
        <div className="glass h-full border-r border-line">
          <SidebarBody variant="desktop" collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
        </div>
      </motion.aside>

      {/* Mobile: slide-in drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="mobile-nav"
            className="fixed inset-0 z-50 lg:hidden"
            initial="closed"
            animate="open"
            exit="closed"
          >
            <motion.div
              variants={{ open: { opacity: 1 }, closed: { opacity: 0 } }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={onCloseMobile}
              aria-hidden="true"
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Main navigation"
              variants={{ open: { x: 0 }, closed: { x: '-100%' } }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              className="absolute inset-y-0 left-0 w-[min(84vw,300px)] border-r border-line bg-bg-2 shadow-glass"
            >
              <SidebarBody variant="mobile" collapsed={false} onNavigate={onCloseMobile} onClose={onCloseMobile} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ------------------------------------------------------------------ */

interface SidebarBodyProps {
  variant: Variant;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
  onClose?: () => void;
}

function SidebarBody({ variant, collapsed, onToggleCollapsed, onNavigate, onClose }: SidebarBodyProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Put keyboard focus inside the drawer when it opens.
  useEffect(() => {
    if (variant === 'mobile') closeRef.current?.focus();
  }, [variant]);

  return (
    <div className="flex h-full flex-col">
      <div className={`flex h-16 shrink-0 items-center gap-3 ${collapsed ? 'justify-center' : 'px-5'}`}>
        <Brand collapsed={collapsed} onNavigate={onNavigate} />
        {variant === 'mobile' && (
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg"
          >
            <X className="size-5" aria-hidden />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4">
        {NAV_SECTIONS.map((section, i) => (
          <div key={section.title} className={i === 0 ? 'mt-1' : 'mt-5'}>
            {collapsed ? (
              i > 0 && <div className="mx-auto mb-3 h-px w-8 bg-line" aria-hidden />
            ) : (
              <p className="mb-1.5 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted/80">
                {section.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.path}>
                  <SidebarLink item={item} collapsed={collapsed} variant={variant} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-0.5 border-t border-line p-3">
        <SidebarLink item={SETTINGS_ITEM} collapsed={collapsed} variant={variant} onNavigate={onNavigate} />
        {variant === 'desktop' && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : undefined}
            className={`${LINK_BASE} w-full text-muted hover:bg-subtle hover:text-fg ${collapsed ? 'justify-center px-0' : ''}`}
          >
            <motion.span
              animate={{ rotate: collapsed ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              className="grid shrink-0 place-items-center"
            >
              <ChevronsLeft className="size-[18px]" aria-hidden />
            </motion.span>
            <Label hidden={collapsed}>Collapse</Label>
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const LINK_BASE =
  'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent';

function SidebarLink({
  item,
  collapsed,
  variant,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  variant: Variant;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `${LINK_BASE} ${collapsed ? 'justify-center px-0' : ''} ${
          isActive ? 'text-fg' : 'text-muted hover:bg-subtle hover:text-fg'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId={`sidebar-active-${variant}`}
              className="absolute inset-0 rounded-xl bg-accent/12 ring-1 ring-accent/25"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            />
          )}
          {isActive && !collapsed && (
            <motion.span
              layoutId={`sidebar-bar-${variant}`}
              className="absolute bottom-2.5 left-0 top-2.5 w-1 rounded-r-full accent-gradient"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            />
          )}
          <Icon
            className={`relative size-[18px] shrink-0 transition-colors ${isActive ? 'text-accent' : ''}`}
            aria-hidden
          />
          <Label hidden={collapsed}>{item.label}</Label>
        </>
      )}
    </NavLink>
  );
}

function Label({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  if (hidden) return null;
  return (
    <motion.span
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.08, duration: 0.18 }}
      className="relative truncate whitespace-nowrap"
    >
      {children}
    </motion.span>
  );
}

function Brand({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <Link
      to="/dashboard"
      onClick={onNavigate}
      aria-label="SpendWise home"
      className="flex items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <motion.span
        whileHover={{ rotate: -8, scale: 1.05 }}
        className="grid size-9 shrink-0 place-items-center rounded-xl accent-gradient text-base font-bold text-accent-fg shadow-lg shadow-accent/30"
      >
        ₹
      </motion.span>
      {!collapsed && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.08 }}
          className="whitespace-nowrap text-lg font-extrabold tracking-tight"
        >
          Spend<span className="gradient-text">Wise</span>
        </motion.span>
      )}
    </Link>
  );
}
