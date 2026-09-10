import type { FacebookEngagementReader } from './facebook-engagement-reader';
import { buildFacebookSummary, type FacebookSummary } from './facebook-summary';

export async function getFacebookSummary(
  category: string,
  engagementReader: FacebookEngagementReader,
  date: string
): Promise<FacebookSummary | null> {
  const engagementRows = await engagementReader.getForDate(date);
  return buildFacebookSummary(category, engagementRows);
}
