# Dashboard Visual Redesign — Design Spec

**Ngày:** 2026-08-24
**Trạng thái:** Design approved, chưa implement.

## Bối cảnh

Trong lúc brainstorm sub-project 3 phần 2 (hiển thị sentiment + engagement metrics lên dashboard — xem [design spec sub-project 3 phần 1](./2026-08-23-sentiment-engagement-metrics-design.md) cho phần data layer), phát hiện có một phiên bản trước của dự án này tại `C:\Users\user\Social Listening` (không có hậu tố "ver 2") — gọi tắt **ver1** trong tài liệu này. Ver1 có một dashboard Next.js đầy đủ hơn nhiều (Prisma thay vì Supabase, nhiều trang: Overview/Trending/Analytics/Topic detail/Help), với design system riêng và các chart component đã hoàn thiện (`KpiCard`, `DonutChart`, `SentimentBreakdown`, `TrendingList`, v.v.), màu category trùng khớp 100% với ver2 hiện tại (`#16a34a`/`#af006e`/`#3b82f6`) — xác nhận ver2 đã kế thừa palette từ ver1 dù code bị mất trong lần reset 2026-08-20 (xem [[project_social_listening_overview]]).

Quyết định: **tách redesign giao diện thành sub-project riêng**, làm **trước** sub-project 3 phần 2, để tránh giao diện chắp vá (nửa dùng token mới, nửa dùng Tailwind rời rạc cũ). Sub-project 3 phần 2 sẽ build tiếp trên nền token này sau khi redesign xong.

## Mục tiêu

Port design system + layout shell của ver1 (Sidebar/Topbar, màu sắc, typography, spacing, border-radius, shadow) vào `dashboard/` của ver2, restyle 2 section hiện có (`HotTopicsSection`, `ArticlesSection`) theo ngôn ngữ thị giác mới. **Không thêm dữ liệu mới, không thêm tính năng mới** — thuần túy visual.

## Ngoài phạm vi (out of scope — quyết định rõ ràng, không mơ hồ)

- **Dark mode** — tokens hỗ trợ sẵn về mặt kỹ thuật (`[data-theme="dark"]` override) nhưng **không wire up toggle**, không port block dark-mode CSS trong bước này. Chỉ port `:root` (light) tokens.
- **Topbar chức năng**: dark mode toggle, nút "Làm mới", date-range picker ("7 ngày gần nhất"), link `/help` — **đều bỏ**, không có logic thật đứng sau ở ver2. Topbar chỉ còn: tiêu đề trang + ngày hiện tại.
- **Sidebar nav "Trending Now"/"Analytics"** — bỏ, 2 trang này chưa tồn tại ở ver2. Sidebar chỉ có: Overview + 3 lĩnh vực.
- **`KpiCard`, `DonutChart`, `SentimentBreakdown`, `BuzzChart`, `LineChart`, `SectorLineChart`, `SentimentLineChart`, `PlatformBars`, `CategoryColumn`, `SimpleBarChart`** — không port ở bước này. Đây là phần dành cho sub-project 3 phần 2 (đã brainstorm sơ bộ: Sentiment Index formula `-100..+100`, Audience Scale = like+comment+share, bar breakdown kiểu `SentimentBreakdown`) — quay lại sau khi redesign này xong.
- **`MetricTooltip`, `PeriodToggle`** — tiện ích nhỏ, chưa cần.
- **`design-system/tokens.css` (509 dòng)** — đây là tài liệu tham khảo, **ver1 không thực sự import file này vào app**. Token thật chạy trong `app/globals.css` (`:root`, ~24 biến màu) + `tailwind.config.ts` (border-radius/shadow/spacing/height/width, phần lớn hardcode giá trị, không qua CSS var). Ta port đúng phần đang thực sự chạy, không port nguyên file tài liệu.

## Kiến trúc

### 1. Token porting: Tailwind v3 (ver1) → v4 (ver2)

Ver1 dùng Tailwind v3 (`tailwind.config.ts` kiểu JS `theme.extend`). Ver2 dùng Tailwind v4 (cấu hình qua CSS `@theme`, không dùng config file JS theo cách cũ — `postcss.config.mjs` hiện chỉ có `@import "tailwindcss";`). Không copy-paste được nguyên file config — phải dịch sang cú pháp `@theme`.

`dashboard/app/globals.css` sẽ có 2 phần:

**Phần A — CSS custom properties thô** (copy gần như nguyên vẹn từ `:root` block của ver1's `globals.css`, chỉ lấy phần light mode):
```css
:root {
  --color-brand-primary:       #af006e;
  --color-brand-primary-hover: #930059;
  --color-brand-primary-light: #fce7f3;
  --color-brand-primary-faint: #fdf2f8;
  --color-bg-base:   #ffffff;
  --color-bg-subtle: #fafafa;
  --color-bg-muted:  #f5f5f5;
  --color-surface-1: #ffffff;
  --color-surface-2: #fafafa;
  --color-border-light: #e8e8e8;
  --color-border-base:  #d0d0d0;
  --color-text-primary:   #111111;
  --color-text-secondary: #5e5e5e;
  --color-text-muted:     #888888;
  --color-text-disabled:  #b0b0b0;
  --color-text-inverse:   #ffffff;
}
```

**Phần B — Tailwind v4 `@theme` mapping** (dịch từ `tailwind.config.ts`'s `theme.extend`, chỉ giữ những token thực sự dùng ở Sidebar/Topbar/HotTopicsSection/ArticlesSection — bỏ những màu category riêng lẻ vì `dashboard/lib/categories.ts` đã có cơ chế màu riêng qua `CategoryDef.color`, không cần trùng lặp trong Tailwind theme):
```css
@theme {
  --font-family-sans: 'Be Vietnam Pro', Inter, system-ui, sans-serif;

  --color-brand: var(--color-brand-primary);
  --color-brand-hover: var(--color-brand-primary-hover);
  --color-brand-faint: var(--color-brand-primary-faint);
  --color-canvas: var(--color-bg-base);
  --color-subtle: var(--color-bg-subtle);
  --color-muted: var(--color-bg-muted);
  --color-surface: var(--color-surface-1);
  --color-line: var(--color-border-light);
  --color-ink: var(--color-text-primary);
  --color-ink-2: var(--color-text-secondary);
  --color-ink-3: var(--color-text-muted);

  --radius-card: 16px;
  --radius-btn: 9999px;

  --shadow-card: 0 1px 3px 0 rgba(0,0,0,.08), 0 1px 2px -1px rgba(0,0,0,.06);
  --shadow-card-hover: 0 4px 6px -1px rgba(0,0,0,.08), 0 2px 4px -2px rgba(0,0,0,.06);

  --spacing-sidebar: 232px;
  --spacing-topbar: 64px;
}
```
(Danh sách trên là điểm khởi đầu — task viết code thực tế có thể cần thêm 1-2 token nếu component cần, nhưng KHÔNG thêm màu category/chart-specific token nào chưa dùng đến, giữ đúng nguyên tắc YAGNI.)

Font: giữ nguyên cách ver1 làm — `@import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap');` ở đầu `globals.css`, không dùng `next/font`.

### 2. Layout shell mới

**`dashboard/components/layout/Sidebar.tsx`** (mới) — adapt từ ver1's `Sidebar.tsx`, cắt bớt:
- Logo + tên "SL Dashboard"
- Nav "Tổng quan": chỉ mục **Overview** (`/`)
- Nav "Lĩnh vực": 3 mục từ `CATEGORIES` (`dashboard/lib/categories.ts`) — dùng `slug`/`label`/`color` đã có sẵn, không hardcode lại danh sách category như ver1 làm (ver1 hardcode mảng `categories` riêng trong `Sidebar.tsx` — ver2 tránh trùng lặp nguồn sự thật, import từ `lib/categories.ts`)
- Active state theo `usePathname()` (cần `"use client"` — đúng như ver1)

**`dashboard/components/layout/Topbar.tsx`** (mới) — adapt tối giản từ ver1's `Topbar.tsx`:
- Tiêu đề trang (truyền qua prop `title: string`, vì mỗi trang có tiêu đề khác nhau — Overview vs từng lĩnh vực)
- Ngày hiện tại (client-side `toLocaleDateString('vi-VN', ...)`, giữ đúng cách ver1 làm để tránh SSR/client hydration mismatch — ver1 dùng `useEffect` + `useState` đúng vì lý do này, giữ nguyên pattern)
- **Không** có: live indicator, date-range button, refresh button, dark-mode toggle, help link

**`dashboard/app/layout.tsx`** (sửa) — bọc `<Sidebar />` cố định bên trái + nội dung trang dịch sang phải `pl-sidebar` (dùng token `--spacing-sidebar` mới), `<Topbar>` đặt trong từng page (vì cần `title` khác nhau per-page) hoặc qua slot — quyết định cụ thể: **mỗi page (`app/page.tsx`, `app/[slug]/page.tsx`) tự render `<Topbar title="..." />`** ngay đầu `<main>`, giữ đúng convention hiện tại là mỗi page tự quản lý toàn bộ nội dung của nó (không dùng React Server Component slot/parallel routes phức tạp cho một dashboard 4 trang).

**`dashboard/components/CategoryNav.tsx`** — **xóa**, Sidebar đã thay thế vai trò điều hướng category.

### 3. Restyle section hiện có

**`HotTopicsSection.tsx`** — giữ nguyên toàn bộ logic/props (`date`, `bySource: Record<source, HotTopicRow[]>`), chỉ đổi styling mỗi row theo pattern `TrendingList.tsx` của ver1: số thứ hạng bên trái (`text-ink-3`, không cần màu vàng/bạc/đồng đặc biệt như ver1 vì đây không phải bảng xếp hạng thi đấu), tên keyword + `trendingScore`/`shareOfVoice` bên phải, `hover:bg-muted rounded-[10px]` cho mỗi row, card bọc ngoài dùng `bg-surface border-line rounded-card shadow-card p-6`. `trendingScore`/`shareOfVoice` **giữ nguyên màu xám trung tính** (`text-ink-3`) như hiện tại — không đổi sang xanh/đỏ theo dấu tăng giảm (đó là polish riêng, chưa bàn tới trong redesign này, nên không thêm token `success`/`danger` mới cho việc này).

**`ArticlesSection.tsx`** — bọc trong card cùng style (`bg-surface border-line rounded-card shadow-card`), giữ nguyên logic/props hiện có.

### 4. Data flow

Không đổi — 0 query mới, 0 field mới. Đây là lý do sub-project này an toàn để làm trước: không chạm Supabase, không chạm migration, không chạm bất kỳ job GitHub Actions nào.

### 5. Error handling

Không có logic mới cần xử lý lỗi — các hàm `loadHotTopics`/`loadArticles` và cơ chế try/catch → `{error}` hiện tại giữ nguyên y hệt, chỉ đổi phần JSX render bọc ngoài.

### 6. Testing

Dự án này chỉ unit-test pure logic (`tests/*.test.ts` hiện có test `categories.ts`, `get-hot-topics.ts`, `hot-topics.ts`, `supabase.ts` — không có `@testing-library/react` trong `devDependencies`, không test JSX component nào). Redesign này thuần visual, không thêm pure-logic function mới → **không cần test mới**, khớp quy ước sẵn có của dự án. Verify bằng cách chạy `npm run dev` xem trực tiếp (skill `run` nếu cần) thay vì automated test.

## Nguồn tham khảo

Toàn bộ component/token gốc: `C:\Users\user\Social Listening\{app/globals.css, tailwind.config.ts, components/layout/Sidebar.tsx, components/layout/Topbar.tsx, components/dashboard/TrendingList.tsx}`. Đây là **tham khảo một chiều** — ver1 không phải dependency, không được import trực tiếp, mọi file port đều copy thủ công + chỉnh sửa rồi commit vào `dashboard/` của ver2.

## Liên hệ với sub-project 3 phần 2

Sau khi redesign này merge, quay lại thiết kế sub-project 3 phần 2 (sentiment + engagement hiển thị) đã brainstorm sơ bộ trong phiên trước:
- 4 reader mới (`threads-engagement-reader.ts`, `threads-sentiment-reader.ts`, `facebook-engagement-reader.ts`, `facebook-sentiment-reader.ts`)
- Pure logic: `groupSentimentCounts`, `attachEngagement`, `buildFacebookSummary`, `computeSentimentIndex` (công thức adapt từ ver1's `lib/sentiment-index.ts`: `round((positive-negative)/total*100)`, thang -100..+100)
- UI: badge "Sentiment ±N" trên mỗi hot topic row (có data Threads), card tóm tắt Facebook ở đầu trang lĩnh vực dùng bar breakdown 3 màu (kiểu `SentimentBreakdown.tsx`, giờ build trên token/`@theme` mới thay vì CSS thuần)

Phần trên **chưa viết thành spec riêng** — sẽ quay lại brainstorm/viết spec sau khi redesign này xong.
