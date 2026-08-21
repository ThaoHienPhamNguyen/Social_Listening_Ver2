import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Social Listening Dashboard',
  description: 'Topic đang hot và bài báo gần đây theo tài chính, giải trí, du lịch',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="bg-white text-gray-900">{children}</body>
    </html>
  );
}
