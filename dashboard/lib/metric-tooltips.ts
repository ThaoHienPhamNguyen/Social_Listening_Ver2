// Nội dung tooltip cho từng chỉ số trên dashboard — đúng công thức thực tế
// của ver2 (không copy nguyên văn từ ver1, vì nhiều công thức khác nhau
// giữa 2 bản: Buzz Volume/Trending Score/Audience Scale/Gainers-Losers đều
// tính khác ver1). Nội dung dài hơn nằm ở trang /help — tooltip chỉ là bản
// tóm tắt 1-2 câu.
export const METRIC_TOOLTIPS = {
  buzzVolume: 'Tổng số bài báo + bài Threads + bài Facebook trong ngày.',
  topicsTrending: 'Số từ khóa khác nhau đang được shortlist bởi discovery layer trong ngày.',
  audienceScale:
    'Tổng lượt tương tác (like + reply + repost + quote + share) của các bài Threads và Facebook — không tính lượt xem.',
  sentimentScore:
    'Mức độ tích cực/tiêu cực chung của các bài Threads + Facebook đã phân loại, thang -100 đến +100.',
  sectorShare: '% Buzz Volume thuộc về mỗi lĩnh vực (bài đa lĩnh vực được chia đều cho các lĩnh vực đó).',
  topTrending: 'Xếp hạng theo Trending Score — mức tăng trưởng so với baseline gần đây của discovery layer.',
  trendingScore:
    'So sánh mức độ quan tâm hiện tại với baseline gần đây, nhân 100. Từ khóa mới chưa có baseline sẽ hiện "Mới".',
  buzzTrend: 'Buzz mỗi ngày theo từng lĩnh vực trong 7 ngày qua, cùng công thức trọng số với biểu đồ Phân bổ lĩnh vực.',
  gainersLosers: 'So sánh engagement Threads theo từ khóa giữa 7 ngày gần nhất và 7 ngày trước đó, xếp theo % thay đổi.',
  topicDetailTrendingScore: 'Trending Score của từ khóa này theo từng ngày trong 7 ngày qua.',
  topicDetailEngagement: 'Tổng lượt tương tác Threads của từ khóa này theo từng ngày.',
  topicDetailSentiment: 'Chỉ số sentiment (-100..+100) của từ khóa này theo từng ngày, tính trên các bài Threads đã phân loại.',
} as const;
