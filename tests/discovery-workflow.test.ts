import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

describe('.github/workflows/discovery-ingestion.yml', () => {
  const doc = load(readFileSync('.github/workflows/discovery-ingestion.yml', 'utf8')) as any;

  it('defines all five jobs', () => {
    expect(Object.keys(doc.jobs)).toEqual([
      'discovery-ingest',
      'deep-crawl',
      'deep-crawl-facebook',
      'rank-and-select',
      'aggregate-engagement',
    ]);
  });

  it('gates rank-and-select on all three writer jobs via needs', () => {
    expect(doc['jobs']['rank-and-select']['needs']).toEqual([
      'discovery-ingest',
      'deep-crawl',
      'deep-crawl-facebook',
    ]);
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

  it('runs deep-crawl independently of other writer jobs (no needs)', () => {
    expect(doc['jobs']['deep-crawl']['needs']).toBeUndefined();
  });

  it('deep-crawl has no conditional guard since it has no dependencies', () => {
    expect(doc['jobs']['deep-crawl']['if']).toBeUndefined();
  });

  it('passes APIFY_TOKEN through to the deep-crawl job', () => {
    const step = doc['jobs']['deep-crawl']['steps'].find((s: any) => s.run === 'npm run deep-crawl');
    expect(step?.env?.APIFY_TOKEN).toBe('${{ secrets.APIFY_TOKEN }}');
  });

  it('runs deep-crawl-facebook independently of the discovery layer (no needs)', () => {
    expect(doc['jobs']['deep-crawl-facebook']['needs']).toBeUndefined();
  });

  it('deep-crawl-facebook has no conditional guard since it has no dependencies', () => {
    expect(doc['jobs']['deep-crawl-facebook']['if']).toBeUndefined();
  });

  it('passes APIFY_TOKEN through to the deep-crawl-facebook job', () => {
    const step = doc['jobs']['deep-crawl-facebook']['steps'].find(
      (s: any) => s.run === 'npm run deep-crawl-facebook'
    );
    expect(step?.env?.APIFY_TOKEN).toBe('${{ secrets.APIFY_TOKEN }}');
  });

  it('gates aggregate-engagement on both deep-crawl jobs via needs', () => {
    expect(doc['jobs']['aggregate-engagement']['needs']).toEqual(['deep-crawl', 'deep-crawl-facebook']);
  });

  it('runs aggregate-engagement even if an earlier job failed, as long as it was not cancelled', () => {
    expect(doc['jobs']['aggregate-engagement']['if']).toBe('${{ !cancelled() }}');
  });

  it('does not require a new secret for aggregate-engagement beyond Supabase', () => {
    const step = doc['jobs']['aggregate-engagement']['steps'].find((s: any) => s.run === 'npm run aggregate-engagement');
    expect(Object.keys(step?.env ?? {})).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);
  });
});
