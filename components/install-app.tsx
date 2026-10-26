'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
export default function InstallApp({ menuOpen, closeMenu }: { menuOpen: boolean; closeMenu: () => void }) {
  const prompt = useRef<InstallPrompt | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const mode = matchMedia('(display-mode: standalone)');
    const update = () => setStandalone(mode.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const available = (event: Event) => { event.preventDefault(); prompt.current = event as InstallPrompt; };
    const installed = () => { prompt.current = null; setStandalone(true); setInstructions(false); };
    update(); mode.addEventListener('change', update);
    window.addEventListener('beforeinstallprompt', available); window.addEventListener('appinstalled', installed);
    return () => { mode.removeEventListener('change', update); window.removeEventListener('beforeinstallprompt', available); window.removeEventListener('appinstalled', installed); };
  }, []);
  useEffect(() => { setSlot(menuOpen ? document.getElementById('install-menu-slot') : null); }, [menuOpen]);
  useEffect(() => {
    if (!instructions) return;
    close.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); setInstructions(false); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [instructions]);
  const install = async () => {
    closeMenu();
    const event = prompt.current;
    if (!event) { setInstructions(true); return; }
    prompt.current = null;
    try { await event.prompt(); await event.userChoice; } catch { setInstructions(true); }
  };
  return <>
    {slot && !standalone && createPortal(<button onClick={() => void install()}><Download size={15} />Install QuranVid</button>, slot)}
    {instructions && <div className="modal-backdrop" onClick={() => setInstructions(false)}><section className="modal install-instructions" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={event => event.stopPropagation()}><div className="modal-heading"><h2 id="install-title">Install QuranVid</h2><button ref={close} className="icon-btn" aria-label="Close install instructions" onClick={() => setInstructions(false)}><X size={19} /></button></div><p>Keep the editor on your home screen and open it in its own window.</p><ol><li>On iPhone or iPad, open this site in Safari. Tap Share, then Add to Home Screen.</li><li>On Android or desktop, open your browser menu and choose Install app or Add to Home screen, if available.</li></ol><p className="field-note">An internet connection is required to load the editor and online media. Your saved projects and imported files stay in this browser. Keep a project backup before clearing site data.</p></section></div>}
  </>;
}
