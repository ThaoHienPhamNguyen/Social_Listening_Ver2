import { createServerSupabaseClient } from '../../lib/supabase';
import { SupabaseCandidateTopicsReader } from '../../lib/candidate-topics-reader';
import { SupabaseArticlesReader } from '../../lib/articles-reader';
import { SupabaseThreadsEngagementReader } from '../../lib/threads-engagement-reader';
import { SupabaseFacebookEngagementReader } from '../../lib/facebook-engagement-reader';
import { SupabaseThreadsSentimentReader } from '../../lib/threads-sentiment-reader';
import { SupabaseFacebookSentimentReader } from '../../lib/facebook-sentiment-reader';
import { getBuzzTrend } from '../../lib/get-buzz-trend';
import { getTopicMovers } from '../../lib/get-topic-movers';
import { getOverviewMetrics, type OverviewMetricsResult } from '../../lib/get-overview-metrics';
import { computeSentimentTrend, type SentimentTrendPoint } from '../../lib/sentiment-trend';
import type { BuzzTrendPoint } from '../../lib/buzz-trend';
import type { TopicMover } from '../../lib/topic-movers';
import { BuzzTrendChart } from '../../components/BuzzTrendChart';
import { SentimentTrendChart } from '../../components/SentimentTrendChart';
import { ShareOfVoiceBars } from '../../components/ShareOfVoiceBars';
import { KpiCard } from '../../components/KpiCard';
import { TopicMoversSection } from '../../components/TopicMoversSection';
import { Topbar } from '../../components/layout/Topbar';
import { MetricTooltip } from '../../components/MetricTooltip';
import { METRIC_TOOLTIPS } from '../../lib/metric-tooltips';

export const dynamic = 'force-dynamic';

function addDaysUTC(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadLatestDate(): Promise<string | null> {
  try {
    const client = createServerSupabaseClient();
    return await new SupabaseCandidateTopicsReader(client).getLatestDate();
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadBuzzTrend(date: string): Promise<BuzzTrendPoint[] | null> {
  try {
    const client = createServerSupabaseClient();
    return await getBuzzTrend(
      new SupabaseArticlesReader(client),
      new SupabaseThreadsEngagementReader(client),
      new SupabaseFacebookEngagementReader(client),
      date
    );
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadTopicMovers(
  date: string
): Promise<{ gainers: TopicMover[]; losers: TopicMover[]; hasRealGainers: boolean; hasRealLosers: boolean } | null> {
  try {
    const client = createServerSupabaseClient();
    return await getTopicMovers(new SupabaseThreadsEngagementReader(client), date);
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadOverviewMetrics(date: string): Promise<OverviewMetricsResult | null> {
  try {
    const client = createServerSupabaseClient();
    return await getOverviewMetrics(
      new SupabaseCandidateTopicsReader(client),
      new SupabaseArticlesReader(client),
      new SupabaseThreadsEngagementReader(client),
      new SupabaseFacebookEngagementReader(client),
      new SupabaseThreadsSentimentReader(client),
      new SupabaseFacebookSentimentReader(client),
      date
    );
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function loadSentimentTrend(date: string): Promise<SentimentTrendPoint[] | null> {
  try {
    const client = createServerSupabaseClient();
    const startDate = addDaysUTC(date, -6);
    const endDateExclusive = addDaysUTC(date, 1);
    const [threadsSentiment, facebookSentiment] = await Promise.all([
      new SupabaseThreadsSentimentReader(client).getForDateRange(startDate, endDateExclusive),
      new SupabaseFacebookSentimentReader(client).getForDateRange(startDate, endDateExclusive),
    ]);
    const dates = Array.from({ length: 7 }, (_, i) => addDaysUTC(startDate, i));
    return computeSentimentTrend(threadsSentiment, facebookSentiment, dates);
  } catch (err) {
    console.error(err);
    return null;
  }
}

export default async function AnalyticsPage() {
  const latestDate = await loadLatestDate();

  const [buzzTrend, topicMovers, overviewMetrics, sentimentTrend] = latestDate
    ? await Promise.all([
        loadBuzzTrend(latestDate),
        loadTopicMovers(latestDate),
        loadOverviewMetrics(latestDate),
        loadSentimentTrend(latestDate),
      ])
    : [null, null, null, null];

  return (
    <>
      <Topbar title="Phân tích" />
      <main className="max-w-4xl mx-auto p-6">
        {latestDate === null ? (
          <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
        ) : (
          <>
            <p className="text-xs text-ink-3 mb-4">Dữ liệu tính đến {latestDate}</p>
            {overviewMetrics && (
              <div className="grid gap-4 md:grid-cols-3 mb-8">
                <KpiCard
                  label="Tổng Buzz Volume"
                  value={overviewMetrics.metrics.buzzVolume.toLocaleString('vi-VN')}
                  tooltip={METRIC_TOOLTIPS.buzzVolume}
                  delta={overviewMetrics.deltas.buzzVolume.text}
                  deltaPositive={overviewMetrics.deltas.buzzVolume.positive}
                />
                <KpiCard
                  label="Sentiment Index"
                  value={overviewMetrics.metrics.sentimentScore === null ? '—' : `${overviewMetrics.metrics.sentimentScore}`}
                  tooltip={METRIC_TOOLTIPS.sentimentScore}
                />
                <div className="bg-surface border border-line rounded-card shadow-card p-6">
                  <div className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase mb-3">
                    Share of Voice
                    <MetricTooltip text={METRIC_TOOLTIPS.shareOfVoice} />
                  </div>
                  <ShareOfVoiceBars data={overviewMetrics.donut} />
                </div>
              </div>
            )}
            <div className="grid gap-6 lg:grid-cols-2 mb-8">
              <section className="bg-surface border border-line rounded-card shadow-card p-6">
                <h2 className="text-base font-bold text-ink mb-1">
                  Buzz Trend — theo lĩnh vực
                  <MetricTooltip text={METRIC_TOOLTIPS.buzzTrend} />
                </h2>
                <p className="text-xs text-ink-3 mb-4">7 ngày qua</p>
                {buzzTrend ? (
                  <BuzzTrendChart data={buzzTrend} />
                ) : (
                  <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
                )}
              </section>
              <section className="bg-surface border border-line rounded-card shadow-card p-6">
                <h2 className="text-base font-bold text-ink mb-1">
                  Xu hướng Sentiment
                  <MetricTooltip text={METRIC_TOOLTIPS.sentimentTrend} />
                </h2>
                <p className="text-xs text-ink-3 mb-4">7 ngày qua</p>
                {sentimentTrend ? (
                  <SentimentTrendChart data={sentimentTrend} />
                ) : (
                  <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
                )}
              </section>
            </div>
            {topicMovers ? (
              <TopicMoversSection
                gainers={topicMovers.gainers}
                losers={topicMovers.losers}
                hasRealGainers={topicMovers.hasRealGainers}
                hasRealLosers={topicMovers.hasRealLosers}
              />
            ) : (
              <p className="text-sm text-ink-3">Chưa có dữ liệu.</p>
            )}
          </>
        )}
      </main>
    </>
  );
}
