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
];
