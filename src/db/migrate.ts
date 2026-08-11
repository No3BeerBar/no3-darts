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
      legs_won integer NOT NULL DEFAULT 0,
      checkout_attempts integer NOT NULL DEFAULT 0
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS match_players_player_id_idx ON match_players (player_id)`;
  await sql`CREATE INDEX IF NOT EXISTS match_players_match_id_idx ON match_players (match_id)`;
}
