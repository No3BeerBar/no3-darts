import type { GameModeId } from "@/engine";

/** One short headed block inside the How to play sheet. */
export interface HowToPlaySection {
  title: string;
  body: string;
}

/** Patron-facing rules for a single game mode (matches the scoring engine). */
export interface HowToPlayGuide {
  mode: GameModeId;
  title: string;
  /** One-line blurb under the title */
  summary: string;
  sections: HowToPlaySection[];
}

/**
 * Plain-English How to play copy for every mode the tablet offers.
 * Keep in sync with `src/engine/modes/*` — especially Baseball, 41, and Killer (John rules).
 */
export const HOW_TO_PLAY: Record<GameModeId, HowToPlayGuide> = {
  x01: {
    mode: "x01",
    title: "X01",
    summary: "Race from 301 / 501 / 701 / 901 down to exactly zero.",
    sections: [
      {
        title: "Goal",
        body: "Start at the chosen score (usually 501). Each visit subtracts what you hit. First to reach exactly 0 wins the leg.",
      },
      {
        title: "How scoring works",
        body: "Singles, doubles, and triples count at face value (e.g. T20 = 60). Three darts per turn. If you go below 0, or leave 1 when double-out is on, that visit busts — your score snaps back and the turn ends.",
      },
      {
        title: "How you win",
        body: "Hit exactly 0. With double-out (the usual bar rule here), the dart that finishes must be a double or the bullseye (50). Legs and sets follow whatever match format you picked at setup.",
      },
      {
        title: "Examples",
        body: "On 40 with double-out: hit D20 → game shot. On 32: D16. Bust example: on 18, a T20 goes past zero → score resets for that visit.",
      },
      {
        title: "Special rules",
        body: "Double-in (optional): you score nothing until you hit a double (bullseye counts). Straight-out turns double-out off so any dart can finish on exact 0. The tablet shows an outshot hint when you’re in finish range.",
      },
    ],
  },

  cricket: {
    mode: "cricket",
    title: "Cricket",
    summary: "Close 20–15 and bull, then score on numbers opponents still have open.",
    sections: [
      {
        title: "Goal",
        body: "Own the cricket numbers: 20, 19, 18, 17, 16, 15, and bull. Close each with 3 marks, then rack up points (standard) or force points onto others (cut-throat).",
      },
      {
        title: "How scoring works",
        body: "Marks: single = 1, double = 2, triple = 3. Outer bull = 1 mark, bullseye = 2. Once you’ve closed a number, extra marks score that number’s value — but only while an opponent still has it open (standard). In cut-throat, extras add points to opponents who haven’t closed that number yet (low score wins).",
      },
      {
        title: "How you win",
        body: "Close every number, then have the best points total vs everyone else — highest in standard, lowest in cut-throat.",
      },
      {
        title: "Examples",
        body: "Hit T20 with no marks yet → that number is closed in one dart. Later, with 20 closed and an opponent still open on 20, another S20 scores 20 points (standard).",
      },
    ],
  },

  shanghai: {
    mode: "shanghai",
    title: "Shanghai",
    summary: "Each round only the round number scores — land S+D+T for an instant win.",
    sections: [
      {
        title: "Goal",
        body: "Score on the current round’s number (round 1 → 1s, round 7 → 7s, …). Highest total after the last round wins — unless someone hits a Shanghai.",
      },
      {
        title: "How scoring works",
        body: "Only singles, doubles, and triples of the round number count (face value). Wrong number, miss, or bull = 0 for that dart.",
      },
      {
        title: "How you win",
        body: "Shanghai: in one visit, hit a single and a double and a triple of the target → instant win. Otherwise highest score after round 20 (default) wins.",
      },
      {
        title: "Examples",
        body: "Round 5: S5 + D5 + T5 in the same visit → Shanghai! Round 4: T4 alone adds 12.",
      },
    ],
  },

  baseball: {
    mode: "baseball",
    title: "Baseball",
    summary: "Nine innings — only the inning number scores. Highest total wins.",
    sections: [
      {
        title: "Goal",
        body: "Play 9 innings. Everyone throws one 3-dart visit per inning. Pile up the most points.",
      },
      {
        title: "How scoring works",
        body: "The target is the inning number. Only that number scores: single = N, double = 2×N, triple = 3×N. Wrong number, miss, outer bull, or bullseye = 0.",
      },
      {
        title: "How you win",
        body: "After inning 9, highest total wins.",
      },
      {
        title: "Examples",
        body: "Inning 4: S4 = 4, D4 = 8, T4 = 12. A 20 or the bull in inning 4 scores nothing. Inning 9: T9 = 27.",
      },
      {
        title: "Special rules",
        body: "John’s house rule: bull never scores in Baseball — only hits on the current inning number.",
      },
    ],
  },

  forty_one: {
    mode: "forty_one",
    title: "41",
    summary: "Start at 60. Hit each round’s target — or get halved. Exact 41: go over and the visit ends now.",
    sections: [
      {
        title: "Goal",
        body: "Begin at 60. Work through 10 fixed rounds and finish with the highest score.",
      },
      {
        title: "How scoring works",
        body: "Round order: 20 → 19 → any double → 18 → 17 → any triple → 16 → 15 → exact 41 → bulls. Valid hits add their face points. Miss the target with all 3 darts → your score is halved (rounded up).",
      },
      {
        title: "How you win",
        body: "Highest score after the bull round wins.",
      },
      {
        title: "Examples",
        body: "On 20s with 60: hit S20 + miss + miss → score becomes 80. Miss all three → 60 halves to 30. Exact-41: three scoring darts that sum to exactly 41 (e.g. T7 + S13 + S7) → add +41. A miss in that visit voids it even if the other two add to 41. Go over 41 (e.g. T19 first dart) and the visit ends immediately — no darts 2 and 3.",
      },
      {
        title: "Special rules",
        body: "Any double includes D1–D20 or the bullseye (50); outer bull (25) does not count as a double. Any triple is T1–T20 only. Exact 41: all 3 darts must contribute (no miss / zero), sum exactly 41, then you gain +41 — otherwise halve. Going over 41 busts the visit immediately (same as an X01 bust).",
      },
    ],
  },

  countup: {
    mode: "countup",
    title: "Count-Up",
    summary: "Add every dart. Highest score after the set number of turns wins.",
    sections: [
      {
        title: "Goal",
        body: "Throw a fixed number of turns (default 8 × 3 darts) and score as many points as you can.",
      },
      {
        title: "How scoring works",
        body: "Every dart’s face value adds to your total. Misses add 0.",
      },
      {
        title: "How you win",
        body: "When everyone has finished their turns, highest score wins.",
      },
      {
        title: "Examples",
        body: "T20 + T20 + T20 in one visit = 180. Great for warming up or racing kids/guests.",
      },
    ],
  },

  around_the_clock: {
    mode: "around_the_clock",
    title: "Around the Clock",
    summary: "Hit 1 through 20 in order (then bull). First to finish wins.",
    sections: [
      {
        title: "Goal",
        body: "Advance through the numbers in order. Default: 1 → 20, then the bull.",
      },
      {
        title: "How scoring works",
        body: "You only advance when you hit the next target. Singles, doubles, and triples of that number all count (unless setup requires doubles). For bull, outer or inner counts unless doubles-only is on (then bullseye only).",
      },
      {
        title: "How you win",
        body: "First player to hit the final target wins — it’s a race, not high score.",
      },
      {
        title: "Examples",
        body: "Need 7: any S7 / D7 / T7 moves you to 8. Need bull at the end: hit 25 or 50.",
      },
    ],
  },

  bermuda: {
    mode: "bermuda",
    title: "Bermuda",
    summary: "Hit each island’s target or lose points for that round.",
    sections: [
      {
        title: "Goal",
        body: "Survive 13 “islands” (targets). Score when you hit; miss all three and you lose points.",
      },
      {
        title: "How scoring works",
        body: "Sequence: 12, 13, 14, any double, 15, 16, 17, any triple, 18, 19, 20, bull, then double-bull (50 only). Hits on the target add. Miss the whole visit → a penalty comes off your score (floored at 0).",
      },
      {
        title: "How you win",
        body: "Highest score after the last island wins.",
      },
      {
        title: "Examples",
        body: "On 15s: two S15s add 30. Miss all three on a number island → lose that number × 3. Miss all on any-double → lose 40.",
      },
    ],
  },

  random_checkout: {
    mode: "random_checkout",
    title: "Random Checkout",
    summary: "Practice random finishes — double-out, most checkouts win.",
    sections: [
      {
        title: "Goal",
        body: "The tablet gives you a random remaining score. Finish it on a double (or bull). Most successful checkouts after your attempts wins.",
      },
      {
        title: "How scoring works",
        body: "Same checkout rules as X01 double-out: bust under 0, leave 1, or finish on a non-double and the attempt fails. After a failed 3-dart visit you get a new random score — no carrying a partial leave.",
      },
      {
        title: "How you win",
        body: "Most checkouts hit when everyone’s attempts are done (default 10 each).",
      },
      {
        title: "Examples",
        body: "Drawn 40 → D20 wins the attempt. Drawn 32 → D16. Bust or miss the out → that attempt is done; next random score appears.",
      },
    ],
  },

  killer: {
    mode: "killer",
    title: "Killer",
    summary: "Classic pub Killer — arm and kill on doubles only.",
    sections: [
      {
        title: "Goal",
        body: "Each player claims a unique number 1–20 and starts with lives (usually 3). Last player with lives wins.",
      },
      {
        title: "How scoring works",
        body: "Only doubles count. Hit the double of your own number to become Killer (armed). Once armed, hit an opponent’s double to take one of their lives. Hit your own double again while Killer and you lose a life yourself.",
      },
      {
        title: "How you win",
        body: "Eliminate everyone else. Last life standing wins. If the last players wipe each other out together, it’s a draw.",
      },
      {
        title: "Examples",
        body: "Your number is 16: hit D16 → you’re Killer. Opponent on 8: hit D8 → they lose a life. S16 or T16 does nothing — doubles only.",
      },
      {
        title: "Special rules",
        body: "Bullseye does not arm or kill. Singles and triples never count. Pick numbers carefully at setup (weak-hand claim is a common house twist — follow the bar).",
      },
    ],
  },
};

export function getHowToPlay(mode: GameModeId): HowToPlayGuide {
  return HOW_TO_PLAY[mode];
}

export function howToPlayModeLabel(mode: GameModeId): string {
  return HOW_TO_PLAY[mode].title;
}
