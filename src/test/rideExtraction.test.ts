import { describe, expect, it } from "vitest";
import {
  aggregateByDate,
  classifyScreen,
  dedupeRides,
  extractFromMany,
  extractFromScreenshot,
} from "@/lib/rideExtraction";

// ─── Realistic OCR transcripts (mirroring sample-screenshots/) ─────────────────

// 01_activity_only_hours_rides
const ACTIVITY = `
Activitate - Ore Online
04.05-10.05  Săptămâna curentă  În ultimele 3 luni
41ore 7min
LU. MA. MI. JOI VI. SÂ. DU.
7ore 50min
Numărul de ore conduse și în așteptare cu Bolt
Ore online   Curse   Anulări
`;

// 02_ride_list_screens
const RIDE_LIST = `
Curse
Sortează  Data  Status  Plată
10 mai 2026, 13:26
Lângă Bulevardul Bucureștii Noi, București 012363
Finalizată
12,70 lei
10 mai 2026, 12:22
Lângă Strada Progresului, București 050695
Finalizată
50,31 lei
10 mai 2026, 12:13
Lângă Splaiul Independenței, București
Finalizată
15,40 lei
10 mai 2026, 11:52
Lângă Bulevardul Dinicu Golescu, București 010865
Finalizată   Bacșiș 5,00 lei inclus
27,42 lei
10 mai 2026, 11:28
Lângă Splaiul Unirii, București
Finalizată   Bacșiș 5,00 lei inclus
24,93 lei
10 mai 2026, 11:20
Lângă Bulevardul Tineretului, București 010091
Finalizată
12,84 lei
`;

// 03_individual_rides_simple — note "Puncte Bolt 100" must NOT be money
const INDIVIDUAL = `
17 mai, 14:00
Bolt | 3km | 7 min
Lângă Strada Almaș, București, România   14:16
Lângă Șoseaua Chitilei, București 012407, România   14:23
Adresa exactă este ascunsă din motive de confidențialitate
Puncte Bolt   100
Sună pasagerul
Cere ajutor pentru această cursă
Plată
Clientul a plătit
Plată în numerar   16,70 lei
`;

// 04_special_payments_compensation_breakdown — Defalcare/Venituri
const SPECIAL_VENITURI = `
10 mai, 10:43
Bolt | 2.8km | 6 min
Lângă Strada Brazilia, București, România   10:47
Lângă Bulevardul Gheorghe Duca, București 011071, România   10:53
Sună pasagerul
Plată
Clientul a plătit
Plată în numerar   17,50 lei
Defalcare
Venituri   17,59 lei
`;

// 04 — compensation (Compensare Bolt / Cursă cu reducere)
const SPECIAL_COMPENSATION = `
12 mai, 12:44
Bolt | 13.1km | 36 min
Lângă Strada Atena, București 011832, România   12:49
Lângă Bulevardul Metalurgiei, București, România   13:25
Sună pasagerul
Plată
Clientul a plătit
Plată în numerar   45,00 lei
Compensare Bolt
Cursă cu reducere   11,20 lei
Defalcare
`;

// 04 — tip included
const SPECIAL_TIP = `
10 mai, 11:28
Bolt | 6.6km | 19 min
Lângă Splaiul Unirii, București, România   11:34
Lângă Piața Gării de Nord, București 010858, România   11:54
Sună pasagerul
Plată
Clientul a plătit   31,40 lei
5,00 lei bacșiș inclus
Trimite mulțumiri pentru bacșiș
Defalcare
`;

// ─── Screen classification ────────────────────────────────────────────────────

describe("screen classification", () => {
  it("classifies an activity (hours) screen", () => {
    expect(classifyScreen(ACTIVITY)).toBe("activity");
  });

  it("classifies a ride-list screen", () => {
    expect(classifyScreen(RIDE_LIST)).toBe("ride-list");
  });

  it("classifies a simple individual ride screen", () => {
    expect(classifyScreen(INDIVIDUAL)).toBe("individual-ride");
  });

  it("classifies a Venituri/Defalcare screen as special-payment", () => {
    expect(classifyScreen(SPECIAL_VENITURI)).toBe("special-payment");
  });

  it("classifies a compensation screen as special-payment", () => {
    expect(classifyScreen(SPECIAL_COMPENSATION)).toBe("special-payment");
  });

  it("returns unknown for noise", () => {
    expect(classifyScreen("lorem ipsum dolor sit amet")).toBe("unknown");
  });
});

// ─── Activity extraction (no income) ──────────────────────────────────────────

describe("activity screen extraction", () => {
  it("extracts total hours and produces no rides / no income", () => {
    const r = extractFromScreenshot(ACTIVITY);
    expect(r.kind).toBe("activity");
    expect(r.rides).toHaveLength(0);
    expect(r.activity?.ore).toBeCloseTo(41 + 7 / 60, 2);
    expect(r.activity?.weekRange).toBe("04.05-10.05");
  });
});

// ─── Ride list extraction ─────────────────────────────────────────────────────

describe("ride-list extraction", () => {
  it("extracts every ride with date + amount", () => {
    const r = extractFromScreenshot(RIDE_LIST);
    expect(r.kind).toBe("ride-list");
    expect(r.rides).toHaveLength(6);
    expect(r.rides.every((ride) => ride.date === "2026-05-10")).toBe(true);
  });

  it("parses comma decimals correctly (12,70 → 12.7, not 1270)", () => {
    const r = extractFromScreenshot(RIDE_LIST);
    expect(r.rides[0].amount).toBeCloseTo(12.7);
    expect(r.rides[1].amount).toBeCloseTo(50.31);
  });

  it("does not confuse the location postcode with the fare", () => {
    const r = extractFromScreenshot(RIDE_LIST);
    // "012363" in the address must never become the amount.
    expect(r.rides[0].amount).toBeLessThan(100);
  });

  it("captures included tips without double-counting them in the fare", () => {
    const r = extractFromScreenshot(RIDE_LIST);
    const tipped = r.rides.find((ride) => ride.tip !== undefined);
    expect(tipped?.tip).toBeCloseTo(5);
    // fare already includes the tip, so amount is the larger value
    expect(tipped?.amount).toBeGreaterThan(5);
  });

  it("marks completed rides", () => {
    const r = extractFromScreenshot(RIDE_LIST);
    expect(r.rides.every((ride) => ride.isCompleted)).toBe(true);
  });
});

// ─── Individual ride extraction ───────────────────────────────────────────────

describe("individual ride extraction", () => {
  it("extracts the fare from the payment section", () => {
    const r = extractFromScreenshot(INDIVIDUAL);
    expect(r.rides).toHaveLength(1);
    expect(r.rides[0].amount).toBeCloseTo(16.7);
    expect(r.rides[0].gross).toBeCloseTo(16.7);
  });

  it("NEVER treats reward points ('Puncte Bolt 100') as money", () => {
    const r = extractFromScreenshot(INDIVIDUAL);
    expect(r.rides[0].amount).not.toBe(100);
    expect(r.rides[0].gross).not.toBe(100);
  });

  it("resolves a year-less date using the configured week year", () => {
    const r = extractFromScreenshot(INDIVIDUAL);
    expect(r.rides[0].date).toBe("2026-05-17");
    expect(r.rides[0].time).toBe("14:00");
    // 17 May is now inside the 11–17 May week — valid, not flagged.
    expect(r.rides[0].outsideWeek).toBe(false);
    expect(r.rides[0].needsReview).toBe(false);
  });
});

// ─── Week boundary enforcement (11–17 May 2026) ───────────────────────────────

const mkIndividual = (header: string, amount: string) =>
  `${header}\nfm Bolt | 3km | 7 min\nPlata\nClientul a platit\nPlata in numerar   ${amount}`;

describe("week boundary enforcement", () => {
  it("flags a ride dated outside the week (10 mai) and needs review", () => {
    const r = extractFromScreenshot(mkIndividual("10 mai, 10:00", "25,00 lei"));
    expect(r.rides[0].date).toBe("2026-05-10");
    expect(r.rides[0].outsideWeek).toBe(true);
    expect(r.rides[0].needsReview).toBe(true);
  });

  it("keeps the last day of the week (17 mai) inside the week", () => {
    const r = extractFromScreenshot(mkIndividual("17 mai, 10:00", "20,00 lei"));
    expect(r.rides[0].date).toBe("2026-05-17");
    expect(r.rides[0].outsideWeek).toBe(false);
  });

  it("aggregates out-of-week rides into a separate flagged bucket, after in-week days", () => {
    const rides = [
      ...extractFromScreenshot(mkIndividual("17 mai, 10:00", "20,00 lei")).rides,
      ...extractFromScreenshot(mkIndividual("10 mai, 10:00", "25,00 lei")).rides,
    ];
    const days = aggregateByDate(rides);
    const inWeek = days.find((d) => d.date === "2026-05-17");
    const outside = days.find((d) => d.date === "2026-05-10");
    expect(inWeek?.outsideWeek).toBe(false);
    expect(inWeek?.gross).toBeCloseTo(20);
    expect(outside?.outsideWeek).toBe(true);
    expect(outside?.gross).toBeCloseTo(25); // its income is NOT folded into the in-week total
    // ordering: in-week day comes before the out-of-week day
    expect(days.indexOf(inWeek!)).toBeLessThan(days.indexOf(outside!));
  });

  it("does NOT use a file-name date — a ride with no OCR date stays undated", () => {
    // No date anywhere in the text; the 2026-05-17 in a WhatsApp file name must not leak in.
    const r = extractFromScreenshot(`fm Bolt\nPlata\nClientul a platit\nPlata in numerar   18,00 lei`);
    expect(r.rides[0].date).toBeUndefined();
    expect(r.rides[0].outsideWeek).toBe(false); // undated ≠ outside-week
    const days = aggregateByDate(r.rides);
    expect(days[0].date).toBe(""); // lands in the undated bucket for manual day assignment
  });
});

// ─── Special payment / compensation / breakdown ───────────────────────────────

describe("special payment extraction", () => {
  it("prefers Defalcare 'Venituri' earnings as gross when present", () => {
    const r = extractFromScreenshot(SPECIAL_VENITURI);
    expect(r.rides[0].amount).toBeCloseTo(17.5);
    expect(r.rides[0].earnings).toBeCloseTo(17.59);
    expect(r.rides[0].gross).toBeCloseTo(17.59);
    expect(r.rides[0].needsReview).toBe(true);
  });

  it("adds 'Compensare Bolt' on top of the client payment", () => {
    const r = extractFromScreenshot(SPECIAL_COMPENSATION);
    expect(r.rides[0].amount).toBeCloseTo(45);
    expect(r.rides[0].compensation).toBeCloseTo(11.2);
    expect(r.rides[0].gross).toBeCloseTo(56.2);
    expect(r.rides[0].isCompensation).toBe(true);
  });

  it("captures an included tip on a special screen", () => {
    const r = extractFromScreenshot(SPECIAL_TIP);
    expect(r.rides[0].amount).toBeCloseTo(31.4);
    expect(r.rides[0].tip).toBeCloseTo(5);
  });

  it("flags every special case for manual review", () => {
    expect(extractFromScreenshot(SPECIAL_VENITURI).rides[0].needsReview).toBe(true);
    expect(extractFromScreenshot(SPECIAL_COMPENSATION).rides[0].needsReview).toBe(true);
  });
});

// ─── Grouping & daily aggregation ─────────────────────────────────────────────

describe("aggregation by date", () => {
  it("groups rides by day and sums the daily gross + completed count", () => {
    const r = extractFromScreenshot(RIDE_LIST);
    const days = aggregateByDate(r.rides);
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2026-05-10");
    expect(days[0].rideCount).toBe(6);
    expect(days[0].gross).toBeCloseTo(12.7 + 50.31 + 15.4 + 27.42 + 24.93 + 12.84, 2);
    expect(days[0].tips).toBeCloseTo(10);
  });

  it("places undated rides in a trailing '' bucket (never dropped)", () => {
    const r = extractFromScreenshot("Plată\nClientul a plătit\nPlată în numerar   20,00 lei");
    const days = aggregateByDate(r.rides);
    expect(days[0].date).toBe("");
    expect(days[0].rides[0].amount).toBeCloseTo(20);
  });

  it("combines rides from several screenshots and groups by date", () => {
    const multi = extractFromMany([RIDE_LIST, INDIVIDUAL, SPECIAL_COMPENSATION]);
    const dates = multi.aggregates.map((d) => d.date);
    expect(dates).toContain("2026-05-10"); // list day
    expect(dates).toContain("2026-05-17"); // individual ride
    expect(dates).toContain("2026-05-12"); // compensation ride
    expect(multi.platforma).toBe("Bolt");
  });
});

// ─── De-duplication across screenshots ────────────────────────────────────────

describe("ride de-duplication", () => {
  it("drops a duplicate ride seen in both the list and a detail screen", () => {
    const detail = `
10 mai, 13:26
Bolt | 3km | 9 min
Plată
Clientul a plătit
Plată în numerar   12,70 lei
`;
    const combined = [
      ...extractFromScreenshot(RIDE_LIST).rides,
      ...extractFromScreenshot(detail).rides,
    ];
    const before = combined.length;
    const after = dedupeRides(combined).length;
    expect(after).toBe(before - 1);
  });
});

// ─── Real Tesseract output quirks (captured from sample-screenshots/) ─────────
// These transcripts are copied from actual OCR runs and lock in the recovery
// logic for artifacts the idealised fixtures above don't exercise.

// 02 — note "2742lei" (dropped comma) and amounts interleaved between lines.
const REAL_RIDE_LIST = `
Curse
Sortează  Data v  Status Vv  Plata Vv
10 mai 2026, 13:26
Langa Bulevardul Bucurestii Noi,
HI 12,70 lei
Bucuresti 012363
Finalizata
10 mai 2026, 12:22
Langa Strada Progresului,
HI 50,31lei
Bucureşti 050695
Finalizată
10 mai 2026, 11:52
Lângă Bulevardul Dinicu
HI 2742lei
Golescu, Bucureşti 010865
Finalizată
Bacșiș 5,00 lei inclus
Acasă  Câștigă mai mult  Curse  Ajutor
`;

// 03 — "Puncte Bolt" and "100" on separate lines; cash glyph before amount.
const REAL_INDIVIDUAL = `
17 mai, 14:00
fm Bolt  S 3km | @ 7 min
Lângă Strada Almaș, Bucureşti,
14:16
Puncte Bolt
100
Mai multe despre Bolt Rewards
Cere ajutor pentru aceasta cursa
Plata
Clientul a platit
Plata in numerar
(9) 16,70 lei
`;

// 04 — compensation amount sits two lines below "Compensare Bolt".
const REAL_COMPENSATION = `
12 mai, 12:44
fm Bolt  S 131km | O 36 min
Plata
Clientul a platit
Plata in numerar
9) 45,00 lei
Compensare Bolt
Cursa cu reducere
® 11,20 lei
`;

describe("real OCR output quirks", () => {
  it("recovers a fare whose comma was dropped (2742lei → 27.42) and flags it", () => {
    const r = extractFromScreenshot(REAL_RIDE_LIST);
    const ride = r.rides.find((x) => x.time === "11:52");
    expect(ride?.amount).toBeCloseTo(27.42);
    expect(ride?.tip).toBeCloseTo(5);
    expect(ride?.needsReview).toBe(true); // recovered value must be verified
  });

  it("handles a missing space before the currency ('50,31lei')", () => {
    const r = extractFromScreenshot(REAL_RIDE_LIST);
    const ride = r.rides.find((x) => x.time === "12:22");
    expect(ride?.amount).toBeCloseTo(50.31);
  });

  it("keeps the included tip out of the fare on the dropped-comma row", () => {
    const r = extractFromScreenshot(REAL_RIDE_LIST);
    const ride = r.rides.find((x) => x.time === "11:52");
    // The fare must be 27.42, never the 5.00 tip.
    expect(ride?.amount).not.toBeCloseTo(5);
  });

  it("never reads reward points ('Puncte Bolt' / '100') as the fare", () => {
    const r = extractFromScreenshot(REAL_INDIVIDUAL);
    expect(r.rides[0].amount).toBeCloseTo(16.7);
    expect(r.rides[0].amount).not.toBe(100);
  });

  it("finds a compensation amount two lines below its label", () => {
    const r = extractFromScreenshot(REAL_COMPENSATION);
    expect(r.rides[0].amount).toBeCloseTo(45);
    expect(r.rides[0].compensation).toBeCloseTo(11.2);
    expect(r.rides[0].gross).toBeCloseTo(56.2);
  });

  it("recovers a fare when 'lei' is misread as '1ei' ('15,021ei' → 15.02)", () => {
    const list = `
10 mai 2026, 16:28
Lângă Bulevardul Mircea Eliade,
AI 15,021ei >
Bucureşti 012011
Finalizată
10 mai 2026, 16:00
Lângă Strada Test
AI 20,00 lei
Finalizată
`;
    const r = extractFromScreenshot(list);
    const ride = r.rides.find((x) => x.time === "16:28");
    expect(ride?.amount).toBeCloseTo(15.02);
  });

  it("marks declined / missed offers as non-trips (not completed)", () => {
    const list = `
10 mai 2026, 17:49
Lângă Strada Doctor Iacob Felix, Bucureşti
Ai refuzat
10 mai 2026, 17:33
Lângă Strada Smaranda
AH 15,80 lei
Finalizată
`;
    const r = extractFromScreenshot(list);
    const declined = r.rides.find((x) => x.time === "17:49");
    expect(declined?.isCompleted).toBe(false);
    expect(declined?.amount).toBeUndefined();
    // It must not inflate the completed ride count.
    const days = aggregateByDate(r.rides);
    expect(days[0].rideCount).toBe(1);
  });
});

// ─── Activity hours robustness ────────────────────────────────────────────────

describe("activity hours (real OCR)", () => {
  it("takes the weekly total even when '41ore' is OCR'd as '4lore'", () => {
    const real = `
Activitate - Ore Online
04.05-10.05  Săptămâna curentă
4lore 7min
LU MA MI JOI VI SÂ DU
7ore 50min
Numarul de ore conduse si in asteptare cu Bolt
`;
    const r = extractFromScreenshot(real);
    expect(r.kind).toBe("activity");
    expect(r.activity?.ore).toBeCloseTo(41 + 7 / 60, 1);
  });
});

// ─── Robustness ───────────────────────────────────────────────────────────────

describe("robustness", () => {
  it("empty text yields no rides", () => {
    const r = extractFromScreenshot("");
    expect(r.rawTextQuality).toBe("empty");
    expect(r.rides).toHaveLength(0);
  });

  it("garbled text yields no false rides", () => {
    const r = extractFromScreenshot("asdf qwer zxcv 1234 !!!");
    expect(r.rides).toHaveLength(0);
  });
});
