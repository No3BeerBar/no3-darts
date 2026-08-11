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

export type DbPlayer = typeof players.$inferSelect;
export type NewDbPlayer = typeof players.$inferInsert;
