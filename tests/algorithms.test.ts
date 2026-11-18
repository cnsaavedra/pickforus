import { describe, expect, it } from "vitest";
import {
  damerauLevenshteinAtMostOne,
  damerauLevenshteinDistance,
} from "../src/algorithms/editDistance.js";
import { segmentClauses } from "../src/algorithms/negation.js";
import { runDecisionPipeline } from "../src/algorithms/pipeline.js";
import type { ChatEntry } from "../src/shared/types.js";

function msg(
  participantId: string,
  text: string,
  index = 1,
  alias = `Alias ${participantId}`,
): ChatEntry {
  return {
    id: `m-${index}`,
    roomCode: "ABCD",
    roundNumber: 1,
    participantId,
    alias,
    text,
    createdAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
  };
}

describe("damerauLevenshtein edit distance", () => {
  it("computes exact edit distances for insertions, deletions, substitutions, and transpositions", () => {
    expect(damerauLevenshteinDistance("ramen", "ramen")).toBe(0);
    expect(damerauLevenshteinDistance("ramen", "ramne")).toBe(1);
    expect(damerauLevenshteinDistance("spaghetti", "spagetti")).toBe(1);
    expect(damerauLevenshteinDistance("burger", "burgr")).toBe(1);
    expect(damerauLevenshteinDistance("pasta", "pesto")).toBe(2);
    expect(damerauLevenshteinDistance("pasta", "pizza")).toBe(3);

    expect(damerauLevenshteinAtMostOne("ramen", "ramne")).toBe(true);
    expect(damerauLevenshteinAtMostOne("spaghetti", "spagetti")).toBe(true);
    expect(damerauLevenshteinAtMostOne("burger", "burgr")).toBe(true);
    expect(damerauLevenshteinAtMostOne("pasta", "pesto")).toBe(false);
  });
});

describe("NegEx clause segmentation", () => {
  it("splits both punctuated and unpunctuated inline polarity boundaries", () => {
    expect(segmentClauses("I don't want burger, maybe pho")).toEqual([
      "I don't want burger",
      "maybe pho",
    ]);
    expect(segmentClauses("ramen sounds good no sushi")).toEqual(["ramen sounds good", "no sushi"]);
    expect(segmentClauses("no burger maybe tacos")).toEqual(["no burger", "maybe tacos"]);
    expect(segmentClauses("down for ramen or tacos, just no sushi")).toEqual([
      "down for ramen or tacos",
      "just no sushi",
    ]);
  });
});

describe("runDecisionPipeline (Gazetteer + NegEx + Combined Approval Voting)", () => {
  it("yields zero bogus options on filler-only chat and falls back cleanly", () => {
    const messages = [
      msg("p1", "idk whatever you guys want honestly starving", 1),
      msg("p2", "anything is fine maybe somewhere good to eat", 2),
      msg("p3", "just hungry friends please help", 3),
    ];

    const foodVerdict = runDecisionPipeline(messages, "food");
    expect(foodVerdict.top3).toEqual([]);
    expect(foodVerdict.vetoed).toEqual([]);
    expect(foodVerdict.winner).toBe("Ramen");
    expect(foodVerdict.summary.toLowerCase()).toContain("broke the tie");
    expect(foodVerdict.mapsUrl).toContain(encodeURIComponent("Ramen food near me"));

    const destVerdict = runDecisionPipeline(messages, "destination");
    expect(destVerdict.top3).toEqual([]);
    expect(destVerdict.winner).toBe("Bowling");
    expect(destVerdict.mapsUrl).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Bowling")}`,
    );
  });

  it("extracts 2- and 3-letter foods without dropping short words or matching substrings", () => {
    expect(runDecisionPipeline([msg("p1", "craving pho tonight", 1)], "food").winner).toBe("Pho");
    expect(runDecisionPipeline([msg("p1", "down for bbq", 1)], "food").winner).toBe("BBQ");
    expect(runDecisionPipeline([msg("p1", "let's do pie", 1)], "food").winner).toBe("Pie");
    expect(runDecisionPipeline([msg("p1", "want a sub", 1)], "food").winner).toBe("Sub");
    expect(runDecisionPipeline([msg("p1", "how about tea", 1)], "food").winner).toBe("Tea");

    // Boundary check: "steak" must not trigger "tea"
    const steakVerdict = runDecisionPipeline([msg("p1", "steak please", 1)], "food");
    expect(steakVerdict.winner).toBe("Steak");
    expect(steakVerdict.top3.map((o) => o.name)).toEqual(["Steak"]);
  });

  it("handles destination lexicon and open-phrase grammar triggers", () => {
    const destVerdict = runDecisionPipeline(
      [
        msg("p1", "down for mini golf or dave & busters", 1),
        msg("p2", "dave and busters sounds great", 2),
      ],
      "destination",
    );
    expect(destVerdict.winner).toBe("Dave & Busters");
    expect(destVerdict.top3.map((o) => o.name)).toEqual(["Dave & Busters", "Mini Golf"]);

    const openPhrase = runDecisionPipeline(
      [msg("p1", "craving tapas tonight", 1), msg("p2", "feel like tapas", 2)],
      "food",
    );
    expect(openPhrase.winner).toBe("Tapas");
    expect(openPhrase.top3[0]?.supporters).toBe(2);
  });

  it("respects sign & direction symmetry across punctuated and inline unpunctuated negations", () => {
    const positive = runDecisionPipeline([msg("p1", "I want burger", 1)], "food");
    expect(positive.winner).toBe("Burgers");
    expect(positive.vetoed).toEqual([]);
    expect(positive.top3[0]).toMatchObject({ name: "Burgers", supporters: 1, mentions: 1 });

    const negatedThenPositive = runDecisionPipeline(
      [msg("p1", "I don't want burger, maybe pho", 1)],
      "food",
    );
    expect(negatedThenPositive.winner).toBe("Pho");
    expect(negatedThenPositive.vetoed).toHaveLength(1);
    expect(negatedThenPositive.vetoed[0]?.name).toBe("Burgers");
    expect(negatedThenPositive.vetoed[0]?.reason).toContain("don't want burger");
    expect(negatedThenPositive.top3.map((o) => o.name)).toEqual(["Pho"]);
    expect(negatedThenPositive.mapsUrl).toContain("Pho");
    expect(negatedThenPositive.mapsUrl).not.toContain("topFood");

    const unpunctuatedInline = runDecisionPipeline(
      [msg("p1", "ramen sounds good no sushi", 1), msg("p2", "no burger maybe pho", 2)],
      "food",
    );
    expect(unpunctuatedInline.vetoed.map((v) => v.name)).toEqual(
      expect.arrayContaining(["Sushi", "Burgers"]),
    );
    expect(unpunctuatedInline.top3.map((o) => o.name)).toEqual(["Ramen", "Pho"]);
    expect(unpunctuatedInline.winner).toBe("Ramen");
  });

  it("picks an un-vetoed crowd-pleaser when every mentioned option is vetoed or in surprise mode", () => {
    const allVetoed = runDecisionPipeline(
      [msg("p1", "no ramen, no tacos", 1), msg("p2", "don't want burger", 2)],
      "food",
    );
    expect(allVetoed.winner).toBe("Thai");
    expect(allVetoed.top3).toEqual([]);
    expect(allVetoed.vetoed.map((v) => v.name)).toEqual(
      expect.arrayContaining(["Ramen", "Tacos", "Burgers"]),
    );

    const surprise = runDecisionPipeline(
      [msg("p1", "no ramen please", 1), msg("p2", "sushi sounds fine", 2)],
      "surprise",
    );
    expect(surprise.winner).toBe("Tacos");
    expect(surprise.summary).toContain("Surprise");
  });

  it("caps single-speaker spam and prevents spam mentions from winning 1-vs-1 ties", () => {
    const spamMessages = [
      msg("spammer", "burger", 1),
      msg("spammer", "burger", 2),
      msg("spammer", "burger", 3),
      msg("spammer", "burger", 4),
      msg("spammer", "burger", 5),
      msg("friend-a", "ramen", 6),
      msg("friend-b", "ramen", 7),
    ];

    const verdict = runDecisionPipeline(spamMessages, "food");
    expect(verdict.winner).toBe("Ramen");
    expect(verdict.duplicateDetected).toBe(true);
    expect(verdict.duplicateNote).toBe("Duplicate spam spotted — counted one vote per person.");
    expect(verdict.top3.find((o) => o.name === "Ramen")).toMatchObject({
      name: "Ramen",
      supporters: 2,
      mentions: 2,
    });
    expect(verdict.top3.find((o) => o.name === "Burgers")).toMatchObject({
      supporters: 1,
      mentions: 5,
    });

    // 1-vs-1 tie: Alice mentioned Pho first once; Spammer Bob repeated Burger 3 times later.
    // Earliest first mention breaks the tie so spam never beats an honest first vote.
    const tieWithSpam = runDecisionPipeline(
      [msg("alice", "pho", 1), msg("bob", "burger burger burger", 2)],
      "food",
    );
    expect(tieWithSpam.winner).toBe("Pho");
    expect(tieWithSpam.duplicateDetected).toBe(true);
    expect(tieWithSpam.trace.tieBreakRule).toContain("earliest first mention");
  });

  it("handles hyphenated foods, earliest-mention ties, fuzzy typos, and AlgorithmTrace output", () => {
    const tieAndHyphenRound = runDecisionPipeline(
      [
        msg("p1", "i think i want spaghetti", 1),
        msg("p2", "or fries idk", 2),
        msg("p3", "spaghetti sounds good, same with fries", 3),
        msg("p4", "just want desserts like bubble-tea", 4),
      ],
      "food",
    );
    // Spaghetti and Fries both tie at 2 voters; Spaghetti came first so it wins #1.
    expect(tieAndHyphenRound.winner).toBe("Spaghetti");
    expect(tieAndHyphenRound.top3.map((o) => o.name)).toEqual(["Spaghetti", "Fries", "Bubble Tea"]);

    const fuzzyTypos = runDecisionPipeline(
      [
        msg("p1", "spagetti tonight", 1),
        msg("p2", "ramne sounds nice", 2),
        msg("p3", "no burgr please", 3),
        msg("p4", "who is free for the part with hungry friends", 4),
      ],
      "food",
    );
    expect(fuzzyTypos.vetoed.map((v) => v.name)).toContain("Burgers");
    expect(fuzzyTypos.top3.map((o) => o.name)).toEqual(["Spaghetti", "Ramen"]);

    expect(fuzzyTypos.trace.durationMs).toBeGreaterThan(0);
    expect(fuzzyTypos.trace.ballots).toHaveLength(4);
    expect(fuzzyTypos.trace.ballots[0]?.voterLabel).toBe("Voter #1");
    expect(fuzzyTypos.trace.messageBreakdown[0]?.clauses[0]?.fuzzyCorrections).toEqual([
      { input: "spagetti", matched: "Spaghetti" },
    ]);
  });
});
