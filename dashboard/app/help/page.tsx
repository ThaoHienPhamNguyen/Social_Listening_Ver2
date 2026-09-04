import { Topbar } from '../../components/layout/Topbar';

function MetricItem({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink">{name}</p>
      <p className="text-sm text-ink-2 mt-1 leading-relaxed">{children}</p>
    </div>
  );
}

function GuideSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-line rounded-card shadow-card p-6">
      <h2 className="text-base font-bold text-ink">{title}</h2>
      <p className="text-xs text-ink-3 mt-0.5 mb-4">{subtitle ?? ' '}</p>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export default function HelpPage() {
  return (
    <>
      <Topbar title="Hướng dẫn đọc chỉ số" />
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <p className="text-sm text-ink-3">
          Giải thích ý nghĩa và cách tính từng chỉ số hiển thị trên dashboard, theo từng trang.
        </p>

        <GuideSection title="Tổng quan (Overview)">
          <MetricItem name="Buzz Volume">
            Tổng số bài báo + bài Threads + bài Facebook trong ngày. Đây là số lượng tin, không phải lượt
            tương tác.
          </MetricItem>
          <MetricItem name="Topics Trending">
            Số từ khóa khác nhau đang được shortlist bởi discovery layer (Google Trends/YouTube/RSS) trong
            ngày — một từ khóa được nhiều nguồn cùng shortlist chỉ tính 1 lần.
          </MetricItem>
          <MetricItem name="Audience Scale">
            Tổng lượt tương tác (like + reply/comment + repost + quote + share) cộng dồn trên các bài
            Threads và Facebook — không tính lượt xem, và không phải số người xem thực tế.
          </MetricItem>
          <MetricItem name="Sentiment Score">
            Mức độ tích cực/tiêu cực chung của các bài Threads + Facebook đã được phân loại, tính trên ngày
            gần nhất (thang -100 đến +100). Số dương nghĩa là tích cực nhiều hơn tiêu cực; số âm thì ngược
            lại. 0 là cân bằng, hoặc chưa có bài nào được phân loại thì hiện "—".
          </MetricItem>
          <MetricItem name="Buzz Trend — 7 ngày qua">
            Biểu đồ đường thể hiện Buzz Volume mỗi ngày, tách theo 3 lĩnh vực (Tài chính/Giải trí/Du lịch)
            — cùng công thức trọng số với biểu đồ Phân bổ lĩnh vực bên cạnh. Xem đầy đủ hơn ở trang
            Analytics.
          </MetricItem>
          <MetricItem name="Phân bổ lĩnh vực">
            Biểu đồ tròn cho biết trong tổng Buzz Volume hôm nay, bao nhiêu % thuộc về mỗi lĩnh vực. Một
            bài báo thuộc nhiều lĩnh vực sẽ được chia đều % cho các lĩnh vực đó.
          </MetricItem>
          <MetricItem name="Top Trending hôm nay">
            Danh sách các topic nổi bật nhất đang được shortlist, gộp chung từ cả 3 nguồn discovery (Google
            Trends/YouTube/RSS) vào 1 bảng xếp hạng duy nhất theo Trending Score — xem đầy đủ ở trang
            Trending Now (link "Xem tất cả →").
          </MetricItem>
        </GuideSection>

        <GuideSection title="Trending Now">
          <MetricItem name="Trending Score">
            So sánh mức độ quan tâm hiện tại của từ khóa với baseline gần đây (do discovery layer tính
            riêng cho từng nguồn), nhân 100. Từ khóa mới chưa có đủ dữ liệu để so sánh sẽ hiện "Mới" thay
            vì một con số vô nghĩa.
          </MetricItem>
          <MetricItem name="Bảng xếp hạng">
            Gộp tất cả từ khóa đang shortlist từ mọi nguồn/lĩnh vực vào 1 bảng duy nhất, xếp theo Trending
            Score giảm dần — có thể lọc theo lĩnh vực bằng các tab phía trên bảng.
          </MetricItem>
          <MetricItem name="Sentiment badge">
            Chỉ số sentiment (thang -100..+100) của từ khóa đó trên Threads, tính trên ngày gần nhất — chỉ
            hiện khi đã có bài được phân loại.
          </MetricItem>
        </GuideSection>

        <GuideSection title="Analytics">
          <MetricItem name="Buzz Trend — theo lĩnh vực">
            Biểu đồ đường Buzz Volume mỗi ngày trong 7 ngày qua, tách theo lĩnh vực — bản đầy đủ của chart
            cùng tên ở trang Overview.
          </MetricItem>
          <MetricItem name="Top Gainers / Top Losers">
            So sánh tổng lượt tương tác Threads theo từ khóa giữa 7 ngày gần nhất và 7 ngày trước đó, xếp
            theo % thay đổi. Chỉ tính engagement Threads (Facebook/bài báo không gắn theo từ khóa nên không
            đưa vào so sánh này). Nếu trong kỳ không có từ khóa nào thực sự giảm, bảng "Losers" tự đổi tên
            thành "Tăng trưởng chậm nhất" và hiển thị 5 từ khóa tăng ít nhất — tránh gán nhãn "giảm" sai
            cho những từ khóa vẫn đang tăng. Tương tự, nếu không có từ khóa nào thực sự tăng, "Gainers" đổi
            thành "Tăng trưởng nhanh nhất".
          </MetricItem>
        </GuideSection>

        <GuideSection title="Trang lĩnh vực (Tài chính / Giải trí / Du lịch)">
          <MetricItem name="Chủ đề đang trending">
            Bảng xếp hạng topic theo Trending Score, giống cách tính ở Overview/Trending Now nhưng chỉ tính
            từ khóa thuộc lĩnh vực này — có 2 tab Trending/Mới nhất để xem theo mức độ nổi bật hoặc theo
            thời điểm được phát hiện gần nhất.
          </MetricItem>
          <MetricItem name="Facebook">
            Số bài + tổng lượt tương tác từ các page Facebook thuộc lĩnh vực này trong ngày, kèm tỷ lệ %
            sentiment Tích cực/Trung lập/Tiêu cực của ngày gần nhất.
          </MetricItem>
          <MetricItem name="Bài báo gần đây">
            Các bài báo mới nhất thuộc lĩnh vực này, từ các nguồn RSS đã kết nối.
          </MetricItem>
        </GuideSection>

        <GuideSection title="Trang chi tiết từ khóa (Topic Detail)">
          <MetricItem name="Trending Score — 7 ngày qua">
            Trending Score của riêng từ khóa này theo từng ngày trong 7 ngày qua — giúp thấy rõ đà tăng/hạ
            nhiệt theo thời gian, thay vì chỉ 1 con số hiện tại.
          </MetricItem>
          <MetricItem name="Engagement Threads — 7 ngày qua">
            Tổng lượt tương tác Threads của từ khóa này theo từng ngày. Ngày nào không có bài Threads nào
            được ghi nhận sẽ để trống trên biểu đồ (không vẽ thành 0), để không nhầm lẫn "không có dữ liệu"
            với "có dữ liệu nhưng bằng 0".
          </MetricItem>
          <MetricItem name="Sentiment Threads — 7 ngày qua">
            Chỉ số sentiment (-100..+100) của từ khóa này theo từng ngày, tính trên các bài Threads đã phân
            loại trong ngày đó.
          </MetricItem>
          <MetricItem name="Lưu ý về phạm vi dữ liệu">
            Trang này chỉ hiển thị số liệu tổng hợp theo ngày (không có danh sách bài viết gốc), và chỉ
            tính engagement/sentiment từ Threads — vì Facebook và bài báo không được gắn theo từng từ khóa
            riêng trong hệ thống này.
          </MetricItem>
        </GuideSection>

        <GuideSection
          title="Sentiment được phân tích như thế nào?"
          subtitle="Cách hệ thống quyết định 1 bài đăng là Tích cực, Trung lập hay Tiêu cực"
        >
          <MetricItem name="1 bước — AI đọc trực tiếp nội dung">
            Với mỗi bài Threads/Facebook mới thu thập, hệ thống gửi nội dung bài (đã rút gọn) cho một mô
            hình AI, yêu cầu phân loại thẳng vào 1 trong 3 nhãn: Tích cực, Trung lập, hoặc Tiêu cực — không
            qua bước lọc từ khóa trung gian nào.
          </MetricItem>
          <MetricItem name="Khi phân loại thất bại">
            Nếu lần gọi AI cho một nhóm bài bị lỗi, các bài đó tạm thời chưa có sentiment (không hiện badge
            sentiment) và sẽ được thử phân loại lại ở lần chạy kế tiếp — hệ thống không dùng phương án dự
            phòng nào khác thay AI.
          </MetricItem>
        </GuideSection>
      </main>
    </>
  );
}
