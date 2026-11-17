import { afterEach, describe, expect, it, vi } from "vitest";
import { decideRoom, extractDeterministic, extractWithOllama } from "../src/server/extractor.js";
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

describe("extractDeterministic", () => {
  it("yields zero bogus options on filler-only chat and falls back cleanly", () => {
    const messages = [
      msg("p1", "idk whatever you guys want honestly starving", 1),
      msg("p2", "anything is fine maybe somewhere good to eat", 2),
      msg("p3", "just hungry friends please help", 3),
    ];

    const foodVerdict = extractDeterministic(messages, "food");
    expect(foodVerdict.top3).toEqual([]);
    expect(foodVerdict.vetoed).toEqual([]);
    expect(foodVerdict.winner).toBe("Ramen");
    expect(foodVerdict.summary.toLowerCase()).toContain("broke the tie");
    expect(foodVerdict.mapsUrl).toContain(encodeURIComponent("Ramen food near me"));

    const destVerdict = extractDeterministic(messages, "destination");
    expect(destVerdict.top3).toEqual([]);
    expect(destVerdict.winner).toBe("Bowling");
    expect(destVerdict.mapsUrl).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Bowling")}`,
    );
  });

  it("extracts 2- and 3-letter foods without dropping short words or matching substrings", () => {
    const phoVerdict = extractDeterministic([msg("p1", "craving pho tonight", 1)], "food");
    expect(phoVerdict.winner).toBe("Pho");
    expect(phoVerdict.top3[0]?.name).toBe("Pho");

    const bbqVerdict = extractDeterministic([msg("p1", "down for bbq", 1)], "food");
    expect(bbqVerdict.winner).toBe("BBQ");

    const pieVerdict = extractDeterministic([msg("p1", "let's do pie", 1)], "food");
    expect(pieVerdict.winner).toBe("Pie");

    const subVerdict = extractDeterministic([msg("p1", "want a sub", 1)], "food");
    expect(subVerdict.winner).toBe("Sub");

    const teaVerdict = extractDeterministic([msg("p1", "how about tea", 1)], "food");
    expect(teaVerdict.winner).toBe("Tea");

    // Boundary check: "steak" must not trigger "tea"
    const steakVerdict = extractDeterministic([msg("p1", "steak please", 1)], "food");
    expect(steakVerdict.winner).toBe("Steak");
    expect(steakVerdict.top3.map((o) => o.name)).toEqual(["Steak"]);
  });

  it("handles destination lexicon and open-vocabulary triggers", () => {
    const destVerdict = extractDeterministic(
      [
        msg("p1", "down for mini golf or dave & busters", 1),
        msg("p2", "dave and busters sounds great", 2),
      ],
      "destination",
    );
    expect(destVerdict.winner).toBe("Dave & Busters");
    expect(destVerdict.top3.map((o) => o.name)).toEqual(["Dave & Busters", "Mini Golf"]);

    const openVocab = extractDeterministic(
      [msg("p1", "craving tapas tonight", 1), msg("p2", "down for tapas", 2)],
      "food",
    );
    expect(openVocab.winner).toBe("Tapas");
    expect(openVocab.top3[0]?.supporters).toBe(2);
  });

  it("respects sign & direction symmetry across positive votes and clause-aware negations", () => {
    const positive = extractDeterministic([msg("p1", "I want burger", 1)], "food");
    expect(positive.winner).toBe("Burgers");
    expect(positive.vetoed).toEqual([]);
    expect(positive.top3[0]).toMatchObject({ name: "Burgers", supporters: 1, mentions: 1 });

    const negatedThenPositive = extractDeterministic(
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

    const mixedNegations = extractDeterministic(
      [
        msg("p1", "no sushi, anything but pizza", 1),
        msg("p2", "ramen instead of tacos", 2),
        msg("p3", "tired of pasta, skip wings", 3),
        msg("p4", "had steak yesterday", 4),
      ],
      "food",
    );
    expect(mixedNegations.winner).toBe("Ramen");
    const vetoedNames = mixedNegations.vetoed.map((v) => v.name);
    expect(vetoedNames).toEqual(
      expect.arrayContaining(["Sushi", "Pizza", "Tacos", "Pasta", "Wings", "Steak"]),
    );
  });

  it("picks an un-vetoed crowd-pleaser when every mentioned option is vetoed or in surprise mode", () => {
    const allVetoed = extractDeterministic(
      [msg("p1", "no ramen, no tacos", 1), msg("p2", "don't want burger", 2)],
      "food",
    );
    expect(allVetoed.winner).toBe("Thai");
    expect(allVetoed.top3).toEqual([]);
    expect(allVetoed.vetoed.map((v) => v.name)).toEqual(
      expect.arrayContaining(["Ramen", "Tacos", "Burgers"]),
    );

    const surprise = extractDeterministic(
      [msg("p1", "no ramen please", 1), msg("p2", "sushi sounds fine", 2)],
      "surprise",
    );
    expect(surprise.winner).toBe("Tacos");
    expect(surprise.summary).toContain("Surprise");
  });

  it("deduplicates single-speaker spam across messages and within one message", () => {
    const spamMessages = [
      msg("spammer", "burger", 1),
      msg("spammer", "burger", 2),
      msg("spammer", "burger", 3),
      msg("spammer", "burger", 4),
      msg("spammer", "burger", 5),
      msg("friend-a", "ramen", 6),
      msg("friend-b", "ramen", 7),
    ];

    const verdict = extractDeterministic(spamMessages, "food");
    expect(verdict.winner).toBe("Ramen");
    expect(verdict.duplicateDetected).toBe(true);
    expect(verdict.duplicateNote).toBe("Duplicate spam spotted — counted one vote per person.");

    const ramenEntry = verdict.top3.find((o) => o.name === "Ramen");
    const burgerEntry = verdict.top3.find((o) => o.name === "Burgers");
    expect(ramenEntry).toMatchObject({ name: "Ramen", supporters: 2, mentions: 2 });
    expect(burgerEntry).toMatchObject({ name: "Burgers", supporters: 1, mentions: 5 });

    const singleMessageSpam = extractDeterministic([msg("p1", "ramen ramen ramen!!", 1)], "food");
    expect(singleMessageSpam.duplicateDetected).toBe(true);
    expect(singleMessageSpam.top3[0]).toMatchObject({
      name: "Ramen",
      supporters: 1,
      mentions: 3,
    });
  });
});

describe("extractWithOllama & decideRoom", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks LLM-chosen vetoed options and merges deterministic spam detection", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            winner: "Burgers",
            summary: "Group leaned toward Burgers and Pho.",
            candidates: [
              { name: "Burgers", supporters: 3, quote: "burger" },
              { name: "Pho", supporters: 1, quote: "maybe pho" },
            ],
            vetoed: [],
          }),
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const messages = [msg("p1", "I don't want burger, maybe pho", 1), msg("p2", "pho pho", 2)];

    const verdict = await extractWithOllama(messages, "food", {
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3.5:9b",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(verdict.engineUsed).toBe("ollama");
    expect(verdict.winner).toBe("Pho");
    expect(verdict.top3.map((o) => o.name)).toEqual(["Pho"]);
    expect(verdict.vetoed.map((v) => v.name)).toContain("Burgers");
    expect(verdict.duplicateDetected).toBe(true);
    expect(verdict.mapsUrl).toContain("Pho");
  });

  it("falls back seamlessly to deterministic rules when Ollama fails or llmMode is rules", async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    vi.stubGlobal("fetch", failingFetch);

    const messages = [msg("p1", "kinda craving ramen or pho", 1), msg("p2", "ramen", 2)];

    const autoVerdict = await decideRoom(messages, "food", { llmMode: "auto" });
    expect(failingFetch).toHaveBeenCalledTimes(1);
    expect(autoVerdict.engineUsed).toBe("rules");
    expect(autoVerdict.winner).toBe("Ramen");

    failingFetch.mockClear();
    const rulesVerdict = await decideRoom(messages, "food", { llmMode: "rules" });
    expect(failingFetch).not.toHaveBeenCalled();
    expect(rulesVerdict.engineUsed).toBe("rules");
    expect(rulesVerdict.winner).toBe("Ramen");
  });
});
