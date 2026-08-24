'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CATEGORIES } from '../../lib/categories';

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 w-sidebar flex flex-col bg-surface border-r border-line z-50">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-line">
        <div className="w-9 h-9 rounded-[10px] bg-brand flex items-center justify-center flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-bold text-ink">SL Dashboard</div>
          <div className="text-[11px] text-ink-3">Social Listening</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {/* Main */}
        <div>
          <p className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase px-3 mb-2">
            Tổng quan
          </p>
          <Link
            href="/"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors ${
              pathname === '/'
                ? 'bg-brand-faint text-brand font-semibold'
                : 'text-ink-2 hover:bg-muted hover:text-ink'
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Overview
          </Link>
        </div>

        {/* Categories */}
        <div>
          <p className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase px-3 mb-2">
            Lĩnh vực
          </p>
          <div className="space-y-0.5">
            {CATEGORIES.map((cat) => {
              const href = `/${cat.slug}`;
              const active = pathname === href;
              return (
                <Link
                  key={cat.slug}
                  href={href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors ${
                    active
                      ? 'bg-brand-faint text-brand font-semibold'
                      : 'text-ink-2 hover:bg-muted hover:text-ink'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color }} />
                  {cat.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </aside>
  );
}
