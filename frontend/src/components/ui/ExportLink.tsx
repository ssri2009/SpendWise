import { useState, type ReactNode } from 'react';
import { downloadFile } from '../../lib/download';
import { useToast } from './Toast';

/** A download button for an API file. Looks and sits exactly like the old <a download> it replaces. */
export function ExportLink({
  href,
  fallbackName,
  className,
  children,
}: {
  href: string;
  fallbackName: string;
  className: string;
  children: ReactNode;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const name = await downloadFile(href, fallbackName);
      toast.success(`Downloaded ${name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={run} aria-busy={busy} className={`${className} ${busy ? 'opacity-70' : ''}`}>
      {children}
    </button>
  );
}
