import { describe, expect, it } from "vitest";
import { filterPlayersByName } from "./filter-players";

describe("filterPlayersByName", () => {
  const players = [
    { id: "1", name: "John" },
    { id: "2", name: "Mike" },
    { id: "3", name: "johnny" },
    { id: "4", name: "Alice" },
  ];

  it("returns all sorted when query is empty", () => {
    expect(filterPlayersByName(players, "").map((p) => p.name)).toEqual([
      "Alice",
      "John",
      "johnny",
      "Mike",
    ]);
  });

  it("filters by case-insensitive substring", () => {
    expect(filterPlayersByName(players, "jo").map((p) => p.name)).toEqual([
      "John",
      "johnny",
    ]);
    expect(filterPlayersByName(players, "MIKE").map((p) => p.id)).toEqual(["2"]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterPlayersByName(players, "zzz")).toEqual([]);
  });
});
