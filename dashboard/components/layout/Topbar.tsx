'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export function Topbar({ title, color }: { title: string; color?: string }) {
  const [today, setToday] = useState('');

  // Client-only date formatting avoids an SSR/client hydration mismatch
  // (server render time vs. client render time can land on different days).
  useEffect(() => {
    setToday(
      new Date().toLocaleDateString('vi-VN', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    );
  }, []);

  return (
    <header className="sticky top-0 z-40 h-topbar flex items-center justify-between px-8 bg-surface border-b border-line">
      <div>
        <h1 className="text-xl font-bold text-ink" style={color ? { color } : undefined}>
          {title}
        </h1>
        <p className="text-xs text-ink-3 mt-0.5 min-h-[1em]">{today}</p>
      </div>
      <Link
        href="/help"
        className="w-9 h-9 rounded-full flex items-center justify-center border border-line bg-surface hover:border-brand hover:bg-muted transition-colors text-sm font-bold text-ink-2 flex-shrink-0"
        title="Hướng dẫn đọc chỉ số"
      >
        ?
      </Link>
    </header>
  );
}
