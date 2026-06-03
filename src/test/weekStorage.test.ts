import { describe, expect, it, beforeEach } from "vitest";
import {
  loadZile,
  saveZile,
  clearZile,
  calculSaptamana,
  calculZi,
  applyImportedDay,
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

// ─── Persistence of imported ride days (applyImportedDay + save/load) ──────────
// Reproduces the "Aplică ziua" → refresh flow at the data layer: the apply merge
// must update the same zile array and survive a save -> load round-trip.

describe("applyImportedDay + persistence after import", () => {
  it("appends a new imported day with Screenshot source and the given totals", () => {
    const next = applyImportedDay([], {
      data: "2026-05-16",
      platforma: "Bolt",
      brut: 61.6,
      curse: 2,
      observatii: "Import OCR: 2 curse",
    });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      data: "2026-05-16",
      platforma: "Bolt",
      brut: 61.6,
      curse: 2,
      sursa: "Screenshot",
      observatii: "Import OCR: 2 curse",
    });
    expect(next[0].id).toBe("2026-05-16");
  });

  it("updates an existing day but preserves manual ore/km/fuel, id and (absent) notes", () => {
    const existing: ZiData = {
      id: "uid-1", data: "2026-05-16", platforma: "Uber",
      brut: 10, curse: 1, ore: 5, km: 40, combustibil: 30,
      observatii: "manual note", sursa: "Manual",
    };
    const [next] = applyImportedDay([existing], {
      data: "2026-05-16", platforma: "Bolt", brut: 61.6, curse: 2,
    });
    expect(next.id).toBe("uid-1");          // original id preserved
    expect(next.platforma).toBe("Bolt");    // overwritten by import
    expect(next.brut).toBe(61.6);
    expect(next.curse).toBe(2);
    expect(next.sursa).toBe("Screenshot");
    expect(next.ore).toBe(5);               // manual fields preserved
    expect(next.km).toBe(40);
    expect(next.combustibil).toBe(30);
    expect(next.observatii).toBe("manual note"); // kept when import omits notes
  });

  it("leaves other days untouched and returns a new array reference", () => {
    const other = makeZi({ id: "2026-05-10", data: "2026-05-10", brut: 100, curse: 4 });
    const before = [other];
    const after = applyImportedDay(before, {
      data: "2026-05-16", platforma: "Bolt", brut: 61.6, curse: 2,
    });
    expect(after).not.toBe(before);
    expect(after).toHaveLength(2);
    expect(after.find((z) => z.data === "2026-05-10")).toEqual(other);
  });

  it("survives a save -> load round-trip preserving platform, brut, curse, observatii", () => {
    const applied = applyImportedDay([], {
      data: "2026-05-16", platforma: "Bolt", brut: 61.6, curse: 2,
      observatii: "Import OCR: 2 curse",
    });
    saveZile(applied);            // what Index.commitZile does on apply
    const reloaded = loadZile();  // what a page refresh does
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toMatchObject({
      data: "2026-05-16", platforma: "Bolt", brut: 61.6, curse: 2,
      observatii: "Import OCR: 2 curse", sursa: "Screenshot",
    });
  });

  it("accumulates multiple applied days and round-trips all of them", () => {
    let zile: ZiData[] = [];
    zile = applyImportedDay(zile, { data: "2026-05-10", platforma: "Bolt", brut: 143.6, curse: 6 });
    zile = applyImportedDay(zile, { data: "2026-05-12", platforma: "Bolt", brut: 56.2, curse: 1 });
    saveZile(zile);
    const reloaded = loadZile();
    expect(reloaded.map((z) => `${z.data}:${z.brut}:${z.curse}`).sort()).toEqual([
      "2026-05-10:143.6:6",
      "2026-05-12:56.2:1",
    ]);
  });

  it("re-applying the same day overwrites in place (no duplicate rows)", () => {
    let zile = applyImportedDay([], { data: "2026-05-16", platforma: "Bolt", brut: 20, curse: 1 });
    zile = applyImportedDay(zile, { data: "2026-05-16", platforma: "Bolt", brut: 61.6, curse: 2 });
    expect(zile).toHaveLength(1);
    expect(zile[0].brut).toBe(61.6);
    expect(zile[0].curse).toBe(2);
  });
});
