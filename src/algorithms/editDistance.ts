/**
 * Optimal String Alignment (restricted Damerau-Levenshtein) edit distance.
 * Counts single-character insertions, deletions, substitutions, and adjacent
 * character transpositions as distance 1.
 */
export function damerauLevenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) {
    return n;
  }
  if (n === 0) {
    return m;
  }

  const width = n + 1;
  const dp = new Int32Array((m + 1) * width);

  const get = (row: number, col: number): number => dp[row * width + col] ?? 0;
  const set = (row: number, col: number, value: number): void => {
    dp[row * width + col] = value;
  };

  for (let i = 0; i <= m; i += 1) {
    set(i, 0, i);
  }
  for (let j = 0; j <= n; j += 1) {
    set(0, j, j);
  }

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let best = Math.min(get(i - 1, j) + 1, get(i, j - 1) + 1, get(i - 1, j - 1) + cost);

      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        best = Math.min(best, get(i - 2, j - 2) + 1);
      }
      set(i, j, best);
    }
  }

  return get(m, n);
}

/**
 * O(min(|a|, |b|)) fast path checking whether two lowercase strings have
 * restricted Damerau-Levenshtein distance <= 1 without allocating a matrix.
 */
export function damerauLevenshteinAtMostOne(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > 1) {
    return false;
  }

  let i = 0;
  let j = 0;
  while (i < lenA && j < lenB && a.charCodeAt(i) === b.charCodeAt(j)) {
    i += 1;
    j += 1;
  }

  // Equal lengths: allow one substitution or one adjacent transposition
  if (lenA === lenB) {
    if (
      i + 1 < lenA &&
      a.charCodeAt(i) === b.charCodeAt(i + 1) &&
      a.charCodeAt(i + 1) === b.charCodeAt(i)
    ) {
      return a.slice(i + 2) === b.slice(j + 2);
    }
    return a.slice(i + 1) === b.slice(j + 1);
  }

  // Length differs by 1: allow one insertion or deletion
  if (lenA > lenB) {
    return a.slice(i + 1) === b.slice(j);
  }
  return a.slice(i) === b.slice(j + 1);
}
