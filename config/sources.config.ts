import type { RssSource } from '../src/types';

export const sources: RssSource[] = [
  { id: 'vnexpress-tai-chinh', name: 'VnExpress - Kinh doanh', url: 'https://vnexpress.net/rss/kinh-doanh.rss', defaultCategory: 'tai_chinh' },
  { id: 'vnexpress-giai-tri', name: 'VnExpress - Giải trí', url: 'https://vnexpress.net/rss/giai-tri.rss', defaultCategory: 'giai_tri' },
  { id: 'vnexpress-du-lich', name: 'VnExpress - Du lịch', url: 'https://vnexpress.net/rss/du-lich.rss', defaultCategory: 'du_lich' },

  { id: 'dantri-tai-chinh', name: 'Dân Trí - Kinh doanh', url: 'https://dantri.com.vn/rss/kinh-doanh.rss', defaultCategory: 'tai_chinh' },
  { id: 'dantri-giai-tri', name: 'Dân Trí - Giải trí', url: 'https://dantri.com.vn/rss/giai-tri.rss', defaultCategory: 'giai_tri' },
  { id: 'dantri-du-lich', name: 'Dân Trí - Du lịch', url: 'https://dantri.com.vn/rss/du-lich.rss', defaultCategory: 'du_lich' },

  { id: 'thanhnien-tai-chinh', name: 'Thanh Niên - Kinh tế', url: 'https://thanhnien.vn/rss/kinh-te.rss', defaultCategory: 'tai_chinh' },
  { id: 'thanhnien-giai-tri', name: 'Thanh Niên - Giải trí', url: 'https://thanhnien.vn/rss/giai-tri.rss', defaultCategory: 'giai_tri' },
  { id: 'thanhnien-du-lich', name: 'Thanh Niên - Du lịch', url: 'https://thanhnien.vn/rss/du-lich.rss', defaultCategory: 'du_lich' },

  { id: 'tuoitre-tai-chinh', name: 'Tuổi Trẻ - Kinh doanh', url: 'https://tuoitre.vn/rss/kinh-doanh.rss', defaultCategory: 'tai_chinh' },
  { id: 'tuoitre-giai-tri', name: 'Tuổi Trẻ - Giải trí', url: 'https://tuoitre.vn/rss/giai-tri.rss', defaultCategory: 'giai_tri' },
  { id: 'tuoitre-du-lich', name: 'Tuổi Trẻ - Du lịch', url: 'https://tuoitre.vn/rss/du-lich.rss', defaultCategory: 'du_lich' },

  { id: 'vietnamnet-tai-chinh', name: 'VietNamNet - Kinh doanh', url: 'https://vietnamnet.vn/rss/kinh-doanh.rss', defaultCategory: 'tai_chinh' },
  { id: 'vietnamnet-giai-tri', name: 'VietNamNet - Giải trí', url: 'https://vietnamnet.vn/rss/giai-tri.rss', defaultCategory: 'giai_tri' },
  { id: 'vietnamnet-du-lich', name: 'VietNamNet - Du lịch', url: 'https://vietnamnet.vn/rss/du-lich.rss', defaultCategory: 'du_lich' },

  // "giai_tri" feed for Nhân Dân / VietnamPlus / VOV is their "Văn hóa" (Culture)
  // section — these are serious/political outlets with no dedicated showbiz
  // section; content skews exhibitions/heritage/performances rather than the
  // celebrity-news tone of the other giai_tri sources above.
  { id: 'nhandan-tai-chinh', name: 'Nhân Dân - Tài chính, Chứng khoán', url: 'https://nhandan.vn/rss/chungkhoan-1191.rss', defaultCategory: 'tai_chinh' },
  { id: 'nhandan-giai-tri', name: 'Nhân Dân - Văn hóa', url: 'https://nhandan.vn/rss/vanhoa-1251.rss', defaultCategory: 'giai_tri' },
  { id: 'nhandan-du-lich', name: 'Nhân Dân - Du lịch', url: 'https://nhandan.vn/rss/du-lich-1257.rss', defaultCategory: 'du_lich' },

  { id: 'vietnamplus-tai-chinh', name: 'VietnamPlus - Tài chính', url: 'https://www.vietnamplus.vn/rss/kinhte/taichinh-343.rss', defaultCategory: 'tai_chinh' },
  { id: 'vietnamplus-giai-tri', name: 'VietnamPlus - Văn hóa', url: 'https://www.vietnamplus.vn/rss/vanhoa-215.rss', defaultCategory: 'giai_tri' },
  { id: 'vietnamplus-du-lich', name: 'VietnamPlus - Du lịch', url: 'https://www.vietnamplus.vn/rss/dulich-237.rss', defaultCategory: 'du_lich' },

  { id: 'vov-tai-chinh', name: 'VOV - Kinh tế', url: 'https://vov.vn/rss/kinh-te.rss', defaultCategory: 'tai_chinh' },
  { id: 'vov-giai-tri', name: 'VOV - Văn hóa', url: 'https://vov.vn/rss/van-hoa.rss', defaultCategory: 'giai_tri' },
  { id: 'vov-du-lich', name: 'VOV - Du lịch', url: 'https://vov.vn/rss/du-lich.rss', defaultCategory: 'du_lich' },

  // Finance-only publishers — no giai_tri/du_lich section exists on these sites.
  { id: 'cafef-tai-chinh', name: 'CafeF - Tài chính, Ngân hàng', url: 'https://cafef.vn/tai-chinh-ngan-hang.rss', defaultCategory: 'tai_chinh' },
  { id: 'vneconomy-tai-chinh', name: 'VnEconomy - Tài chính', url: 'https://vneconomy.vn/tai-chinh.rss', defaultCategory: 'tai_chinh' },
];
