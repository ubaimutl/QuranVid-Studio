import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#1a1d1b' };

export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'QuranVid', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  title: 'QuranVid — Your verses. Your vision.',
  description: 'Create thoughtful Quran videos. Arrange verses, customize your canvas, and edit audio with a precise timeline. Your media stays on your device.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
