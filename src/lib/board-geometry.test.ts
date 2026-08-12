import { describe, expect, it } from "vitest";
import { BOARD_ORDER, boardAngleForNumber } from "@/engine/dart";
import {
  BOARD_R,
  CX,
  CY,
  VB,
  boardNumberAtAngle,
  clientToSvg,
  hitFromClient,
  hitFromSvg,
  normalizeAngleDeg,
  segmentCenter,
  segmentIndexForAngle,
  svgPointForPolar,
} from "./board-geometry";

describe("board-geometry polar mapping", () => {
  it("uses standard clockwise order with 20 at top", () => {
    expect(BOARD_ORDER).toEqual([
      20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
    ]);
    expect(boardAngleForNumber(20)).toBe(0);
    expect(boardAngleForNumber(1)).toBe(18);
    expect(boardAngleForNumber(6)).toBe(90);
    expect(boardAngleForNumber(3)).toBe(180);
    expect(boardAngleForNumber(11)).toBe(270);
    expect(boardAngleForNumber(5)).toBe(342);
  });

  it("maps known angles to the correct segment numbers", () => {
    expect(boardNumberAtAngle(0)).toBe(20);
    expect(boardNumberAtAngle(359)).toBe(20);
    // Wedge is [center-9, center+9): +9° belongs to the next segment
    expect(boardNumberAtAngle(8.999)).toBe(20);
    expect(boardNumberAtAngle(9)).toBe(1);
    expect(boardNumberAtAngle(10)).toBe(1);
    expect(boardNumberAtAngle(18)).toBe(1);
    expect(boardNumberAtAngle(90)).toBe(6);
    expect(boardNumberAtAngle(180)).toBe(3);
    expect(boardNumberAtAngle(270)).toBe(11);
    expect(boardNumberAtAngle(342)).toBe(5);
    expect(boardNumberAtAngle(90 - 9)).toBe(6);
    expect(boardNumberAtAngle(90 + 8.9)).toBe(6);
    expect(boardNumberAtAngle(90 + 9)).toBe(10);
  });

  it("scores treble ring at top as T20 (not T5 / neighbor)", () => {
    const top = svgPointForPolar(0, 0.59);
    const hit = hitFromSvg(top.x, top.y);
    expect(hit.label).toBe("T20");
    expect(hit.kind).toBe("triple");
    expect(hit.number).toBe(20);
    expect(hit.angleDeg).toBeCloseTo(0, 5);
  });

  it("scores right-side wedge as 6 (treble / single / double)", () => {
    const t = hitFromSvg(...pointArgs(90, 0.59));
    const s = hitFromSvg(...pointArgs(90, 0.75));
    const d = hitFromSvg(...pointArgs(90, 0.965));
    expect(t.label).toBe("T6");
    expect(s.label).toBe("S6");
    expect(d.label).toBe("D6");
  });

  it("scores every wedge center (triple) as its BOARD_ORDER number", () => {
    for (let i = 0; i < BOARD_ORDER.length; i++) {
      const num = BOARD_ORDER[i]!;
      const c = segmentCenter(i, 0.59);
      const hit = hitFromSvg(c.x, c.y);
      expect(hit.number).toBe(num);
      expect(hit.kind).toBe("triple");
      expect(hit.label).toBe(`T${num}`);
      expect(segmentIndexForAngle(hit.angleDeg)).toBe(i);
    }
  });

  it("keeps svgPointForPolar and segmentCenter on the same wedges", () => {
    for (let i = 0; i < 20; i++) {
      const fromPolar = svgPointForPolar(i * 18, 0.75);
      const fromCenter = segmentCenter(i, 0.75);
      expect(fromPolar.x).toBeCloseTo(fromCenter.x, 8);
      expect(fromPolar.y).toBeCloseTo(fromCenter.y, 8);
      expect(hitFromSvg(fromPolar.x, fromPolar.y).number).toBe(BOARD_ORDER[i]);
    }
  });

  it("scores bulls and outside-double as miss (not ghost single)", () => {
    expect(hitFromSvg(CX, CY).label).toBe("BULL");
    expect(hitFromSvg(CX + BOARD_R * 0.1, CY).label).toBe("25");
    const justOutside = hitFromSvg(CX, CY - BOARD_R * 1.02);
    expect(justOutside.kind).toBe("miss");
    expect(justOutside.label).toBe("MISS");
    const far = hitFromSvg(CX, CY - BOARD_R * 1.2);
    expect(far.kind).toBe("miss");
  });

  it("scores neighbors of 20 correctly near the top wire", () => {
    // Slightly clockwise of top → 1; slightly counter-clockwise → 5
    expect(hitFromSvg(...pointArgs(12, 0.75)).label).toBe("S1");
    expect(hitFromSvg(...pointArgs(348, 0.75)).label).toBe("S5");
    expect(hitFromSvg(...pointArgs(0, 0.75)).label).toBe("S20");
  });

  it("normalizes negative and >360 angles", () => {
    expect(normalizeAngleDeg(-18)).toBe(342);
    expect(normalizeAngleDeg(378)).toBe(18);
    expect(boardNumberAtAngle(-18)).toBe(5);
  });

  it("clientToSvg maps screen center to viewBox center with meet letterboxing", () => {
    const svg = {
      getBoundingClientRect: () => ({
        left: 100,
        top: 50,
        width: 200,
        height: 300, // taller than wide → horizontal content, vertical letterbox
        right: 300,
        bottom: 350,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      }),
      viewBox: { baseVal: { x: 0, y: 0, width: VB, height: VB } },
    } as unknown as SVGSVGElement;

    // Content is 200×200 meet-scaled, centered at (200, 200) in screen space
    const mid = clientToSvg(svg, 200, 200);
    expect(mid).toEqual({ x: 200, y: 200 });

    // Top-center of the drawn board (screen y = 200 - 100)
    const top = clientToSvg(svg, 200, 100);
    expect(top).not.toBeNull();
    expect(top!.x).toBeCloseTo(200, 5);
    expect(top!.y).toBeCloseTo(0, 5);
    expect(hitFromSvg(top!.x, CY - BOARD_R * 0.59).number).toBe(20);
  });

  it("clientToSvg + hitFromClient smoke: top treble is T20, right is T6 (not T5/S1)", () => {
    // Square board rect (post-#52 wrapper) — production iPad path
    const svg = {
      getBoundingClientRect: () => ({
        left: 40,
        top: 80,
        width: 360,
        height: 360,
        right: 400,
        bottom: 440,
        x: 40,
        y: 80,
        toJSON: () => ({}),
      }),
      viewBox: { baseVal: { x: 0, y: 0, width: VB, height: VB } },
    } as unknown as SVGSVGElement;

    const toClient = (angleDeg: number, radiusNorm: number) => {
      const p = svgPointForPolar(angleDeg, radiusNorm);
      const scale = 360 / VB;
      return {
        clientX: 40 + p.x * scale,
        clientY: 80 + p.y * scale,
      };
    };

    const topT = toClient(0, 0.59);
    const topHit = hitFromClient(svg, topT.clientX, topT.clientY);
    expect(topHit?.label).toBe("T20");

    const rightT = toClient(90, 0.59);
    const rightHit = hitFromClient(svg, rightT.clientX, rightT.clientY);
    expect(rightHit?.label).toBe("T6");

    // Neighbor of 20 must not steal top-center treble
    const nearFive = toClient(348, 0.59);
    expect(hitFromClient(svg, nearFive.clientX, nearFive.clientY)?.label).toBe(
      "T5",
    );
  });

  it("clientToSvg wide letterbox still maps top to 20 (not 5)", () => {
    const svg = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 400,
        height: 200, // wider than tall → vertical content, horizontal letterbox
        right: 400,
        bottom: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
      viewBox: { baseVal: { x: 0, y: 0, width: VB, height: VB } },
    } as unknown as SVGSVGElement;

    // Content 200×200 meet, origin (100, 0); top of board at screen (200, 0)
    const top = clientToSvg(svg, 200, 0);
    expect(top).not.toBeNull();
    expect(top!.x).toBeCloseTo(200, 5);
    expect(top!.y).toBeCloseTo(0, 5);
    const trebleY = CY - BOARD_R * 0.59;
    const trebleScreenY = 0 + trebleY * (200 / VB);
    const hit = hitFromClient(svg, 200, trebleScreenY);
    expect(hit?.label).toBe("T20");
  });
});

function pointArgs(angleDeg: number, radiusNorm: number): [number, number] {
  const p = svgPointForPolar(angleDeg, radiusNorm);
  return [p.x, p.y];
}
