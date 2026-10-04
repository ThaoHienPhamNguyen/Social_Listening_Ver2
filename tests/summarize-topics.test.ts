import { describe, it, expect } from 'vitest';
import { summarizeTopics } from '../src/summarize-topics';
import { FakeCandidateTopicRepository } from './fakes/fake-candidate-topic-repository';
import { FakeTopicArticleDataRepository } from './fakes/fake-topic-article-data-repository';
import { FakeTopicSocialDataRepository } from './fakes/fake-topic-social-data-repository';
import { FakeTopicSummarizer } from './fakes/fake-topic-summarizer';
import type { CandidateTopicRepository } from '../src/lib/candidate-topic-repository';
import type { CandidateTopic } from '../src/types';

const TODAY = '2026-10-04';

function candidate(overrides: Partial<CandidateTopic> = {}): CandidateTopic {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: 'rss',
    keyword: 'vàng',
    date: TODAY,
    metric_value: 1,
    growth_rate: null,
    category_hint: [],
    is_shortlisted: true,
    ...overrides,
  };
}

function makeDeps() {
  return {
    candidateRepo: new FakeCandidateTopicRepository(),
    articleLinkRepo: new FakeTopicArticleDataRepository(),
    socialRepo: new FakeTopicSocialDataRepository(),
    summarizer: new FakeTopicSummarizer(),
    now: () => new Date(`${TODAY}T10:00:00Z`),
  };
}

describe('summarizeTopics', () => {
  it('summarizes an RSS topic using its linked article text', async () => {
    const deps = makeDeps();
    deps.candidateRepo.candidates.push(candidate({ id: '1', source: 'rss', keyword: 'vàng' }));
    deps.articleLinkRepo.links.push({
      keyword: 'vàng',
      source: 'rss',
      date: TODAY,
      article_url: 'https://a.com/1',
      article_title: 'Giá vàng tăng mạnh',
      article_snippet: 'Vàng SJC tăng 2 triệu đồng/lượng.',
    });
    deps.summarizer.summaryByKeyword['vàng'] = 'Giá vàng SJC tăng mạnh trong ngày.';

    const result = await summarizeTopics(deps);

    expect(result).toEqual({ evaluated: 1, summarized: 1, errors: [] });
    expect(deps.candidateRepo.candidates[0].summary).toBe('Giá vàng SJC tăng mạnh trong ngày.');
    expect(deps.summarizer.calls[0]).toEqual([
      { keyword: 'vàng', texts: ['Giá vàng tăng mạnh. Vàng SJC tăng 2 triệu đồng/lượng.'] },
    ]);
  });

  it('summarizes a Threads topic using its linked post text', async () => {
    const deps = makeDeps();
    deps.candidateRepo.candidates.push(candidate({ id: '1', source: 'threads', keyword: 'ngân hàng' }));
    deps.socialRepo.posts.push({
      id: 'p1',
      keyword: 'ngân hàng',
      source: 'threads',
      date: TODAY,
      post_url: 'https://threads.net/p/1',
      text_content: 'Ngân hàng X vừa tăng lãi suất tiết kiệm.',
      like_count: null,
      reply_count: null,
      repost_count: null,
      quote_count: null,
      share_count: null,
      view_count: null,
      posted_at: null,
    });
    deps.summarizer.summaryByKeyword['ngân hàng'] = 'Một ngân hàng tăng lãi suất tiết kiệm.';

    const result = await summarizeTopics(deps);

    expect(result.summarized).toBe(1);
    expect(deps.candidateRepo.candidates[0].summary).toBe('Một ngân hàng tăng lãi suất tiết kiệm.');
  });

  it('never summarizes a google_trends or youtube candidate', async () => {
    const deps = makeDeps();
    deps.candidateRepo.candidates.push(
      candidate({ id: '1', source: 'google_trends', keyword: 'bitcoin' }),
      candidate({ id: '2', source: 'youtube', keyword: 'minecraft' })
    );

    const result = await summarizeTopics(deps);

    expect(result).toEqual({ evaluated: 0, summarized: 0, errors: [] });
    expect(deps.summarizer.calls).toEqual([]);
  });

  it('skips a shortlisted rss/threads topic with no linked source text, without calling the summarizer for it', async () => {
    const deps = makeDeps();
    deps.candidateRepo.candidates.push(
      candidate({ id: '1', source: 'rss', keyword: 'no-text-topic' }),
      candidate({ id: '2', source: 'rss', keyword: 'has-text-topic' })
    );
    deps.articleLinkRepo.links.push({
      keyword: 'has-text-topic',
      source: 'rss',
      date: TODAY,
      article_url: 'https://a.com/1',
      article_title: 'Bài có nội dung',
      article_snippet: '',
    });
    deps.summarizer.summaryByKeyword['has-text-topic'] = 'Tóm tắt.';

    const result = await summarizeTopics(deps);

    expect(result.evaluated).toBe(2);
    expect(result.summarized).toBe(1);
    const calledKeywords = deps.summarizer.calls.flat().map((i) => i.keyword);
    expect(calledKeywords).toEqual(['has-text-topic']);
    expect(deps.candidateRepo.candidates.find((c) => c.keyword === 'no-text-topic')?.summary).toBeUndefined();
  });

  it('does not block other chunks when one chunk throws', async () => {
    const deps = makeDeps();
    // CHUNK_SIZE is 10 — 11 summarizable topics split across 2 chunks.
    for (let i = 0; i < 11; i++) {
      deps.candidateRepo.candidates.push(candidate({ id: `c${i}`, source: 'rss', keyword: `topic-${i}` }));
      deps.articleLinkRepo.links.push({
        keyword: `topic-${i}`,
        source: 'rss',
        date: TODAY,
        article_url: `https://a.com/${i}`,
        article_title: `Bài ${i}`,
        article_snippet: '',
      });
      deps.summarizer.summaryByKeyword[`topic-${i}`] = `Tóm tắt ${i}.`;
    }
    let callCount = 0;
    const originalSummarize = deps.summarizer.summarizeTopics.bind(deps.summarizer);
    deps.summarizer.summarizeTopics = async (inputs) => {
      callCount += 1;
      if (callCount === 1) throw new Error('first chunk failed');
      return originalSummarize(inputs);
    };

    const result = await summarizeTopics(deps);

    expect(callCount).toBe(2);
    expect(result.summarized).toBe(1); // only the second chunk's 1 topic succeeded
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('summarization failed for a chunk');
  });

  it('records an error but keeps other topics unaffected when updateSummary fails for one row', async () => {
    const deps = makeDeps();
    deps.candidateRepo.candidates.push(
      candidate({ id: '1', source: 'rss', keyword: 'a' }),
      candidate({ id: '2', source: 'rss', keyword: 'b' })
    );
    deps.articleLinkRepo.links.push(
      { keyword: 'a', source: 'rss', date: TODAY, article_url: 'https://a.com/1', article_title: 'A', article_snippet: '' },
      { keyword: 'b', source: 'rss', date: TODAY, article_url: 'https://a.com/2', article_title: 'B', article_snippet: '' }
    );
    deps.summarizer.summaryByKeyword['a'] = 'Tóm tắt A.';
    deps.summarizer.summaryByKeyword['b'] = 'Tóm tắt B.';
    const originalUpdateSummary = deps.candidateRepo.updateSummary.bind(deps.candidateRepo);
    // FakeCandidateTopicRepository.updateSummary has no explicit return-type
    // annotation and always returns `{ error: null }`, so TS infers that
    // narrow literal type for the property. Our replacement needs to return
    // `{ error: string }` in one branch, so we assign through the
    // CandidateTopicRepository interface type (which declares the true
    // `{ error: string | null }` shape) rather than the fake's inferred type.
    (deps.candidateRepo as CandidateTopicRepository).updateSummary = async (id: string, summary: string) => {
      if (id === '1') return { error: 'simulated db failure' };
      return originalUpdateSummary(id, summary);
    };

    const result = await summarizeTopics(deps);

    expect(result.summarized).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(deps.candidateRepo.candidates.find((c) => c.id === '2')?.summary).toBe('Tóm tắt B.');
  });

  it('returns an empty result when nothing is shortlisted today, without calling the summarizer', async () => {
    const deps = makeDeps();
    const result = await summarizeTopics(deps);
    expect(result).toEqual({ evaluated: 0, summarized: 0, errors: [] });
    expect(deps.summarizer.calls).toEqual([]);
  });
});
