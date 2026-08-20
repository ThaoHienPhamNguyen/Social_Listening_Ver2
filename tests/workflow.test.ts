import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

describe('.github/workflows/rss-ingestion.yml', () => {
  const doc = load(readFileSync('.github/workflows/rss-ingestion.yml', 'utf8')) as any;

  it('defines both jobs', () => {
    expect(Object.keys(doc.jobs)).toEqual(['ingest-rss', 'crawl-content']);
  });

  it('gates crawl-content on ingest-rss via needs', () => {
    expect(doc['jobs']['crawl-content']['needs']).toBe('ingest-rss');
  });

  it('schedules 3 runs per day via cron', () => {
    const schedule = doc.on.schedule;
    expect(schedule).toHaveLength(1);
    expect(schedule[0].cron.split(' ')[1].split(',')).toHaveLength(3);
  });
});
