import type { FuzzyCorrection, PickMode } from "../shared/types.js";
import { damerauLevenshteinAtMostOne } from "./editDistance.js";

export interface LexiconEntry {
  pattern: string;
  canonical: string;
}

export const FOOD_LEXICON: readonly LexiconEntry[] = [
  { pattern: "fried chicken", canonical: "Fried Chicken" },
  { pattern: "french fries", canonical: "Fries" },
  { pattern: "korean bbq", canonical: "KBBQ" },
  { pattern: "bubble teas", canonical: "Bubble Tea" },
  { pattern: "bubble tea", canonical: "Bubble Tea" },
  { pattern: "rice bowls", canonical: "Rice Bowls" },
  { pattern: "rice bowl", canonical: "Rice Bowls" },
  { pattern: "sandwiches", canonical: "Sandwiches" },
  { pattern: "vietnamese", canonical: "Vietnamese" },
  { pattern: "spaghetti", canonical: "Spaghetti" },
  { pattern: "ice cream", canonical: "Ice Cream" },
  { pattern: "dumplings", canonical: "Dumplings" },
  { pattern: "desserts", canonical: "Desserts" },
  { pattern: "sandwich", canonical: "Sandwiches" },
  { pattern: "dumpling", canonical: "Dumplings" },
  { pattern: "pad thai", canonical: "Pad Thai" },
  { pattern: "banh mi", canonical: "Banh Mi" },
  { pattern: "dessert", canonical: "Desserts" },
  { pattern: "shawarma", canonical: "Shawarma" },
  { pattern: "japanese", canonical: "Japanese" },
  { pattern: "burritos", canonical: "Burritos" },
  { pattern: "barbeque", canonical: "BBQ" },
  { pattern: "barbecue", canonical: "BBQ" },
  { pattern: "burrito", canonical: "Burritos" },
  { pattern: "dim sum", canonical: "Dim Sum" },
  { pattern: "hot pot", canonical: "Hotpot" },
  { pattern: "pierogi", canonical: "Pierogi" },
  { pattern: "seafood", canonical: "Seafood" },
  { pattern: "mexican", canonical: "Mexican" },
  { pattern: "italian", canonical: "Italian" },
  { pattern: "chinese", canonical: "Chinese" },
  { pattern: "burgers", canonical: "Burgers" },
  { pattern: "noodles", canonical: "Noodles" },
  { pattern: "falafel", canonical: "Falafel" },
  { pattern: "burger", canonical: "Burgers" },
  { pattern: "hotpot", canonical: "Hotpot" },
  { pattern: "indian", canonical: "Indian" },
  { pattern: "korean", canonical: "Korean" },
  { pattern: "brunch", canonical: "Brunch" },
  { pattern: "coffee", canonical: "Coffee" },
  { pattern: "noodle", canonical: "Noodles" },
  { pattern: "ramen", canonical: "Ramen" },
  { pattern: "tacos", canonical: "Tacos" },
  { pattern: "sushi", canonical: "Sushi" },
  { pattern: "pizza", canonical: "Pizza" },
  { pattern: "wings", canonical: "Wings" },
  { pattern: "pasta", canonical: "Pasta" },
  { pattern: "steak", canonical: "Steak" },
  { pattern: "salad", canonical: "Salad" },
  { pattern: "fries", canonical: "Fries" },
  { pattern: "curry", canonical: "Curry" },
  { pattern: "gyros", canonical: "Gyro" },
  { pattern: "kbbq", canonical: "KBBQ" },
  { pattern: "taco", canonical: "Tacos" },
  { pattern: "thai", canonical: "Thai" },
  { pattern: "udon", canonical: "Udon" },
  { pattern: "wing", canonical: "Wings" },
  { pattern: "poke", canonical: "Poke" },
  { pattern: "boba", canonical: "Boba" },
  { pattern: "gyro", canonical: "Gyro" },
  { pattern: "pies", canonical: "Pie" },
  { pattern: "subs", canonical: "Sub" },
  { pattern: "pho", canonical: "Pho" },
  { pattern: "bbq", canonical: "BBQ" },
  { pattern: "pie", canonical: "Pie" },
  { pattern: "sub", canonical: "Sub" },
  { pattern: "tea", canonical: "Tea" },
];

export const DESTINATION_LEXICON: readonly LexiconEntry[] = [
  { pattern: "dave\\s*(?:&|and)\\s*busters", canonical: "Dave & Busters" },
  { pattern: "escape rooms", canonical: "Escape Room" },
  { pattern: "escape room", canonical: "Escape Room" },
  { pattern: "board games", canonical: "Board Games" },
  { pattern: "board game", canonical: "Board Games" },
  { pattern: "mini golf", canonical: "Mini Golf" },
  { pattern: "minigolf", canonical: "Mini Golf" },
  { pattern: "laser tag", canonical: "Laser Tag" },
  { pattern: "billiards", canonical: "Billiards" },
  { pattern: "aquarium", canonical: "Aquarium" },
  { pattern: "bowling", canonical: "Bowling" },
  { pattern: "karaoke", canonical: "Karaoke" },
  { pattern: "skating", canonical: "Skating" },
  { pattern: "museums", canonical: "Museum" },
  { pattern: "arcade", canonical: "Arcade" },
  { pattern: "movies", canonical: "Movies" },
  { pattern: "cinema", canonical: "Cinema" },
  { pattern: "museum", canonical: "Museum" },
  { pattern: "hiking", canonical: "Hike" },
  { pattern: "movie", canonical: "Movies" },
  { pattern: "beach", canonical: "Beach" },
  { pattern: "park", canonical: "Park" },
  { pattern: "cafe", canonical: "Cafe" },
  { pattern: "mall", canonical: "Mall" },
  { pattern: "hike", canonical: "Hike" },
  { pattern: "bar", canonical: "Bar" },
  { pattern: "pub", canonical: "Pub" },
  { pattern: "zoo", canonical: "Zoo" },
];

export const ALL_LEXICON: readonly LexiconEntry[] = [...FOOD_LEXICON, ...DESTINATION_LEXICON].sort(
  (a, b) => b.pattern.length - a.pattern.length,
);

export const STOPWORDS = new Set([
  "idk",
  "whatever",
  "anything",
  "fine",
  "honestly",
  "starving",
  "down",
  "maybe",
  "somewhere",
  "place",
  "food",
  "eat",
  "guys",
  "friends",
  "please",
  "dont",
  "don't",
  "want",
  "some",
  "have",
  "test",
  "again",
  "yesterday",
  "just",
  "kinda",
  "really",
  "actually",
  "literally",
  "you",
  "all",
  "or",
  "and",
  "for",
  "the",
  "with",
  "this",
  "that",
  "a",
  "an",
  "to",
  "it",
  "me",
  "us",
  "we",
  "i",
  "im",
  "i'm",
  "of",
  "in",
  "on",
  "at",
  "is",
  "be",
  "so",
  "go",
  "do",
  "get",
  "try",
  "something",
  "someone",
  "anyone",
  "nothing",
  "everything",
  "tonight",
  "today",
  "now",
  "later",
  "here",
  "there",
  "good",
  "nice",
  "great",
  "cool",
  "sure",
  "ok",
  "okay",
  "yes",
  "yeah",
  "no",
  "not",
  "nah",
  "nope",
  "none",
  "more",
  "else",
  "too",
  "very",
  "super",
  "pretty",
  "much",
  "hungry",
  "sounds",
  "sound",
  "think",
  "help",
  "wants",
  "wanted",
  "going",
  "about",
  "would",
  "could",
  "should",
  "after",
  "before",
  "people",
  "where",
  "which",
  "first",
  "never",
  "same",
  "lets",
  "let's",
  "pick",
  "choose",
  "who",
  "are",
  "free",
  "part",
  "though",
  "but",
  "except",
  "instead",
  "skip",
  "hate",
  "tired",
  "sick",
  "veto",
  "had",
  "has",
  "did",
  "didn't",
  "didnt",
  "can",
  "can't",
  "cant",
  "was",
  "were",
  "craving",
  "already",
  "once",
  "twice",
  "week",
  "last",
  "feel",
  "like",
  "however",
  "other",
  "than",
  "rather",
]);

const OPEN_PHRASE_TRIGGER =
  /\b(?:craving|down for|how about|what about|let'?s do|go to|feel like|want|try)\s+([^,;.!?\n]+)/gi;

export function getLexiconForMode(mode: PickMode): readonly LexiconEntry[] {
  if (mode === "food") {
    return FOOD_LEXICON;
  }
  if (mode === "destination") {
    return DESTINATION_LEXICON;
  }
  return ALL_LEXICON;
}

export function normalizeChatText(text: string): string {
  return text.replace(/([a-z0-9])-([a-z0-9])/gi, "$1 $2");
}

function toTitleCase(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function canonicalizeName(raw: string): string {
  const cleaned = normalizeChatText(raw).trim().toLowerCase();
  for (const entry of ALL_LEXICON) {
    const exact = new RegExp(`^(?:${entry.pattern})$`, "i");
    if (exact.test(cleaned)) {
      return entry.canonical;
    }
  }
  return toTitleCase(raw.trim());
}

function buildLexiconRegex(entries: readonly LexiconEntry[]): RegExp {
  const ordered = [...entries].sort((a, b) => b.pattern.length - a.pattern.length);
  const group = ordered.map((entry) => entry.pattern).join("|");
  return new RegExp(`\\b(?:${group})\\b`, "gi");
}

function findFuzzyLexiconMatch(word: string, entries: readonly LexiconEntry[]): string | null {
  const lower = word.toLowerCase();
  if (lower.length < 5 || STOPWORDS.has(lower)) {
    return null;
  }
  for (const entry of entries) {
    if (!/^[a-z]{5,}$/.test(entry.pattern)) {
      continue;
    }
    if (damerauLevenshteinAtMostOne(lower, entry.pattern)) {
      return entry.canonical;
    }
  }
  return null;
}

export interface GazetteerMatchResult {
  matches: string[];
  fuzzyCorrections: FuzzyCorrection[];
}

/**
 * Matches multi-word and short-token gazetteer terms longest-first on word boundaries,
 * then runs bounded Damerau-Levenshtein (<= 1) on unmatched words >= 5 letters.
 */
export function matchGazetteerInClause(
  clause: string,
  entries: readonly LexiconEntry[],
): GazetteerMatchResult {
  if (entries.length === 0 || clause.trim().length === 0) {
    return { matches: [], fuzzyCorrections: [] };
  }

  const normalized = normalizeChatText(clause);
  const regex = buildLexiconRegex(entries);
  const matches: string[] = [];
  const fuzzyCorrections: FuzzyCorrection[] = [];
  const matchedSpans: Array<[number, number]> = [];

  for (const match of normalized.matchAll(regex)) {
    const token = match[0];
    if (token !== undefined) {
      matches.push(canonicalizeName(token));
      const start = match.index ?? 0;
      matchedSpans.push([start, start + token.length]);
    }
  }

  for (const wordMatch of normalized.matchAll(/\b[a-z]{5,}\b/gi)) {
    const word = wordMatch[0];
    const start = wordMatch.index ?? 0;
    const end = start + word.length;
    const overlapsMatched = matchedSpans.some(([s, e]) => start < e && end > s);
    if (overlapsMatched) {
      continue;
    }
    const fuzzy = findFuzzyLexiconMatch(word, entries);
    if (fuzzy !== null) {
      matches.push(fuzzy);
      fuzzyCorrections.push({ input: word, matched: fuzzy });
    }
  }

  return { matches, fuzzyCorrections };
}

/**
 * Extracts open-vocabulary candidate phrases following preference grammar frames
 * such as "craving tapas" or "down for gelateria" when not already in the gazetteer.
 */
export function extractOpenPhraseCandidates(
  clause: string,
  entries: readonly LexiconEntry[],
): string[] {
  const found: string[] = [];
  for (const match of clause.matchAll(OPEN_PHRASE_TRIGGER)) {
    const rawTail = match[1];
    if (rawTail === undefined) {
      continue;
    }
    const alternatives = rawTail.split(/\s+(?:or|and)\s+/i);
    for (const alt of alternatives) {
      if (matchGazetteerInClause(alt, entries).matches.length > 0) {
        continue;
      }
      const tokens = alt
        .trim()
        .split(/\s+/)
        .map((tok) => tok.replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, ""))
        .filter((tok) => tok.length > 0 && !STOPWORDS.has(tok.toLowerCase()));

      if (tokens.length === 0 || tokens.length > 3) {
        continue;
      }
      const phrase = tokens.join(" ");
      if (phrase.length < 3 || !/[a-z]{3,}/i.test(phrase)) {
        continue;
      }
      found.push(canonicalizeName(phrase));
    }
  }
  return found;
}
