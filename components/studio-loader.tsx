'use client';
import BrandMark from './brand-mark';
import dynamic from 'next/dynamic';
const Studio = dynamic(() => import('./studio'), {
  ssr: false,
  loading: () => <div className="loading-studio"><BrandMark /><p>Opening your studio…</p></div>,
});
export default function StudioLoader() { return <Studio />; }
