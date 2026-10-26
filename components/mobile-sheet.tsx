'use client';
import { useEffect, useRef } from 'react';

type Props = { open: boolean; compact: boolean; label: string; onClose: () => void; children: React.ReactNode };
export default function MobileSheet({ open, compact, label, onClose, children }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open && compact) closeButton.current?.focus({ preventScroll: true });
  }, [open, compact]);
  return <div className={`editor-sheet${open ? ' is-open' : ''}`} role={compact && open ? 'dialog' : undefined} aria-label={compact && open ? label : undefined} aria-modal={compact && open ? false : undefined}>
    <span className="mobile-sheet-grip" aria-hidden="true" />
    <button ref={closeButton} className="mobile-sheet-close" onClick={onClose} aria-label={`Close ${label}`}>Done</button>
    {children}
  </div>;
}
