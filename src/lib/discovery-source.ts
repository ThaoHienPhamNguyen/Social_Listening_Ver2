import type { DiscoverySourceName, RawCandidate } from '../types';

export interface DiscoverySource {
  name: DiscoverySourceName;
  fetchCandidates(): Promise<RawCandidate[]>;
}
