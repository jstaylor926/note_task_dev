export interface FuzzyResult {
  text: string;
  score: number;
  matches: number[];
}

export function fuzzyMatch(
  query: string,
  candidate: string,
): FuzzyResult | null {
  const queryLower = query.toLowerCase();
  const candidateLower = candidate.toLowerCase();
  const matches: number[] = [];

  let qi = 0;
  for (let ci = 0; ci < candidate.length && qi < queryLower.length; ci++) {
    if (candidateLower[ci] === queryLower[qi]) {
      matches.push(ci);
      qi++;
    }
  }

  if (qi !== queryLower.length) return null;

  let score = 0;

  // Consecutive match bonus
  for (let i = 1; i < matches.length; i++) {
    if (matches[i] === matches[i - 1] + 1) {
      score += 5;
    }
  }

  // Word boundary bonus (after '/', '.', '-', '_', or start)
  for (const pos of matches) {
    if (
      pos === 0 ||
      candidate[pos - 1] === '/' ||
      candidate[pos - 1] === '.' ||
      candidate[pos - 1] === '-' ||
      candidate[pos - 1] === '_'
    ) {
      score += 3;
    }
  }

  // Early position bonus
  score += Math.max(0, 10 - matches[0]);

  // Exact match bonus
  if (candidateLower === queryLower) {
    score += 100;
  }

  // Prefix match bonus
  if (candidateLower.startsWith(queryLower)) {
    score += 50;
  }

  return { text: candidate, score, matches };
}

export function fuzzyFilter(
  query: string,
  candidates: string[],
  maxResults = 50,
): FuzzyResult[] {
  const results: FuzzyResult[] = [];
  for (const candidate of candidates) {
    const result = fuzzyMatch(query, candidate);
    if (result) {
      results.push(result);
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}
