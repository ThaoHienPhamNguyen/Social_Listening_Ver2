import { describe, it, expect } from 'vitest';
import { FakeCandidateClassifier } from './fakes/fake-candidate-classifier';

describe('FakeCandidateClassifier', () => {
  it('records the keywords it was called with', async () => {
    const classifier = new FakeCandidateClassifier();
    await classifier.classify(['a', 'b']);
    expect(classifier.calls).toEqual([['a', 'b']]);
  });

  it('returns the configured label for each keyword, defaulting to none', async () => {
    const classifier = new FakeCandidateClassifier();
    classifier.labels = { 'chứng khoán': 'tai_chinh' };

    const result = await classifier.classify(['chứng khoán', 'unrelated']);

    expect(result).toEqual({ 'chứng khoán': 'tai_chinh', unrelated: 'none' });
  });
});
