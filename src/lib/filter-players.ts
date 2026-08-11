/**
 * Type-ahead filter for the Saved players picker (50–200 names).
 * Case-insensitive substring match on display name; stable alphabetical order.
 */

export type NamedPlayer = { id: string; name: string };

export function filterPlayersByName<T extends NamedPlayer>(
  players: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  const list = q
    ? players.filter((p) => p.name.toLowerCase().includes(q))
    : [...players];
  return list.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}
