import { describe, expect, it, beforeEach } from "vitest";
import {
  loadZile,
  saveZile,
  clearZile,
  calculSaptamana,
  calculZi,
  CONFIG,
  ZiData,
} from "@/lib/weekStorage";

function makeZi(partial: Partial<ZiData>): ZiData {
  return {
    id: "2026-05-10",
    data: "2026-05-10",
    platforma: "Uber",
    brut: 0,
    curse: 0,
    ore: 0,
    km: undefined,
    combustibil: 0,
    observatii: "",
    sursa: "Manual",
    ...partial,
  };
}

beforeEach(() => {
  localStorage.clear();
});

// ─── localStorage safety ──────────────────────────────────────────────────────

describe("localStorage safety", () => {
  it("returns [] when nothing stored", () => {
    expect(loadZile()).toEqual([]);
  });

  it("returns [] on corrupt JSON instead of throwing", () => {
    localStorage.setItem("analiza-saptamana-uber-bolt-v1", "{not json");
    expect(() => loadZile()).not.toThrow();
    expect(loadZile()).toEqual([]);
  });

  it("returns [] when stored value is not an array", () => {
    localStorage.setItem("analiza-saptamana-uber-bolt-v1", JSON.stringify({ foo: "bar" }));
    expect(loadZile()).toEqual([]);
  });

  it("drops records without a valid date", () => {
    localStorage.setItem(
      "analiza-saptamana-uber-bolt-v1",
      JSON.stringify([{ brut: 100 }, { data: "not-a-date", brut: 50 }]),
    );
    expect(loadZile()).toEqual([]);
  });

  it("coerces invalid platform/source to safe defaults and bad numbers to 0", () => {
    localStorage.setItem(
      "analiza-saptamana-uber-bolt-v1",
      JSON.stringify([
        { data: "2026-05-10", platforma: "Lyft", sursa: "Hack", brut: "abc", curse: -5, ore: 6 },
      ]),
    );
    const [z] = loadZile();
    expect(z.platforma).toBe("Uber");
    expect(z.sursa).toBe("Manual");
    expect(z.brut).toBe(0);
    expect(z.curse).toBe(0);
    expect(z.ore).toBe(6);
  });

  it("round-trips valid data through save/load", () => {
    const zile = [makeZi({ brut: 245.63, curse: 14, ore: 6.5 })];
    saveZile(zile);
    const loaded = loadZile();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].brut).toBe(245.63);
    expect(loaded[0].curse).toBe(14);
  });

  it("clearZile empties storage", () => {
    saveZile([makeZi({ brut: 100 })]);
    clearZile();
    expect(loadZile()).toEqual([]);
  });
});

// ─── Weekly calculation correctness ───────────────────────────────────────────

describe("weekly calculation", () => {
  it("computes per-day profit with platform + fleet commission, fuel, rent share", () => {
    // brut 1000, Uber 25% platform → 250, ramas 750
    // fleet 10% of 750 → 75, fuel 100
    // profit before rent = 750 - 75 - 100 = 575
    // rent share = 500/7 ≈ 71.43 → after rent ≈ 503.57
    const c = calculZi(makeZi({ brut: 1000, combustibil: 100, ore: 10, curse: 10 }));
    expect(c.comPlat).toBeCloseTo(250);
    expect(c.ramas).toBeCloseTo(750);
    expect(c.comFlota).toBeCloseTo(75);
    expect(c.profitInainteChirie).toBeCloseTo(575);
    expect(c.profitDupaChirie).toBeCloseTo(575 - CONFIG.chirie / 7);
  });

  it("weekly net subtracts the full rent once across all days", () => {
    const zile = [
      makeZi({ id: "a", data: "2026-05-10", brut: 500, combustibil: 50, ore: 5, curse: 5 }),
      makeZi({ id: "b", data: "2026-05-11", brut: 500, combustibil: 50, ore: 5, curse: 5 }),
    ];
    const s = calculSaptamana(zile);
    // brut 1000; platform 25% → 250; ramas 750; fleet 10% → 75; fuel 100; rent 500
    // net = 1000 - 250 - 75 - 100 - 500 = 75
    expect(s.brutTotal).toBe(1000);
    expect(s.comPlatTotal).toBeCloseTo(250);
    expect(s.comFlotaTotal).toBeCloseTo(75);
    expect(s.profitNet).toBeCloseTo(75);
  });

  it("derived per-hour / per-ride metrics handle zero safely", () => {
    const s = calculSaptamana([]);
    expect(s.profitPeOra).toBe(0);
    expect(s.profitPeCursa).toBe(0);
    expect(s.profitNet).toBeCloseTo(-CONFIG.chirie);
  });
});
