/**
 * NegEx-inspired clause segmentation and negation scope detector (Chapman et al., 2001).
 * Splits compound and unpunctuated sentences at polarity boundaries so exclusions apply
 * strictly to their own clause rather than poisoning positive preferences.
 */

const NEGATION_PATTERNS: readonly RegExp[] = [
  /\b(?:don't|dont|do not|didn't|didnt)\s+want\b/i,
  /\b(?:anything|everything)\s+(?:but|except)\b/i,
  /\bexcept\b/i,
  /\binstead\s+of\b/i,
  /\bother\s+than\b/i,
  /\brather\s+than\b/i,
  /\bno\b/i,
  /(?<!\bwhy\s)\bnot\b/i,
  /\bskip\b/i,
  /\bhate\b/i,
  /\b(?:tired|sick)\s+of\b/i,
  /\bhad\b.*\byesterday\b/i,
  /\bveto\b/i,
  /\bnever\b/i,
  /\b(?:can't|cant)\s+do\b/i,
];

const SUBJECT_PREFIX_ONLY =
  /^(?:(?:please|i|we|they|honestly|actually|literally|just|well|umm*|uh+)\b\s*)+$/i;

function splitInlineNegation(clause: string): string[] {
  const regex = /\s+(?=(?:just\s+)?(?:no|not|skip|veto|(?:don't|dont|do not)\s+want)\b)/i;
  const match = regex.exec(clause);
  if (match === null || match.index === undefined) {
    return [clause];
  }
  const left = clause.slice(0, match.index).trim();
  const right = clause.slice(match.index).trim();
  if (left.length === 0 || SUBJECT_PREFIX_ONLY.test(left)) {
    return [clause];
  }
  return [left, ...splitInlineNegation(right)];
}
function pushTrimmed(target: string[], parts: readonly string[]): void {
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      target.push(trimmed);
    }
  }
}

/**
 * Segments a chat message into polarity-coherent clauses across:
 * 1. Sentence/list punctuation (, ; . ! ? \n)
 * 2. Contrastive conjunctions ("but", "though", "however", "except", "instead of")
 * 3. Unpunctuated inline negation or proposal pivots ("ramen sounds good no sushi",
 *    "no burger maybe pho") while keeping subject prefixes ("I don't want burger") intact
 */
export function segmentClauses(text: string): string[] {
  const punctuated = text
    .split(/[,;.!?\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const contrastSplit: string[] = [];
  for (const segment of punctuated) {
    const transitionParts = segment
      .split(/(?<!\banything|\beverything)\s+(?:but|though|however)\s+/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    for (const part of transitionParts) {
      const exceptionParts = part
        .split(/\s+(?=(?:except(?:\s+for)?|instead\s+of|other\s+than|rather\s+than)\b)/i)
        .map((sub) => sub.trim())
        .filter((sub) => sub.length > 0);
      contrastSplit.push(...exceptionParts);
    }
  }

  const finalClauses: string[] = [];
  for (const clause of contrastSplit) {
    const inlineNegParts = splitInlineNegation(clause);

    for (const piece of inlineNegParts) {
      const trimmedPiece = piece.trim();
      if (trimmedPiece.length === 0) {
        continue;
      }

      // If this piece is negated, split before an unpunctuated positive pivot ("no burger maybe pho")
      if (isNegatedClause(trimmedPiece)) {
        const pivotParts = trimmedPiece.split(
          /\s+(?=(?:maybe|how about|what about|or maybe|i want|let'?s do|down for|craving|feel like)\b)/i,
        );
        pushTrimmed(finalClauses, pivotParts);
      } else {
        finalClauses.push(trimmedPiece);
      }
    }
  }

  return finalClauses;
}

export function isNegatedClause(clause: string): boolean {
  return NEGATION_PATTERNS.some((pattern) => pattern.test(clause));
}
