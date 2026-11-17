import type {
  AlgorithmTrace,
  DecisionVerdict,
  FuzzyCorrection,
  MessageAnalysis,
  PickMode,
  RankedOption,
  VetoedOption,
  VoterBallotSummary,
} from "../shared/types.js";

const FOOD_CROWD_PLEASERS = ["Ramen", "Tacos", "Thai", "Pizza", "Dumplings"] as const;
const DESTINATION_CROWD_PLEASERS = [
  "Bowling",
  "Arcade",
  "Board Games",
  "Mini Golf",
  "Karaoke",
] as const;

const DUPLICATE_NOTE = "Duplicate spam spotted — counted one vote per person.";

export interface ParsedClauseInput {
  clause: string;
  negated: boolean;
  matchedOptions: string[];
  fuzzyCorrections: FuzzyCorrection[];
}

export interface ParsedMessageInput {
  participantId: string;
  text: string;
  clauses: ParsedClauseInput[];
}

interface CandidateState {
  name: string;
  positiveVoters: Set<string>;
  vetoVoters: Set<string>;
  mentions: number;
  firstMentionIndex: number;
  quotes: string[];
  vetoReason: string | null;
}

interface VoterAccumulator {
  voterLabel: string;
  approved: Set<string>;
  vetoed: Set<string>;
  duplicateMentions: number;
}

export function buildMapsUrl(winner: string, mode: PickMode): string {
  const query = mode === "destination" ? winner : `${winner} food near me`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function pickCrowdPleaser(mode: PickMode, vetoedNames: Set<string>): string | null {
  const pool = mode === "destination" ? DESTINATION_CROWD_PLEASERS : FOOD_CROWD_PLEASERS;
  for (const item of pool) {
    if (!vetoedNames.has(item.toLowerCase())) {
      return item;
    }
  }
  return null;
}

/**
 * Combined Approval Voting with Veto ({-1, 0, +1} per participant, Brams & Fishburn 1978):
 * - Approving multiple options in a chat votes +1 on each without vote splitting.
 * - Filler chatter casts 0 (neutral abstention).
 * - Repeating the same option is idempotent per participant (+1 max approval, raw mentions tracked).
 * - Any -1 veto overrides positive votes by that voter and disqualifies vetoed options first.
 * - Ties break by earliest first mention (so spamming extra mentions cannot win a tie).
 */
export function tallyCombinedApprovalVotes(
  parsedMessages: readonly ParsedMessageInput[],
  mode: PickMode,
  durationMs: number,
): DecisionVerdict {
  const states = new Map<string, CandidateState>();
  const speakerPositiveCounts = new Map<string, number>();
  const voterIdsOrder: string[] = [];
  const voterAccums = new Map<string, VoterAccumulator>();

  const ensureVoter = (participantId: string): VoterAccumulator => {
    const existing = voterAccums.get(participantId);
    if (existing !== undefined) {
      return existing;
    }
    const voterNumber = voterIdsOrder.length + 1;
    voterIdsOrder.push(participantId);
    const created: VoterAccumulator = {
      voterLabel: `Voter #${voterNumber}`,
      approved: new Set<string>(),
      vetoed: new Set<string>(),
      duplicateMentions: 0,
    };
    voterAccums.set(participantId, created);
    return created;
  };

  const ensureState = (name: string, msgIndex: number): CandidateState => {
    const existing = states.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const created: CandidateState = {
      name,
      positiveVoters: new Set<string>(),
      vetoVoters: new Set<string>(),
      mentions: 0,
      firstMentionIndex: msgIndex,
      quotes: [],
      vetoReason: null,
    };
    states.set(name, created);
    return created;
  };

  const messageBreakdown: MessageAnalysis[] = [];

  for (let msgIdx = 0; msgIdx < parsedMessages.length; msgIdx += 1) {
    const msg = parsedMessages[msgIdx];
    if (msg === undefined) {
      continue;
    }
    const voter = ensureVoter(msg.participantId);

    for (const clause of msg.clauses) {
      for (const candidateName of clause.matchedOptions) {
        const state = ensureState(candidateName, msgIdx);
        if (clause.negated) {
          state.vetoVoters.add(msg.participantId);
          voter.vetoed.add(candidateName);
          voter.approved.delete(candidateName);
          if (state.vetoReason === null) {
            const snippet =
              clause.clause.length > 72 ? `${clause.clause.slice(0, 69)}...` : clause.clause;
            state.vetoReason = `Excluded from chat: "${snippet}"`;
          }
        } else {
          state.positiveVoters.add(msg.participantId);
          state.mentions += 1;
          if (!state.vetoVoters.has(msg.participantId)) {
            voter.approved.add(candidateName);
          }
          if (msgIdx < state.firstMentionIndex) {
            state.firstMentionIndex = msgIdx;
          }

          const speakerKey = `${msg.participantId}::${candidateName}`;
          const nextCount = (speakerPositiveCounts.get(speakerKey) ?? 0) + 1;
          speakerPositiveCounts.set(speakerKey, nextCount);
          if (nextCount > 1) {
            voter.duplicateMentions += 1;
          }

          const snippet =
            clause.clause.length > 80 ? `${clause.clause.slice(0, 77)}...` : clause.clause;
          if (state.quotes.length < 3 && !state.quotes.includes(snippet)) {
            state.quotes.push(snippet);
          }
        }
      }
    }

    messageBreakdown.push({
      text: msg.text,
      voterLabel: voter.voterLabel,
      clauses: msg.clauses,
    });
  }

  let duplicateDetected = false;
  for (const count of speakerPositiveCounts.values()) {
    if (count > 1) {
      duplicateDetected = true;
      break;
    }
  }

  const vetoed: VetoedOption[] = [];
  interface ScoredOption extends RankedOption {
    firstMentionIndex: number;
  }
  const ranked: ScoredOption[] = [];

  for (const state of states.values()) {
    if (state.vetoVoters.size > 0) {
      vetoed.push({
        name: state.name,
        vetoedByCount: state.vetoVoters.size,
        reason: state.vetoReason ?? "Excluded from chat",
      });
      continue;
    }

    const supporters = state.positiveVoters.size;
    if (supporters > 0) {
      ranked.push({
        name: state.name,
        supporters,
        mentions: state.mentions,
        sampleQuotes: state.quotes,
        firstMentionIndex: state.firstMentionIndex,
      });
    }
  }

  vetoed.sort((a, b) => b.vetoedByCount - a.vetoedByCount || a.name.localeCompare(b.name));
  ranked.sort(
    (a, b) =>
      b.supporters - a.supporters ||
      a.firstMentionIndex - b.firstMentionIndex ||
      a.name.localeCompare(b.name),
  );

  const top3: RankedOption[] = ranked.slice(0, 3).map((item) => ({
    name: item.name,
    supporters: item.supporters,
    mentions: item.mentions,
    sampleQuotes: item.sampleQuotes,
  }));

  const vetoedNames = new Set(vetoed.map((item) => item.name.toLowerCase()));

  let winner: string;
  let summary: string;
  let tieBreakRule: string;

  if (mode === "surprise" || ranked.length === 0) {
    const allMentionedWereVetoed = ranked.length === 0 && vetoed.length > 0;
    const unvetoedCrowdPick = pickCrowdPleaser(mode, vetoedNames);
    if (unvetoedCrowdPick !== null) {
      winner = unvetoedCrowdPick;
    } else {
      // Extreme edge case: every crowd-pleaser was vetoed too — fall back to least-vetoed net approval
      const byLeastVeto = [...states.values()].sort(
        (a, b) =>
          a.vetoVoters.size - b.vetoVoters.size ||
          b.positiveVoters.size - a.positiveVoters.size ||
          a.firstMentionIndex - b.firstMentionIndex,
      );
      winner = byLeastVeto[0]?.name ?? (mode === "destination" ? "Park" : "Pho");
    }

    if (mode === "surprise") {
      tieBreakRule = "Surprise wildcard (first un-vetoed crowd-pleaser)";
      summary = `PickForUs broke the tie in Surprise mode with ${winner} while respecting your chat vetoes.`;
    } else if (allMentionedWereVetoed) {
      tieBreakRule = "All mentioned options vetoed -> un-vetoed fallback";
      summary = `Every mentioned option was vetoed, so PickForUs broke the tie with an un-vetoed crowd-pleaser: ${winner}.`;
    } else {
      tieBreakRule = "Zero candidates extracted -> default un-vetoed tie-breaker";
      summary = `Nobody committed to a specific spot, so PickForUs broke the tie with ${winner}.`;
    }
  } else {
    const top = ranked[0];
    winner = top !== undefined ? top.name : (pickCrowdPleaser(mode, vetoedNames) ?? "Ramen");
    const supporterLabel =
      top !== undefined && top.supporters === 1
        ? "1 supporter"
        : `${top?.supporters ?? 1} supporters`;
    const mentionLabel =
      top !== undefined && top.mentions === 1 ? "1 mention" : `${top?.mentions ?? 1} mentions`;
    const second = ranked[1];
    const isTie = top !== undefined && second !== undefined && top.supporters === second.supporters;

    tieBreakRule = isTie
      ? `Unique approval tie (${top.supporters} vs ${second.supporters}) broken by earliest first mention`
      : `Clear approval majority (${supporterLabel}, 0 vetoes)`;

    const parts: string[] = [
      isTie
        ? `PickForUs broke a ${top.supporters}-vote tie by first mention in favor of ${winner} (${supporterLabel}, ${mentionLabel}).`
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

  const ballots: VoterBallotSummary[] = voterIdsOrder
    .map((pid) => voterAccums.get(pid))
    .filter((v): v is VoterAccumulator => v !== undefined)
    .map((v) => ({
      voterLabel: v.voterLabel,
      approved: [...v.approved],
      vetoed: [...v.vetoed],
      duplicateMentions: v.duplicateMentions,
    }));

  const trace: AlgorithmTrace = {
    durationMs: Number(durationMs.toFixed(2)),
    messageBreakdown,
    ballots,
    tieBreakRule,
  };

  return {
    winner,
    summary,
    top3,
    vetoed,
    duplicateDetected,
    duplicateNote: duplicateDetected ? DUPLICATE_NOTE : null,
    mapsUrl: buildMapsUrl(winner, mode),
    decidedAt: new Date().toISOString(),
    trace,
  };
}
