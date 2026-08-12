import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Registered walk-up players (name + PIN). Stats live on the row for fast reads. */
export const players = pgTable(
  "players",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Lowercased trimmed name for case-insensitive uniqueness */
    nameNormalized: text("name_normalized").notNull(),
    pinHash: text("pin_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    failedPinAttempts: integer("failed_pin_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    matchesPlayed: integer("matches_played").notNull().default(0),
    matchesWon: integer("matches_won").notNull().default(0),
    legsWon: integer("legs_won").notNull().default(0),
    dartsThrown: integer("darts_thrown").notNull().default(0),
    totalScore: integer("total_score").notNull().default(0),
    oneEighties: integer("one_eighties").notNull().default(0),
    checkoutsHit: integer("checkouts_hit").notNull().default(0),
    checkoutAttempts: integer("checkout_attempts").notNull().default(0),
    highestCheckout: integer("highest_checkout").notNull().default(0),
    bestThreeDartAvg: doublePrecision("best_three_dart_avg").notNull().default(0),
  },
  (t) => [uniqueIndex("players_name_normalized_uidx").on(t.nameNormalized)]
);

/**
 * Finished matches persisted server-side.
 * `finishedAt` + match_players enable personal history and future weekly boards.
 */
export const matches = pgTable(
  "matches",
  {
    id: text("id").primaryKey(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    mode: text("mode").notNull(),
    modeLabel: text("mode_label").notNull(),
    winnerPlayerId: text("winner_player_id"),
    winnerName: text("winner_name"),
    legs: integer("legs").notNull().default(1),
    sets: integer("sets").notNull().default(1),
    /** Compact summary / optional full state for export */
    summaryJson: jsonb("summary_json").notNull().default({}),
  },
  (t) => [
    index("matches_finished_at_idx").on(t.finishedAt),
    index("matches_mode_idx").on(t.mode),
  ]
);

export const matchPlayers = pgTable(
  "match_players",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    /** Null for guests — no server account */
    playerId: text("player_id").references(() => players.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    isGuest: boolean("is_guest").notNull().default(false),
    avg: doublePrecision("avg").notNull().default(0),
    oneEighties: integer("one_eighties").notNull().default(0),
    checkouts: integer("checkouts").notNull().default(0),
    highestCheckout: integer("highest_checkout").notNull().default(0),
    dartsThrown: integer("darts_thrown").notNull().default(0),
    totalScore: integer("total_score").notNull().default(0),
    /** Finishing score for the match (high-score modes: Baseball, 41, …) */
    finalScore: integer("final_score").notNull().default(0),
    legsWon: integer("legs_won").notNull().default(0),
    checkoutAttempts: integer("checkout_attempts").notNull().default(0),
  },
  (t) => [
    index("match_players_player_id_idx").on(t.playerId),
    index("match_players_match_id_idx").on(t.matchId),
  ]
);

/** Single-elim tournament header + flexible match format JSON. */
export const tournaments = pgTable(
  "tournaments",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** TournamentFormat JSON */
    formatJson: jsonb("format_json").notNull().default({}),
  },
  (t) => [index("tournaments_status_idx").on(t.status), index("tournaments_created_at_idx").on(t.createdAt)]
);

/** Event roster — registered PIN players and/or guest names (guests = event-only). */
export const tournamentPlayers = pgTable(
  "tournament_players",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    isGuest: boolean("is_guest").notNull().default(true),
    registeredPlayerId: text("registered_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    seed: integer("seed").notNull().default(0),
  },
  (t) => [
    index("tournament_players_tournament_id_idx").on(t.tournamentId),
    index("tournament_players_registered_player_id_idx").on(t.registeredPlayerId),
  ]
);

export const tournamentMatches = pgTable(
  "tournament_matches",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    roundIndex: integer("round_index").notNull(),
    roundName: text("round_name").notNull(),
    bracketSlot: integer("bracket_slot").notNull(),
    playerAId: text("player_a_id"),
    playerBId: text("player_b_id"),
    status: text("status").notNull().default("pending"),
    winnerId: text("winner_id"),
    lane: text("lane"),
    liveGameId: text("live_game_id"),
    nextMatchId: text("next_match_id"),
    nextMatchSlot: text("next_match_slot"),
    legsWonA: integer("legs_won_a").notNull().default(0),
    legsWonB: integer("legs_won_b").notNull().default(0),
  },
  (t) => [
    index("tournament_matches_tournament_id_idx").on(t.tournamentId),
    index("tournament_matches_status_idx").on(t.status),
    index("tournament_matches_lane_idx").on(t.lane),
  ]
);

/**
 * Timed challenge definitions synced from No3Passport (or admin).
 * Progress is scored in darts at match persist; Passport reads standings.
 */
export const challenges = pgTable(
  "challenges",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** active | closed */
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("challenges_status_idx").on(t.status),
    index("challenges_starts_at_idx").on(t.startsAt),
    index("challenges_ends_at_idx").on(t.endsAt),
  ]
);

export const challengeGoals = pgTable(
  "challenge_goals",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    ruleType: text("rule_type").notNull(),
    paramsJson: jsonb("params_json").notNull().default({}),
    points: integer("points").notNull().default(0),
    /** once | every */
    stack: text("stack").notNull().default("every"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("challenge_goals_challenge_id_idx").on(t.challengeId)]
);

/** Cumulative points per registered player for a challenge. */
export const challengeProgress = pgTable(
  "challenge_progress",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    points: integer("points").notNull().default(0),
    /** Aggregated credit breakdown JSON */
    breakdownJson: jsonb("breakdown_json").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("challenge_progress_challenge_player_uidx").on(t.challengeId, t.playerId),
    index("challenge_progress_challenge_id_idx").on(t.challengeId),
    index("challenge_progress_player_id_idx").on(t.playerId),
  ]
);

/**
 * Idempotency ledger: one credit row per (match, challenge, player).
 * Prevents double-scoring when persist is retried.
 */
export const challengeMatchCredits = pgTable(
  "challenge_match_credits",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id").notNull(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    points: integer("points").notNull().default(0),
    creditsJson: jsonb("credits_json").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("challenge_match_credits_uidx").on(t.matchId, t.challengeId, t.playerId),
    index("challenge_match_credits_challenge_id_idx").on(t.challengeId),
    index("challenge_match_credits_match_id_idx").on(t.matchId),
  ]
);

export type DbPlayer = typeof players.$inferSelect;
export type NewDbPlayer = typeof players.$inferInsert;
export type DbTournament = typeof tournaments.$inferSelect;
export type DbTournamentPlayer = typeof tournamentPlayers.$inferSelect;
export type DbTournamentMatch = typeof tournamentMatches.$inferSelect;
export type DbChallenge = typeof challenges.$inferSelect;
export type DbChallengeGoal = typeof challengeGoals.$inferSelect;
export type DbChallengeProgress = typeof challengeProgress.$inferSelect;
