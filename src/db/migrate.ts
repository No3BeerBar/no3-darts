import type postgres from "postgres";

/** Idempotent DDL so Railway works without a separate migrate job. */
export async function ensureSchema(sql: ReturnType<typeof postgres>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS players (
      id text PRIMARY KEY,
      name text NOT NULL,
      name_normalized text NOT NULL,
      pin_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      failed_pin_attempts integer NOT NULL DEFAULT 0,
      locked_until timestamptz,
      matches_played integer NOT NULL DEFAULT 0,
      matches_won integer NOT NULL DEFAULT 0,
      legs_won integer NOT NULL DEFAULT 0,
      darts_thrown integer NOT NULL DEFAULT 0,
      total_score integer NOT NULL DEFAULT 0,
      one_eighties integer NOT NULL DEFAULT 0,
      checkouts_hit integer NOT NULL DEFAULT 0,
      checkout_attempts integer NOT NULL DEFAULT 0,
      highest_checkout integer NOT NULL DEFAULT 0,
      best_three_dart_avg double precision NOT NULL DEFAULT 0
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS players_name_normalized_uidx ON players (name_normalized)`;

  await sql`
    CREATE TABLE IF NOT EXISTS matches (
      id text PRIMARY KEY,
      finished_at timestamptz NOT NULL,
      mode text NOT NULL,
      mode_label text NOT NULL,
      winner_player_id text,
      winner_name text,
      legs integer NOT NULL DEFAULT 1,
      sets integer NOT NULL DEFAULT 1,
      summary_json jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS matches_finished_at_idx ON matches (finished_at)`;
  await sql`CREATE INDEX IF NOT EXISTS matches_mode_idx ON matches (mode)`;

  await sql`
    CREATE TABLE IF NOT EXISTS match_players (
      id text PRIMARY KEY,
      match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      player_id text REFERENCES players(id) ON DELETE SET NULL,
      name text NOT NULL,
      is_guest boolean NOT NULL DEFAULT false,
      avg double precision NOT NULL DEFAULT 0,
      one_eighties integer NOT NULL DEFAULT 0,
      checkouts integer NOT NULL DEFAULT 0,
      highest_checkout integer NOT NULL DEFAULT 0,
      darts_thrown integer NOT NULL DEFAULT 0,
      total_score integer NOT NULL DEFAULT 0,
      final_score integer NOT NULL DEFAULT 0,
      legs_won integer NOT NULL DEFAULT 0,
      checkout_attempts integer NOT NULL DEFAULT 0
    )
  `;
  // Idempotent upgrade for existing DBs created before final_score
  await sql`ALTER TABLE match_players ADD COLUMN IF NOT EXISTS final_score integer NOT NULL DEFAULT 0`;
  await sql`CREATE INDEX IF NOT EXISTS match_players_player_id_idx ON match_players (player_id)`;
  await sql`CREATE INDEX IF NOT EXISTS match_players_match_id_idx ON match_players (match_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS tournaments (
      id text PRIMARY KEY,
      name text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      format_json jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS tournaments_status_idx ON tournaments (status)`;
  await sql`CREATE INDEX IF NOT EXISTS tournaments_created_at_idx ON tournaments (created_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS tournament_players (
      id text PRIMARY KEY,
      tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      display_name text NOT NULL,
      is_guest boolean NOT NULL DEFAULT true,
      registered_player_id text REFERENCES players(id) ON DELETE SET NULL,
      seed integer NOT NULL DEFAULT 0
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS tournament_players_tournament_id_idx ON tournament_players (tournament_id)`;
  await sql`CREATE INDEX IF NOT EXISTS tournament_players_registered_player_id_idx ON tournament_players (registered_player_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS tournament_matches (
      id text PRIMARY KEY,
      tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      round_index integer NOT NULL,
      round_name text NOT NULL,
      bracket_slot integer NOT NULL,
      player_a_id text,
      player_b_id text,
      status text NOT NULL DEFAULT 'pending',
      winner_id text,
      lane text,
      live_game_id text,
      next_match_id text,
      next_match_slot text,
      legs_won_a integer NOT NULL DEFAULT 0,
      legs_won_b integer NOT NULL DEFAULT 0
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS tournament_matches_tournament_id_idx ON tournament_matches (tournament_id)`;
  await sql`CREATE INDEX IF NOT EXISTS tournament_matches_status_idx ON tournament_matches (status)`;
  await sql`CREATE INDEX IF NOT EXISTS tournament_matches_lane_idx ON tournament_matches (lane)`;
}
