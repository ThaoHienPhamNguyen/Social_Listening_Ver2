'use client';

import { useEffect, useState } from 'react';

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
    <header className="sticky top-0 z-40 h-topbar flex items-center px-8 bg-surface border-b border-line">
      <div>
        <h1 className="text-lg font-bold text-ink" style={color ? { color } : undefined}>
          {title}
        </h1>
        <p className="text-xs text-ink-3 mt-0.5">{today}</p>
      </div>
    </header>
  );
}
