import type { CandidateClassifier, ClassificationLabel } from '../../src/lib/candidate-classifier';

export class FakeCandidateClassifier implements CandidateClassifier {
  public calls: string[][] = [];
  public labels: Record<string, ClassificationLabel> = {};

  async classify(keywords: string[]): Promise<Record<string, ClassificationLabel>> {
    this.calls.push(keywords);
    const result: Record<string, ClassificationLabel> = {};
    for (const keyword of keywords) {
      result[keyword] = this.labels[keyword] ?? 'none';
    }
    return result;
  }
}
