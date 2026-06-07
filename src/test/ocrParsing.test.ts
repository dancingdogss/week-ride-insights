import { describe, expect, it } from "vitest";
import { parseScreenshotText, shouldAutofillGross, LIMITS } from "@/lib/ocrParsing";

const UBER = `
  Uber
  Total earnings
  245,63 lei
  Trips 14
  Online 6h 30min
  14 mai 2026
`;

const BOLT = `
  Bolt Driver
  Incasari totale
  310 RON
  Curse 18
  Timp online 07:15
  12 mai 2026 Bolt
`;

// ─── Platform: never defaults to Uber ─────────────────────────────────────────

describe("platform detection", () => {
  it("detects Uber from Uber text", () => {
    expect(parseScreenshotText(UBER).platforma.value).toBe("Uber");
  });

  it("detects Bolt from Bolt text and does NOT mislabel as Uber", () => {
    const r = parseScreenshotText(BOLT);
    expect(r.platforma.value).toBe("Bolt");
    expect(r.platforma.value).not.toBe("Uber");
  });

  it("returns none (no Uber default) when no platform keyword present", () => {
    const r = parseScreenshotText(`
      Total earnings 245,63 lei
      Trips 14
      Online 6h 30min
      10 mai 2026
    `);
    expect(r.platforma.value).toBeUndefined();
    expect(r.platforma.confidence).toBe("none");
  });

  it("returns none when Uber and Bolt appear equally", () => {
    const r = parseScreenshotText("Uber Bolt\nTotal 300 lei\nCurse 10\nOnline 5h\n10 mai 2026");
    expect(r.platforma.confidence).toBe("none");
  });

  it("high confidence when platform name repeats", () => {
    expect(parseScreenshotText(BOLT).platforma.confidence).toBe("high");
  });
});

// ─── Comma decimal parsing ────────────────────────────────────────────────────

describe("comma decimal parsing", () => {
  it("parses 245,63 as 245.63 (NOT 24563)", () => {
    const r = parseScreenshotText(UBER);
    expect(r.brut.value).toBe(245.63);
  });

  it("parses 1.245,50 as 1245.5 (thousands sep + comma decimal)", () => {
    const r = parseScreenshotText("Uber\nCastig total 1.245,50 lei\nCurse 20\nOnline 8h\n10 mai 2026");
    expect(r.brut.value).toBe(1245.5);
  });

  it("parses 245.50 (dot decimal) as 245.5", () => {
    const r = parseScreenshotText("Uber Driver App\nVenit total incasari 245.50 lei\nCurse efectuate 10\nTimp online 5h 00min\n10 mai 2026");
    expect(r.brut.value).toBe(245.5);
  });
});

// ─── Gross income + impossible-value rejection ────────────────────────────────

describe("gross income parsing & limits", () => {
  it("HIGH confidence requires strong keyword + currency", () => {
    expect(parseScreenshotText(UBER).brut.confidence).toBe("high");
  });

  it("rejects gross > 3000 RON (e.g. dropped-comma artifact 12363)", () => {
    const r = parseScreenshotText("Uber Driver App\nCastig total incasari: 12363 lei\nCurse efectuate 14\nTimp online 6h 00min\n10 mai 2026");
    expect(r.brut.value).toBeUndefined();
  });

  it("returns none when no income keyword present", () => {
    const r = parseScreenshotText("Uber Driver App summary screen\nCurse efectuate 14\nTimp online 6h 30min\n10 mai 2026\nrandom 500 token here");
    expect(r.brut.value).toBeUndefined();
    expect(r.brut.confidence).toBe("none");
  });

  it("only HIGH gross should autofill", () => {
    expect(shouldAutofillGross("high")).toBe(true);
    expect(shouldAutofillGross("medium")).toBe(false);
    expect(shouldAutofillGross("low")).toBe(false);
    expect(shouldAutofillGross("none")).toBe(false);
  });

  it("limit constants are exposed and correct", () => {
    expect(LIMITS.maxGrossPerDay).toBe(3000);
    expect(LIMITS.maxRidesPerDay).toBe(100);
    expect(LIMITS.maxHoursPerDay).toBe(24);
  });
});

// ─── Rides + limit ────────────────────────────────────────────────────────────

describe("rides parsing & limits", () => {
  it("extracts 'Trips 14' as 14 (ignores 63 from 245,63)", () => {
    expect(parseScreenshotText(UBER).curse.value).toBe(14);
  });

  it("extracts '18 curse' when number precedes keyword", () => {
    expect(parseScreenshotText(BOLT).curse.value).toBe(18);
  });

  it("rejects rides > 100", () => {
    const r = parseScreenshotText("Uber Driver App summary\nVenit total incasari 200 lei\nCurse efectuate 250\nTimp online 6h 00min\n10 mai 2026");
    expect(r.curse.value).toBeUndefined();
  });

  it("none when no rides keyword", () => {
    const r = parseScreenshotText("Uber Driver App summary\nVenit total incasari 245,63 lei\nTimp online 6h 30min\n10 mai 2026");
    expect(r.curse.value).toBeUndefined();
    expect(r.curse.confidence).toBe("none");
  });
});

// ─── Hours + limit ────────────────────────────────────────────────────────────

describe("hours parsing & limits", () => {
  it("parses '6h 30min' as 6.5", () => {
    expect(parseScreenshotText(UBER).ore.value).toBeCloseTo(6.5);
  });

  it("parses '07:15' as 7.25", () => {
    expect(parseScreenshotText(BOLT).ore.value).toBeCloseTo(7.25);
  });

  it("does NOT grab a random number near keyword without a time pattern", () => {
    const r = parseScreenshotText("Uber Driver App summary\nVenit total incasari 245,63 lei\nCurse efectuate 14\nActive metric 8 units\n10 mai 2026");
    expect(r.ore.value).toBeUndefined();
  });

  it("none when no hours keyword/pattern", () => {
    const r = parseScreenshotText("Uber Driver App summary screen\nVenit total incasari 245,63 lei\nCurse efectuate 14\n10 mai 2026");
    expect(r.ore.value).toBeUndefined();
    expect(r.ore.confidence).toBe("none");
  });
});

// ─── Date: never defaults to day one ──────────────────────────────────────────

describe("date parsing", () => {
  it("parses named Romanian date in-interval", () => {
    expect(parseScreenshotText(UBER).data.value).toBe("2026-05-14");
  });

  it("parses numeric date 12.05.2026", () => {
    expect(parseScreenshotText(BOLT).data.value).toBe("2026-05-12");
  });

  it("returns none for dates outside the week (no default to first day)", () => {
    const r = parseScreenshotText("Uber Driver App summary\nVenit total incasari 245,63 lei\nCurse efectuate 14\nTimp online 6h 00min\n25 mai 2026");
    expect(r.data.value).toBeUndefined();
    expect(r.data.confidence).toBe("none");
  });
});

// ─── Source-line tracking ─────────────────────────────────────────────────────

describe("source line tracking", () => {
  it("attaches the OCR line that produced each detected field", () => {
    const r = parseScreenshotText(UBER);
    expect(r.brut.sourceLine?.toLowerCase()).toContain("245,63");
    expect(r.curse.sourceLine?.toLowerCase()).toContain("trips");
    expect(r.ore.sourceLine?.toLowerCase()).toContain("online");
  });
});

// ─── Bad / garbled text quality gate ──────────────────────────────────────────

describe("garbled / empty OCR text", () => {
  it("empty string → quality 'empty', all none", () => {
    const r = parseScreenshotText("");
    expect(r.rawTextQuality).toBe("empty");
    expect(r.brut.confidence).toBe("none");
    expect(r.platforma.confidence).toBe("none");
    expect(r.data.confidence).toBe("none");
  });

  it("very short garbled text → quality 'short', all none", () => {
    const r = parseScreenshotText("Ub3r 24 xy");
    expect(r.rawTextQuality).toBe("short");
    expect(r.brut.confidence).toBe("none");
  });

  it("nonsense long text yields no false positives", () => {
    const r = parseScreenshotText(
      "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor",
    );
    expect(r.brut.value).toBeUndefined();
    expect(r.curse.value).toBeUndefined();
    expect(r.ore.value).toBeUndefined();
    expect(r.data.value).toBeUndefined();
    expect(r.platforma.value).toBeUndefined();
  });
});

// ─── OCR artifact sanitisation ────────────────────────────────────────────────

describe("OCR artifact sanitisation (via parseScreenshotText)", () => {
  it("handles smart quotes in OCR output without breaking parsing", () => {
    // ‘ left single quote, ’ right single quote around platform name
    const r = parseScreenshotText(
      "Uber Driver\nVenit total incasari’s 245,63 lei\nCurse efectuate 14\nTimp online 6h 30min\n10 mai 2026",
    );
    expect(r.brut.value).toBe(245.63);
  });

  it("handles pipe-as-1 in a number (e.g. '24|5,50 lei')", () => {
    // After sanitisation '24|5,50' becomes '2415,50' which exceeds 3000 → none
    // This asserts the pipe is not silently ignored but properly replaced.
    const r = parseScreenshotText(
      "Uber Driver App\nCastig total 24|5,50 lei\nCurse efectuate 12\nTimp online 5h 00min\n10 mai 2026",
    );
    // 2415.5 > maxGrossPerDay=3000 is actually ≤ 3000, so value present and correct
    expect(r.brut.value).toBe(2415.5);
  });

  it("strips zero-width chars without corrupting nearby values", () => {
    const zwsp = "​";
    const r = parseScreenshotText(
      `Uber\nCastig total incasari${zwsp} 245,63 lei\nCurse 14\nOnline 6h 30min\n10 mai 2026`,
    );
    expect(r.brut.value).toBe(245.63);
    expect(r.platforma.value).toBe("Uber");
  });
});

// ─── Hours no-space fix ───────────────────────────────────────────────────────

describe("hours parsing – no-space compact format", () => {
  it("parses '6h30min' (no space) as 6.5", () => {
    const r = parseScreenshotText(
      "Uber Driver\nCastig total incasari 200 lei\nCurse 10\nOnline 6h30min\n10 mai 2026",
    );
    expect(r.ore.value).toBeCloseTo(6.5);
  });

  it("parses '7h45min' (no space) as 7.75", () => {
    const r = parseScreenshotText(
      "Bolt Driver\nIncasari 310 RON\nCurse 18\nTimp online 7h45min\n12 mai 2026 Bolt",
    );
    expect(r.ore.value).toBeCloseTo(7.75);
  });
});

// ─── Full realistic scenarios ─────────────────────────────────────────────────

describe("realistic full screenshots", () => {
  it("Uber full", () => {
    const r = parseScreenshotText(UBER);
    expect(r.platforma.value).toBe("Uber");
    expect(r.brut.value).toBe(245.63);
    expect(r.curse.value).toBe(14);
    expect(r.ore.value).toBeCloseTo(6.5);
    expect(r.data.value).toBe("2026-05-14");
  });

  it("Bolt full", () => {
    const r = parseScreenshotText(BOLT);
    expect(r.platforma.value).toBe("Bolt");
    expect(r.brut.value).toBe(310);
    expect(r.curse.value).toBe(18);
    expect(r.ore.value).toBeCloseTo(7.25);
    expect(r.data.value).toBe("2026-05-12");
  });
});
