import { useEffect, useRef, type RefObject } from 'react';

/**
 * Cards that get the cursor spotlight and border glow (see index.css → "Cards").
 * Every rounded glass surface counts, so pages need no extra class.
 */
const CARD_SELECTOR = '.glass.rounded-3xl, .glass.rounded-2xl, .sw-card';

/** Pointer effects only make sense with a real mouse/trackpad and when motion is welcome. */
const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * Feeds the pointer position to the ambient layer and to the card under the cursor.
 * Writes straight to style (no React state), at most once per animation frame.
 */
function useAmbientPointer(glowRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const fine = window.matchMedia?.(FINE_POINTER);
    const reduced = window.matchMedia?.(REDUCED_MOTION);
    if (!fine || !reduced) return;

    let frame = 0;
    let x = 0;
    let y = 0;
    let target: Element | null = null;
    let attached = false;

    const paint = () => {
      frame = 0;
      const glow = glowRef.current;
      if (glow) {
        glow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        glow.dataset.on = 'true';
      }
      const card = target?.closest?.(CARD_SELECTOR) as HTMLElement | null | undefined;
      if (card) {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--sx', `${x - r.left}px`);
        card.style.setProperty('--sy', `${y - r.top}px`);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      x = e.clientX;
      y = e.clientY;
      target = e.target as Element | null;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onLeave = (e: PointerEvent | MouseEvent) => {
      if ('relatedTarget' in e && e.relatedTarget) return;
      if (glowRef.current) glowRef.current.dataset.on = 'false';
    };

    const attach = () => {
      if (attached) return;
      attached = true;
      window.addEventListener('pointermove', onMove, { passive: true });
      document.documentElement.addEventListener('pointerleave', onLeave);
      window.addEventListener('blur', onLeave as (e: Event) => void);
    };

    const detach = () => {
      if (!attached) return;
      attached = false;
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave as (e: Event) => void);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (glowRef.current) glowRef.current.dataset.on = 'false';
    };

    // Follow the settings live: plugging in a mouse or turning on reduced motion takes effect at once.
    const sync = () => (fine.matches && !reduced.matches ? attach() : detach());
    sync();
    fine.addEventListener?.('change', sync);
    reduced.addEventListener?.('change', sync);

    return () => {
      fine.removeEventListener?.('change', sync);
      reduced.removeEventListener?.('change', sync);
      detach();
    };
  }, [glowRef]);
}

/**
 * The ambient layer behind every screen: a slow aurora, a soft top light, a light that
 * follows the cursor (seen through the glass panels), and a fine grain that keeps the
 * gradients from banding. Purely decorative; hidden from assistive tech, print and
 * forced-colours mode, and still under reduced motion.
 */
export function Backdrop() {
  const glowRef = useRef<HTMLDivElement>(null);
  useAmbientPointer(glowRef);

  return (
    <div className="sw-backdrop" aria-hidden="true">
      <div className="sw-aurora">
        <div className="sw-aurora-band sw-aurora-a" />
        <div className="sw-aurora-band sw-aurora-b" />
        <div className="sw-aurora-band sw-aurora-c" />
      </div>
      <div className="sw-ambient" />
      <div ref={glowRef} className="sw-cursor-glow" data-on="false" />
      <div className="sw-grain" />
    </div>
  );
}
