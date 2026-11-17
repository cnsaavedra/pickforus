import type { ChatEntry, DecisionVerdict, PickMode } from "../shared/types.js";
import { type ParsedMessageInput, tallyCombinedApprovalVotes } from "./approvalVoting.js";
import {
  extractOpenPhraseCandidates,
  getLexiconForMode,
  matchGazetteerInClause,
} from "./gazetteer.js";
import { isNegatedClause, segmentClauses } from "./negation.js";

/**
 * Pure deterministic 4-stage decision pipeline:
 * 1. NegEx-style clause segmentation (punctuated + contrastive + inline pivots)
 * 2. Longest-phrase Gazetteer + Damerau-Levenshtein (<= 1) + open-phrase grammar
 * 3. Clause negation polarity assignment (+1 approval vs -1 veto)
 * 4. Combined Approval Voting with per-voter deduplication and first-mention tie-breaking
 */
export function runDecisionPipeline(messages: ChatEntry[], mode: PickMode): DecisionVerdict {
  const startMs = performance.now();
  const entries = getLexiconForMode(mode);

  const parsedMessages: ParsedMessageInput[] = messages.map((msg) => {
    const clauses = segmentClauses(msg.text).map((clause) => {
      const negated = isNegatedClause(clause);
      const { matches, fuzzyCorrections } = matchGazetteerInClause(clause, entries);
      const openMatches = extractOpenPhraseCandidates(clause, entries);
      return {
        clause,
        negated,
        matchedOptions: [...matches, ...openMatches],
        fuzzyCorrections,
      };
    });

    return {
      participantId: msg.participantId,
      text: msg.text,
      clauses,
    };
  });

  const elapsedMs = Math.max(0.01, performance.now() - startMs);
  return tallyCombinedApprovalVotes(parsedMessages, mode, elapsedMs);
}
