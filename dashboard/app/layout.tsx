import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '../components/layout/Sidebar';

export const metadata: Metadata = {
  title: 'Social Listening Dashboard',
  description: 'Topic đang hot và bài báo gần đây theo tài chính, giải trí, du lịch',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <Sidebar />
        <div className="pl-sidebar">{children}</div>
      </body>
    </html>
  );
}
