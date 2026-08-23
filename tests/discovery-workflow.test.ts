import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

describe('.github/workflows/discovery-ingestion.yml', () => {
  const doc = load(readFileSync('.github/workflows/discovery-ingestion.yml', 'utf8')) as any;

  it('defines all three jobs', () => {
    expect(Object.keys(doc.jobs)).toEqual(['discovery-ingest', 'rank-and-select', 'deep-crawl']);
  });

  it('gates rank-and-select on discovery-ingest via needs', () => {
    expect(doc['jobs']['rank-and-select']['needs']).toBe('discovery-ingest');
  });

  it('schedules 3 runs per day via cron, same cadence as RSS ingestion', () => {
    const schedule = doc.on.schedule;
    expect(schedule).toHaveLength(1);
    expect(schedule[0].cron.split(' ')[1].split(',')).toHaveLength(3);
  });

  it('passes OPENAI_API_KEY through to the discovery-ingest job for LLM category classification', () => {
    const step = doc['jobs']['discovery-ingest']['steps'].find((s: any) => s.run === 'npm run discover');
    expect(step?.env?.OPENAI_API_KEY).toBe('${{ secrets.OPENAI_API_KEY }}');
  });

  it('gates deep-crawl on both discovery-ingest and rank-and-select via needs', () => {
    expect(doc['jobs']['deep-crawl']['needs']).toEqual(['discovery-ingest', 'rank-and-select']);
  });

  it('runs deep-crawl even if an earlier job failed, as long as it was not cancelled', () => {
    expect(doc['jobs']['deep-crawl']['if']).toBe('${{ !cancelled() }}');
  });

  it('passes APIFY_TOKEN through to the deep-crawl job', () => {
    const step = doc['jobs']['deep-crawl']['steps'].find((s: any) => s.run === 'npm run deep-crawl');
    expect(step?.env?.APIFY_TOKEN).toBe('${{ secrets.APIFY_TOKEN }}');
  });
});
