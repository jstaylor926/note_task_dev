import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyFilter } from '../fuzzyMatch';

describe('fuzzyMatch', () => {
  it('returns null for no match', () => {
    expect(fuzzyMatch('xyz', 'hello')).toBeNull();
  });

  it('matches exact strings with highest score', () => {
    const result = fuzzyMatch('main.rs', 'main.rs');
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(100);
  });

  it('matches prefix with high score', () => {
    const result = fuzzyMatch('main', 'main.rs');
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(50);
  });

  it('is case insensitive', () => {
    const result = fuzzyMatch('MAIN', 'main.rs');
    expect(result).not.toBeNull();
    expect(result!.matches).toEqual([0, 1, 2, 3]);
  });

  it('returns match indices', () => {
    const result = fuzzyMatch('mr', 'main.rs');
    expect(result).not.toBeNull();
    expect(result!.matches).toEqual([0, 5]);
  });

  it('scores consecutive matches higher than spread', () => {
    const consecutive = fuzzyMatch('ab', 'abc');
    const spread = fuzzyMatch('ab', 'aXb');
    expect(consecutive).not.toBeNull();
    expect(spread).not.toBeNull();
    expect(consecutive!.score).toBeGreaterThan(spread!.score);
  });

  it('scores word boundary matches higher', () => {
    const boundary = fuzzyMatch('ft', 'file_tree');
    expect(boundary).not.toBeNull();
    // 'f' at pos 0 (start), 't' at pos 5 (after '_')
    expect(boundary!.matches).toEqual([0, 5]);
  });

  it('handles single character queries', () => {
    const result = fuzzyMatch('a', 'abc');
    expect(result).not.toBeNull();
    expect(result!.matches).toEqual([0]);
  });

  it('returns null when query is longer than candidate', () => {
    expect(fuzzyMatch('abcdef', 'abc')).toBeNull();
  });
});

describe('fuzzyFilter', () => {
  it('filters and sorts by score descending', () => {
    const candidates = ['src/main.rs', 'src/lib.rs', 'package.json', 'src/main.ts'];
    const results = fuzzyFilter('main', candidates);

    expect(results.length).toBe(2);
    expect(results[0].text).toContain('main');
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it('returns empty array for no matches', () => {
    const results = fuzzyFilter('xyz', ['abc', 'def']);
    expect(results).toEqual([]);
  });

  it('caps results at maxResults', () => {
    const candidates = Array.from({ length: 100 }, (_, i) => `file${i}.ts`);
    const results = fuzzyFilter('file', candidates, 5);
    expect(results.length).toBe(5);
  });

  it('returns all candidates when query is empty string after trim', () => {
    // Empty query is handled by FileFinder, not fuzzyFilter, so this tests empty behavior
    const results = fuzzyFilter('', ['a.ts', 'b.ts']);
    // Empty string matches everything (every char is "found")
    expect(results.length).toBe(2);
  });
});
