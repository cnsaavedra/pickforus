import type {
  ChatEntry,
  DecisionVerdict,
  LlmMode,
  PickMode,
  RankedOption,
  VetoedOption,
} from "../shared/types.js";

export interface OllamaExtractOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface DecideRoomConfig extends OllamaExtractOptions {
  llmMode: LlmMode;
}

interface LexiconEntry {
  pattern: string;
  canonical: string;
}

const FOOD_LEXICON: readonly LexiconEntry[] = [
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
  { pattern: "dessert", canonical: "Desserts" },
  { pattern: "shawarma", canonical: "Shawarma" },
  { pattern: "japanese", canonical: "Japanese" },
  { pattern: "burritos", canonical: "Burritos" },
  { pattern: "barbeque", canonical: "BBQ" },
  { pattern: "barbecue", canonical: "BBQ" },
  { pattern: "burrito", canonical: "Burritos" },
  { pattern: "dim sum", canonical: "Dim Sum" },
  { pattern: "hot pot", canonical: "Hotpot" },
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

const DESTINATION_LEXICON: readonly LexiconEntry[] = [
  { pattern: "dave\\s*(?:&|and)\\s*busters", canonical: "Dave & Busters" },
  { pattern: "escape rooms", canonical: "Escape Room" },
  { pattern: "escape room", canonical: "Escape Room" },
  { pattern: "board games", canonical: "Board Games" },
  { pattern: "board game", canonical: "Board Games" },
  { pattern: "mini golf", canonical: "Mini Golf" },
  { pattern: "minigolf", canonical: "Mini Golf" },
  { pattern: "billiards", canonical: "Billiards" },
  { pattern: "aquarium", canonical: "Aquarium" },
  { pattern: "bowling", canonical: "Bowling" },
  { pattern: "karaoke", canonical: "Karaoke" },
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

const ALL_LEXICON: readonly LexiconEntry[] = [...FOOD_LEXICON, ...DESTINATION_LEXICON].sort(
  (a, b) => b.pattern.length - a.pattern.length,
);

const STOPWORDS = new Set([
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
]);

const FOOD_CROWD_PLEASERS = ["Ramen", "Tacos", "Thai", "Pizza", "Dumplings"] as const;
const DESTINATION_CROWD_PLEASERS = [
  "Bowling",
  "Arcade",
  "Board Games",
  "Mini Golf",
  "Karaoke",
] as const;

const DUPLICATE_NOTE = "Duplicate spam spotted — counted one vote per person.";

const NEGATION_PATTERNS: readonly RegExp[] = [
  /\b(?:don't|dont|do not|didn't|didnt)\s+want\b/i,
  /\b(?:anything|everything)\s+(?:but|except)\b/i,
  /\bexcept\b/i,
  /\binstead\s+of\b/i,
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

const OPEN_VOCAB_TRIGGER =
  /\b(?:craving|down for|how about|let'?s do|go to|want)\s+([^,;.!?\n]+)/gi;

function buildMapsUrl(winner: string, mode: PickMode): string {
  const query = mode === "destination" ? winner : `${winner} food near me`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function getLexiconForMode(mode: PickMode): readonly LexiconEntry[] {
  if (mode === "food") {
    return FOOD_LEXICON;
  }
  if (mode === "destination") {
    return DESTINATION_LEXICON;
  }
  return ALL_LEXICON;
}

function buildLexiconRegex(entries: readonly LexiconEntry[]): RegExp {
  const ordered = [...entries].sort((a, b) => b.pattern.length - a.pattern.length);
  const group = ordered.map((entry) => entry.pattern).join("|");
  return new RegExp(`\\b(?:${group})\\b`, "gi");
}

function canonicalizeName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/([a-z0-9])-([a-z0-9])/gi, "$1 $2");
  for (const entry of ALL_LEXICON) {
    const exact = new RegExp(`^(?:${entry.pattern})$`, "i");
    if (exact.test(cleaned)) {
      return entry.canonical;
    }
  }
  return toTitleCase(raw.trim());
}

function toTitleCase(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function splitIntoClauses(text: string): string[] {
  const punctuated = text
    .split(/[,;.!?\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const clauses: string[] = [];
  for (const segment of punctuated) {
    const transitionParts = segment
      .split(/(?<!\banything|\beverything)\s+(?:but|though)\s+/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    for (const part of transitionParts) {
      const exceptionParts = part
        .split(/\s+(?=(?:except(?:\s+for)?|instead\s+of)\b)/i)
        .map((sub) => sub.trim())
        .filter((sub) => sub.length > 0);
      clauses.push(...exceptionParts);
    }
  }

  return clauses;
}

function isNegatedClause(clause: string): boolean {
  return NEGATION_PATTERNS.some((pattern) => pattern.test(clause));
}

function damerauLevenshteinAtMostOne(a: string, b: string): boolean {
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

  // Substitution or adjacent transposition on equal-length strings
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

  // Single insertion or deletion
  if (lenA > lenB) {
    return a.slice(i + 1) === b.slice(j);
  }
  return a.slice(i) === b.slice(j + 1);
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

function matchLexiconInText(text: string, entries: readonly LexiconEntry[]): string[] {
  if (entries.length === 0 || text.trim().length === 0) {
    return [];
  }
  const normalized = text.replace(/([a-z0-9])-([a-z0-9])/gi, "$1 $2");
  const regex = buildLexiconRegex(entries);
  const matches: string[] = [];
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
    }
  }

  return matches;
}

function extractOpenVocabCandidates(clause: string, entries: readonly LexiconEntry[]): string[] {
  const found: string[] = [];
  for (const match of clause.matchAll(OPEN_VOCAB_TRIGGER)) {
    const rawTail = match[1];
    if (rawTail === undefined) {
      continue;
    }
    const alternatives = rawTail.split(/\s+(?:or|and)\s+/i);
    for (const alt of alternatives) {
      if (matchLexiconInText(alt, entries).length > 0) {
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

function pickCrowdPleaser(mode: PickMode, vetoedNames: Set<string>): string {
  const pool = mode === "destination" ? DESTINATION_CROWD_PLEASERS : FOOD_CROWD_PLEASERS;
  for (const item of pool) {
    if (!vetoedNames.has(item.toLowerCase())) {
      return item;
    }
  }
  return mode === "destination" ? "Park" : "Pho";
}

interface CandidateState {
  name: string;
  positiveVoters: Set<string>;
  vetoVoters: Set<string>;
  mentions: number;
  quotes: string[];
  vetoReason: string | null;
}

export function extractDeterministic(messages: ChatEntry[], mode: PickMode): DecisionVerdict {
  const entries = getLexiconForMode(mode);
  const states = new Map<string, CandidateState>();
  const speakerPositiveCounts = new Map<string, number>();

  const ensureState = (name: string): CandidateState => {
    const existing = states.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const created: CandidateState = {
      name,
      positiveVoters: new Set<string>(),
      vetoVoters: new Set<string>(),
      mentions: 0,
      quotes: [],
      vetoReason: null,
    };
    states.set(name, created);
    return created;
  };

  for (const msg of messages) {
    const clauses = splitIntoClauses(msg.text);
    for (const clause of clauses) {
      const negated = isNegatedClause(clause);
      const lexiconMatches = matchLexiconInText(clause, entries);
      const openMatches = extractOpenVocabCandidates(clause, entries);
      const allMatches = [...lexiconMatches, ...openMatches];

      for (const candidateName of allMatches) {
        const state = ensureState(candidateName);
        if (negated) {
          state.vetoVoters.add(msg.participantId);
          if (state.vetoReason === null) {
            const snippet = clause.length > 72 ? `${clause.slice(0, 69)}...` : clause;
            state.vetoReason = `Excluded from chat: "${snippet}"`;
          }
        } else {
          state.positiveVoters.add(msg.participantId);
          state.mentions += 1;
          const speakerKey = `${msg.participantId}::${candidateName}`;
          speakerPositiveCounts.set(speakerKey, (speakerPositiveCounts.get(speakerKey) ?? 0) + 1);
          const snippet = clause.length > 80 ? `${clause.slice(0, 77)}...` : clause;
          if (state.quotes.length < 3 && !state.quotes.includes(snippet)) {
            state.quotes.push(snippet);
          }
        }
      }
    }
  }

  let duplicateDetected = false;
  for (const count of speakerPositiveCounts.values()) {
    if (count > 1) {
      duplicateDetected = true;
      break;
    }
  }

  const vetoed: VetoedOption[] = [];
  const ranked: RankedOption[] = [];

  for (const state of states.values()) {
    if (state.vetoVoters.size > 0) {
      vetoed.push({
        name: state.name,
        vetoedByCount: state.vetoVoters.size,
        reason: state.vetoReason ?? "Excluded from chat",
      });
      continue;
    }

    const supporters = [...state.positiveVoters].filter(
      (participantId) => !state.vetoVoters.has(participantId),
    ).length;

    if (supporters > 0) {
      ranked.push({
        name: state.name,
        supporters,
        mentions: state.mentions,
        sampleQuotes: state.quotes,
      });
    }
  }

  vetoed.sort((a, b) => b.vetoedByCount - a.vetoedByCount || a.name.localeCompare(b.name));
  ranked.sort(
    (a, b) =>
      b.supporters - a.supporters || b.mentions - a.mentions || a.name.localeCompare(b.name),
  );

  const top3 = ranked.slice(0, 3);
  const vetoedNames = new Set(vetoed.map((item) => item.name.toLowerCase()));

  let winner: string;
  let summary: string;

  if (mode === "surprise" || ranked.length === 0) {
    const allMentionedWereVetoed = ranked.length === 0 && vetoed.length > 0;
    winner = pickCrowdPleaser(mode, vetoedNames);
    if (mode === "surprise") {
      summary = `PickForUs broke the tie in Surprise mode with ${winner} while respecting your chat vetoes.`;
    } else if (allMentionedWereVetoed) {
      summary = `Every mentioned option was vetoed, so PickForUs broke the tie with an un-vetoed crowd-pleaser: ${winner}.`;
    } else {
      summary = `Nobody committed to a specific spot, so PickForUs broke the tie with ${winner}.`;
    }
  } else {
    const top = ranked[0];
    winner = top !== undefined ? top.name : pickCrowdPleaser(mode, vetoedNames);
    const supporterLabel =
      top !== undefined && top.supporters === 1
        ? "1 supporter"
        : `${top?.supporters ?? 1} supporters`;
    const mentionLabel =
      top !== undefined && top.mentions === 1 ? "1 mention" : `${top?.mentions ?? 1} mentions`;
    const second = ranked[1];
    const isTie =
      top !== undefined &&
      second !== undefined &&
      top.supporters === second.supporters &&
      top.mentions === second.mentions;

    const parts: string[] = [
      isTie
        ? `PickForUs broke a close tie in favor of ${winner} (${supporterLabel}, ${mentionLabel}).`
        : `${winner} leads the group with ${supporterLabel} (${mentionLabel}).`,
    ];
    if (vetoed.length > 0) {
      parts.push(`Excluded: ${vetoed.map((v) => v.name).join(", ")}.`);
    }
    if (duplicateDetected) {
      parts.push(DUPLICATE_NOTE);
    }
    summary = parts.join(" ");
  }

  return {
    winner,
    summary,
    top3,
    vetoed,
    duplicateDetected,
    duplicateNote: duplicateDetected ? DUPLICATE_NOTE : null,
    engineUsed: "rules",
    modelName: null,
    mapsUrl: buildMapsUrl(winner, mode),
    decidedAt: new Date().toISOString(),
  };
}

interface OllamaRawCandidate {
  name?: unknown;
  supporters?: unknown;
  quote?: unknown;
}

interface OllamaRawVeto {
  name?: unknown;
  vetoedByCount?: unknown;
  reason?: unknown;
}

interface OllamaParsedPayload {
  winner?: unknown;
  summary?: unknown;
  candidates?: unknown;
  vetoed?: unknown;
}

const OLLAMA_JSON_SCHEMA = {
  type: "object",
  properties: {
    winner: { type: "string" },
    summary: { type: "string" },
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          supporters: { type: "integer" },
          quote: { type: "string" },
        },
        required: ["name", "supporters", "quote"],
      },
    },
    vetoed: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          vetoedByCount: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["name", "vetoedByCount", "reason"],
      },
    },
  },
  required: ["winner", "summary", "candidates", "vetoed"],
} as const;

export async function extractWithOllama(
  messages: ChatEntry[],
  mode: PickMode,
  options?: OllamaExtractOptions,
): Promise<DecisionVerdict> {
  const deterministic = extractDeterministic(messages, mode);
  if (messages.length === 0) {
    return deterministic;
  }

  const baseUrl = (options?.baseUrl ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = options?.model ?? "qwen3.5:9b";
  const timeoutMs = options?.timeoutMs ?? 25000;

  const transcript = messages
    .map((msg) => `[${msg.alias} (${msg.participantId})]: ${msg.text}`)
    .join("\n");

  const systemPrompt = [
    "You break friend-group indecision from a short anonymous chat.",
    `Mode: ${mode}.`,
    "Rules:",
    "1. Count at most ONE vote per participantId per option (ignore repeated spam by the same person).",
    "2. Put any negated/excluded options in vetoed and NEVER choose a vetoed option as winner or candidate.",
    "3. Ignore filler phrases like 'idk', 'whatever', 'honestly', 'starving'.",
    "4. Return strict JSON matching the schema.",
  ].join(" ");

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        format: OLLAMA_JSON_SCHEMA,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: transcript },
        ],
      }),
    });

    if (!response.ok) {
      return deterministic;
    }

    const envelope = (await response.json()) as {
      message?: { content?: unknown };
    };
    const rawContent = envelope.message?.content;
    if (typeof rawContent !== "string" || rawContent.trim().length === 0) {
      return deterministic;
    }

    const parsed = JSON.parse(rawContent) as OllamaParsedPayload;

    const mergedVetoMap = new Map<string, VetoedOption>();
    for (const detVeto of deterministic.vetoed) {
      mergedVetoMap.set(detVeto.name.toLowerCase(), detVeto);
    }

    if (Array.isArray(parsed.vetoed)) {
      for (const item of parsed.vetoed as OllamaRawVeto[]) {
        if (typeof item.name !== "string" || item.name.trim().length === 0) {
          continue;
        }
        const canonical = canonicalizeName(item.name);
        const key = canonical.toLowerCase();
        if (!mergedVetoMap.has(key)) {
          const count =
            typeof item.vetoedByCount === "number" && Number.isFinite(item.vetoedByCount)
              ? Math.max(1, Math.floor(item.vetoedByCount))
              : 1;
          const reason =
            typeof item.reason === "string" && item.reason.trim().length > 0
              ? item.reason.trim()
              : "Excluded from chat";
          mergedVetoMap.set(key, {
            name: canonical,
            vetoedByCount: count,
            reason,
          });
        }
      }
    }

    const vetoed = [...mergedVetoMap.values()].sort(
      (a, b) => b.vetoedByCount - a.vetoedByCount || a.name.localeCompare(b.name),
    );
    const vetoedSet = new Set(vetoed.map((v) => v.name.toLowerCase()));

    const candidateMap = new Map<string, RankedOption>();
    if (Array.isArray(parsed.candidates)) {
      for (const item of parsed.candidates as OllamaRawCandidate[]) {
        if (typeof item.name !== "string" || item.name.trim().length === 0) {
          continue;
        }
        const canonical = canonicalizeName(item.name);
        if (vetoedSet.has(canonical.toLowerCase()) || STOPWORDS.has(canonical.toLowerCase())) {
          continue;
        }
        const supporters =
          typeof item.supporters === "number" && Number.isFinite(item.supporters)
            ? Math.max(1, Math.floor(item.supporters))
            : 1;
        const cleanQuote =
          typeof item.quote === "string"
            ? item.quote
                .trim()
                .replace(/^["'“”]+|["'“”]+$/g, "")
                .trim()
            : "";
        const quote = cleanQuote.length > 0 ? [cleanQuote] : [];

        const existing = candidateMap.get(canonical);
        const detMentions =
          deterministic.top3.find((d) => d.name.toLowerCase() === canonical.toLowerCase())
            ?.mentions ?? supporters;
        if (existing === undefined || supporters > existing.supporters) {
          candidateMap.set(canonical, {
            name: canonical,
            supporters,
            mentions: Math.max(supporters, detMentions),
            sampleQuotes: quote,
          });
        }
      }
    }

    const top3 = [...candidateMap.values()]
      .sort((a, b) => b.supporters - a.supporters || a.name.localeCompare(b.name))
      .slice(0, 3);

    let winner = "";
    if (typeof parsed.winner === "string" && parsed.winner.trim().length > 0) {
      const candidateWinner = canonicalizeName(parsed.winner);
      if (
        !vetoedSet.has(candidateWinner.toLowerCase()) &&
        !STOPWORDS.has(candidateWinner.toLowerCase())
      ) {
        winner = candidateWinner;
      }
    }

    const unvetoedDetTop3 = deterministic.top3.filter(
      (item) => !vetoedSet.has(item.name.toLowerCase()),
    );

    if (winner.length === 0) {
      const fallbackTop = top3[0] ?? unvetoedDetTop3[0];
      winner = fallbackTop !== undefined ? fallbackTop.name : pickCrowdPleaser(mode, vetoedSet);
    }

    if (vetoedSet.has(winner.toLowerCase())) {
      winner = unvetoedDetTop3[0]?.name ?? pickCrowdPleaser(mode, vetoedSet);
    }

    const rawSummary =
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : deterministic.summary;

    const finalSummary =
      deterministic.duplicateDetected && !rawSummary.includes("one vote per person")
        ? `${rawSummary} ${DUPLICATE_NOTE}`
        : rawSummary;

    return {
      winner,
      summary: finalSummary,
      top3: top3.length > 0 ? top3 : unvetoedDetTop3,
      vetoed,
      duplicateDetected: deterministic.duplicateDetected,
      duplicateNote: deterministic.duplicateNote,
      engineUsed: "ollama",
      modelName: model,
      mapsUrl: buildMapsUrl(winner, mode),
      decidedAt: new Date().toISOString(),
    };
  } catch {
    return deterministic;
  }
}

function hasUnrecognizedSubstantiveTokens(
  messages: ChatEntry[],
  mode: PickMode,
  vetoed: readonly VetoedOption[],
): boolean {
  const entries = getLexiconForMode(mode);
  const vetoedSet = new Set(vetoed.map((v) => v.name.toLowerCase()));
  for (const msg of messages) {
    const normalized = msg.text.replace(/([a-z0-9])-([a-z0-9])/gi, "$1 $2");
    for (const tokenMatch of normalized.matchAll(/\b[a-z]{3,}\b/gi)) {
      const token = tokenMatch[0].toLowerCase();
      if (STOPWORDS.has(token)) {
        continue;
      }
      const matched = matchLexiconInText(token, entries);
      if (matched.length > 0 && matched.every((m) => vetoedSet.has(m.toLowerCase()))) {
        continue;
      }
      if (matched.length === 0) {
        return true;
      }
    }
  }
  return false;
}

export async function decideRoom(
  messages: ChatEntry[],
  mode: PickMode,
  config: DecideRoomConfig,
): Promise<DecisionVerdict> {
  if (config.llmMode === "rules") {
    return extractDeterministic(messages, mode);
  }
  if (config.llmMode === "ollama") {
    return extractWithOllama(messages, mode, config);
  }

  // Auto mode: run classical Gazetteer + NegEx + Combined Approval Voting first (<2ms).
  // Escalate to local Ollama only when chat contains unrecognized venue/dish terms that
  // produced zero classical candidates.
  const deterministic = extractDeterministic(messages, mode);
  if (mode === "surprise" || messages.length === 0 || deterministic.top3.length > 0) {
    return deterministic;
  }
  if (!hasUnrecognizedSubstantiveTokens(messages, mode, deterministic.vetoed)) {
    return deterministic;
  }
  return extractWithOllama(messages, mode, config);
}
