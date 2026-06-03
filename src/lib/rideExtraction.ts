import { CONFIG, Platforma, inInterval } from "@/lib/weekStorage";
import {
  ParsedDate,
  normalize,
  parseAllMoney,
  parseMoney,
  parseRomanianDate,
  sanitizeOcr,
} from "@/lib/ocrText";
import type { ConfidenceLevel } from "@/lib/ocrParsing";

// ─── Limits ───────────────────────────────────────────────────────────────────

export const RIDE_LIMITS = {
  /** A single Bolt/Uber ride realistically tops out well under this. */
  maxRideAmount: 1000, // lei
  /** Reward-point counters ("Puncte Bolt 100") and similar are not money. */
  minRideAmount: 0.5, // lei
} as const;

// ─── Screen classification ──────────────────────────────────────────────────

export type ScreenKind =
  | "activity"          // weekly hours / rides chart, no income
  | "ride-list"         // list with many rides + amounts
  | "individual-ride"   // single completed ride payment screen
  | "special-payment"   // single ride with compensation / breakdown
  | "unknown";

// ─── Ride model ─────────────────────────────────────────────────────────────

export interface ExtractedRide {
  id: string;
  /** YYYY-MM-DD when resolvable; otherwise undefined (needs manual date). */
  date?: string;
  rawDate?: string;
  time?: string;
  /** Fare the client paid (or the list-row amount). */
  amount?: number;
  /** Tip already included in `amount` ("Bacșiș X lei inclus") — informational. */
  tip?: number;
  /** "Compensare Bolt" added on top of the client payment. */
  compensation?: number;
  /** "Defalcare / Venituri" — driver's authoritative earnings, when shown. */
  earnings?: number;
  /** Income that counts toward the daily total: earnings ?? amount + compensation. */
  gross: number;
  isCompensation: boolean;
  isCompleted: boolean;
  /** True when the ride's date falls outside the configured analysis week. */
  outsideWeek: boolean;
  /** Flagged for the review table (special case, missing amount, or no date). */
  needsReview: boolean;
  reviewReason?: string;
  sourceLine: string;
  confidence: ConfidenceLevel;
}

export interface ActivityInfo {
  ore?: number;
  curse?: number;
  weekRange?: string;
}

export interface ScreenshotParse {
  kind: ScreenKind;
  rides: ExtractedRide[];
  activity?: ActivityInfo;
  rawTextQuality: "ok" | "short" | "empty";
}

// ─── Keyword sets ─────────────────────────────────────────────────────────────

const KW = {
  completed: "finalizata",
  cancelled: "anulata",
  paid: "clientul a platit",
  payment: "plata",
  compensation: "compensare",
  breakdown: "defalcare",
  earnings: "venituri",
  points: "puncte",
  tip: "bacsis",
  activity: "activitate",
  hoursOnline: "ore online",
  ridesTab: "curse",
};

let rideCounter = 0;
function rideId(): string {
  rideCounter += 1;
  return (crypto.randomUUID?.() ?? `ride-${Date.now()}-${rideCounter}`);
}

const defaultYear = () => Number(CONFIG.weekStart.slice(0, 4));

/** A resolved ride date that lies outside the configured analysis week. */
function isOutsideWeek(date: string | undefined): boolean {
  return date !== undefined && !inInterval(date);
}

/** Human label for the configured week, e.g. "10–16 mai 2026" boundaries in ISO. */
function weekBoundsLabel(): string {
  return `${CONFIG.weekStart} – ${CONFIG.weekEnd}`;
}

// ─── Gross computation ────────────────────────────────────────────────────────

function computeGross(r: {
  amount?: number;
  compensation?: number;
  earnings?: number;
}): number {
  if (r.earnings !== undefined) return r.earnings;
  return (r.amount ?? 0) + (r.compensation ?? 0);
}

function plausibleAmount(v: number | undefined): v is number {
  return v !== undefined && v >= RIDE_LIMITS.minRideAmount && v <= RIDE_LIMITS.maxRideAmount;
}

interface FareCandidate {
  value: number;
  /** True when the value was rescued from a dropped OCR comma — needs review. */
  recovered: boolean;
}

/**
 * Normalises a currency value read from OCR into a plausible single fare.
 * Real Bolt fares are < 1000 lei with 2 decimals. OCR sometimes drops the
 * decimal comma ("27,42 lei" → "2742lei"), producing a value 100× too large;
 * we recover it by reinstating the decimals and flag it for review.
 */
function normalizeFare(v: number | undefined): FareCandidate | undefined {
  if (v === undefined) return undefined;
  if (v >= RIDE_LIMITS.minRideAmount && v <= RIDE_LIMITS.maxRideAmount) {
    return { value: v, recovered: false };
  }
  if (Number.isInteger(v) && v > RIDE_LIMITS.maxRideAmount && v <= 99999) {
    const fixed = Math.round(v) / 100;
    if (fixed >= RIDE_LIMITS.minRideAmount && fixed <= RIDE_LIMITS.maxRideAmount) {
      return { value: Math.round(fixed * 100) / 100, recovered: true };
    }
  }
  return undefined;
}

/**
 * First plausible currency amount on lines[i..i+lookahead], skipping reward-point
 * lines. Bolt frequently puts the amount one or two lines below its label
 * ("Compensare Bolt" → "Cursă cu reducere" → "11,20 lei").
 */
function findMoneyNear(lines: string[], i: number, lookahead: number): FareCandidate | undefined {
  for (let k = i; k <= i + lookahead && k < lines.length; k++) {
    if (normalize(lines[k]).includes(KW.points)) continue;
    const fare = normalizeFare(parseMoney(lines[k]));
    if (fare) return fare;
  }
  return undefined;
}

// ─── Classification ───────────────────────────────────────────────────────────

export function classifyScreen(rawText: string): ScreenKind {
  const n = normalize(sanitizeOcr(rawText));

  const hasCompensation = n.includes(KW.compensation) || n.includes(KW.breakdown);
  const hasPaid = n.includes(KW.paid);
  const moneyCount = parseAllMoney(n).length;

  // Count distinct date anchors (date lines).
  const dateAnchors = rawText
    .split(/\r?\n/)
    .filter((l) => parseRomanianDate(l, defaultYear())?.date).length;

  if (hasCompensation && (hasPaid || moneyCount >= 1)) return "special-payment";

  // A list shows several rides: multiple dated rows AND multiple amounts.
  if (dateAnchors >= 2 && moneyCount >= 2) return "ride-list";

  if (hasPaid || (n.includes(KW.payment) && moneyCount >= 1)) return "individual-ride";

  if (n.includes(KW.activity) || n.includes(KW.hoursOnline) || /\bore\b.*\bmin\b/.test(n))
    return "activity";

  // Fallback: a single amount + single date still looks like one ride.
  if (dateAnchors >= 1 && moneyCount >= 1) return "ride-list";

  return "unknown";
}

// ─── Activity screens (hours / rides, no income) ──────────────────────────────

function parseActivity(text: string): ActivityInfo {
  // "41ore" is frequently OCR'd as "4lore" (1→l); repair a letter-l that sits
  // between a digit and "ore" before scanning for the total.
  const n = normalize(text).replace(/(\d)\s*l(?=ore)/g, (_, d) => `${d}1`);
  const info: ActivityInfo = {};

  // The weekly total is the LARGEST "<h>ore <m>min" value on screen — never a
  // single highlighted day (e.g. take 41h 7min, not the 7h 50min day bar).
  let bestHours: number | undefined;
  for (const m of n.matchAll(/(\d+)\s*ore\s*(?:(\d+)\s*min)?/g)) {
    const h = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
    if (h <= 24 * 7 && (bestHours === undefined || h > bestHours)) bestHours = h;
  }
  if (bestHours !== undefined) info.ore = Math.round(bestHours * 100) / 100;

  // Week range: "04.05-10.05"
  const range = n.match(/\b(\d{1,2}\.\d{1,2})\s*[-–]\s*(\d{1,2}\.\d{1,2})\b/);
  if (range) info.weekRange = `${range[1]}-${range[2]}`;

  // Rides count if a "curse" tab value is present: "Curse 37"
  const rides = n.match(/\bcurse\b[^\d]{0,8}(\d{1,3})\b/);
  if (rides) info.curse = Number(rides[1]);

  return info;
}

// ─── Tip / compensation / earnings line helpers ───────────────────────────────

function findTip(text: string): number | undefined {
  const n = normalize(text);
  // "bacsis 5,00 lei inclus" OR "5,00 lei bacsis inclus"
  const a = n.match(/bacsis\s*(\d[\d.,]*)\s*(?:lei|ron)/);
  if (a) return parseMoney(a[0]);
  const b = n.match(/(\d[\d.,]*)\s*(?:lei|ron)\s*bacsis/);
  if (b) return parseMoney(b[0]);
  return undefined;
}

// ─── Ride list parsing ────────────────────────────────────────────────────────

interface RideRow {
  anchor: ParsedDate;
  lines: string[];
}

function parseRideList(lines: string[]): ExtractedRide[] {
  const year = defaultYear();

  // Find date anchors and slice the text into per-ride blocks.
  const anchorIdx: number[] = [];
  const anchors: ParsedDate[] = [];
  lines.forEach((line, i) => {
    const d = parseRomanianDate(line, year);
    if (d?.date) {
      anchorIdx.push(i);
      anchors.push(d);
    }
  });

  const rows: RideRow[] = anchorIdx.map((start, k) => {
    const end = k + 1 < anchorIdx.length ? anchorIdx[k + 1] : lines.length;
    return { anchor: anchors[k], lines: lines.slice(start, end) };
  });

  const rides: ExtractedRide[] = [];
  for (const row of rows) {
    const blockText = row.lines.join("\n");
    const n = normalize(blockText);

    const tip = findTip(blockText);

    // Every currency-tagged value, with dropped-comma recovery. Reward points
    // ("Puncte Bolt 100") carry no currency tag and are never collected here.
    const fares = parseAllMoney(blockText)
      .map(normalizeFare)
      .filter((f): f is FareCandidate => f !== undefined);

    // Remove one occurrence equal to the tip so the included tip is not mistaken
    // for the fare (the displayed fare already includes the tip).
    if (tip !== undefined) {
      const idx = fares.findIndex((f) => Math.abs(f.value - tip) < 0.005);
      if (idx >= 0) fares.splice(idx, 1);
    }

    // The fare is the largest remaining amount in the row.
    const chosen = fares.reduce<FareCandidate | undefined>(
      (best, f) => (best === undefined || f.value > best.value ? f : best),
      undefined,
    );
    let amount = chosen?.value;
    let recovered = chosen?.recovered ?? false;
    if (amount === undefined && plausibleAmount(tip)) amount = tip; // tip-only fallback

    // Declined / missed offers ("Ai refuzat", "Nu ai răspuns") are not trips.
    const isDeclined = /\b(refuzat|nu ai raspuns|ratata|pierduta)\b/.test(n);
    const isCancelled = n.includes(KW.cancelled) || isDeclined;
    const isCompleted = n.includes(KW.completed) || (!isCancelled && amount !== undefined);
    const outsideWeek = isOutsideWeek(row.anchor.date);

    const gross = computeGross({ amount });
    const needsReview = outsideWeek || amount === undefined || recovered;

    rides.push({
      id: rideId(),
      date: row.anchor.date,
      rawDate: row.anchor.raw,
      time: row.anchor.time,
      amount,
      tip,
      gross,
      isCompensation: false,
      isCompleted,
      outsideWeek,
      needsReview,
      reviewReason: outsideWeek
        ? `În afara săptămânii selectate (${weekBoundsLabel()})`
        : isDeclined
          ? "Cursă neefectuată (refuzată/ratată)"
          : amount === undefined
            ? "Suma nu a putut fi citită"
            : recovered
              ? "Virgulă lipsă din OCR — verifică suma"
              : undefined,
      sourceLine: row.lines.join(" ").replace(/\s+/g, " ").trim(),
      confidence: amount === undefined ? "low" : recovered ? "medium" : isCompleted ? "high" : "medium",
    });
  }

  return rides;
}

// ─── Individual / special ride parsing ────────────────────────────────────────

function parseIndividualRide(lines: string[], kind: ScreenKind): ExtractedRide | undefined {
  const year = defaultYear();
  const fullText = lines.join("\n");
  const n = normalize(fullText);

  // Header date: first line that resolves to a date.
  let anchor: ParsedDate | undefined;
  for (const line of lines) {
    const d = parseRomanianDate(line, year);
    if (d?.date) { anchor = d; break; }
  }

  // Client-paid amount: amount on/near "clientul a platit" / payment line.
  // The amount can sit up to two lines below the label, and reward-point lines
  // ("Puncte Bolt" / "100") are skipped by findMoneyNear.
  let amount: number | undefined;
  let recovered = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = normalize(lines[i]);
    if (ln.includes(KW.points)) continue;
    if (ln.includes(KW.paid) || ln.includes("plata in numerar") || ln.includes("plata cu cardul")) {
      const fare = findMoneyNear(lines, i, 2);
      if (fare) { amount = fare.value; recovered = fare.recovered; break; }
    }
  }
  // Fallback: first plausible currency amount that is not a reward-point line.
  if (amount === undefined) {
    for (let i = 0; i < lines.length; i++) {
      if (normalize(lines[i]).includes(KW.points)) continue;
      const fare = normalizeFare(parseMoney(lines[i]));
      if (fare) { amount = fare.value; recovered = fare.recovered; break; }
    }
  }

  // Compensation: "Compensare Bolt" → amount within the next couple of lines.
  let compensation: number | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (normalize(lines[i]).includes(KW.compensation)) {
      compensation = findMoneyNear(lines, i, 2)?.value;
      break;
    }
  }

  // Earnings: under "Defalcare" → "Venituri" amount.
  let earnings: number | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (normalize(lines[i]).includes(KW.earnings)) {
      const fare = findMoneyNear(lines, i, 2);
      if (fare) { earnings = fare.value; break; }
    }
  }

  const tip = findTip(fullText);
  const isCancelled = n.includes(KW.cancelled);
  const isCompensation = kind === "special-payment" || compensation !== undefined;

  if (amount === undefined && earnings === undefined && compensation === undefined) {
    return undefined; // nothing usable
  }

  const gross = computeGross({ amount, compensation, earnings });
  const outsideWeek = isOutsideWeek(anchor?.date);
  const needsReview = outsideWeek || isCompensation || amount === undefined || recovered || !anchor?.date;

  return {
    id: rideId(),
    date: anchor?.date,
    rawDate: anchor?.raw,
    time: anchor?.time,
    amount,
    tip,
    compensation,
    earnings,
    gross,
    isCompensation,
    isCompleted: !isCancelled,
    outsideWeek,
    needsReview,
    reviewReason: outsideWeek
      ? `În afara săptămânii selectate (${weekBoundsLabel()})`
      : !anchor?.date
        ? "Data lipsește — alege ziua"
        : isCompensation
          ? "Caz special (compensare/defalcare) — verifică suma"
          : amount === undefined
            ? "Suma nu a putut fi citită"
            : recovered
              ? "Virgulă lipsă din OCR — verifică suma"
              : undefined,
    sourceLine: lines.find((l) => parseMoney(l) !== undefined)?.trim() ?? lines[0]?.trim() ?? "",
    confidence: earnings !== undefined ? "high" : recovered ? "low" : amount !== undefined ? "medium" : "low",
  };
}

// ─── Main per-screenshot entry point ──────────────────────────────────────────

export function extractFromScreenshot(rawText: string): ScreenshotParse {
  const text = sanitizeOcr(rawText);
  const trimmed = text.trim();

  const rawTextQuality: ScreenshotParse["rawTextQuality"] =
    !trimmed ? "empty" : trimmed.length < 30 ? "short" : "ok";

  if (rawTextQuality === "empty") {
    return { kind: "unknown", rides: [], rawTextQuality };
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const kind = classifyScreen(text);

  if (kind === "activity") {
    return { kind, rides: [], activity: parseActivity(text), rawTextQuality };
  }

  if (kind === "ride-list") {
    return { kind, rides: parseRideList(lines), rawTextQuality };
  }

  if (kind === "individual-ride" || kind === "special-payment") {
    const ride = parseIndividualRide(lines, kind);
    return { kind, rides: ride ? [ride] : [], rawTextQuality };
  }

  return { kind: "unknown", rides: [], rawTextQuality };
}

// ─── Aggregation by date ──────────────────────────────────────────────────────

export interface DailyAggregate {
  /** YYYY-MM-DD, or "" for the undated bucket (rides needing a manual day). */
  date: string;
  gross: number;
  /** Number of completed rides counted toward the day. */
  rideCount: number;
  tips: number;
  compensation: number;
  hasSpecialCases: boolean;
  /** True when this date is outside the configured week — never applied to totals. */
  outsideWeek: boolean;
  rides: ExtractedRide[];
}

/**
 * Groups rides by their resolved date and sums daily gross income + ride counts.
 * Buckets are ordered: in-week days (chronological) → out-of-week days →
 * the undated "" bucket. Out-of-week and undated buckets are flagged so the UI
 * can show them separately and keep them out of the applied weekly totals.
 * Nothing is silently dropped.
 */
export function aggregateByDate(rides: ExtractedRide[]): DailyAggregate[] {
  const map = new Map<string, ExtractedRide[]>();
  for (const r of rides) {
    const key = r.date ?? "";
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }

  const out: DailyAggregate[] = [];
  for (const [date, list] of map) {
    const outsideWeek = date !== "" && !inInterval(date);
    out.push({
      date,
      gross: round2(list.reduce((s, r) => s + r.gross, 0)),
      rideCount: list.filter((r) => r.isCompleted).length,
      tips: round2(list.reduce((s, r) => s + (r.tip ?? 0), 0)),
      compensation: round2(list.reduce((s, r) => s + (r.compensation ?? 0), 0)),
      hasSpecialCases: list.some((r) => r.needsReview || r.isCompensation),
      outsideWeek,
      rides: list,
    });
  }

  // Rank: in-week dated (0) → out-of-week dated (1) → undated "" (2); then chronological.
  const rank = (d: DailyAggregate) => (d.date === "" ? 2 : d.outsideWeek ? 1 : 0);
  out.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * De-duplicates rides that appear in more than one screenshot (e.g. a ride seen
 * both in the list and on its own detail screen). Two rides match when they
 * share the same date, time and rounded gross.
 */
export function dedupeRides(rides: ExtractedRide[]): ExtractedRide[] {
  const seen = new Set<string>();
  const out: ExtractedRide[] = [];
  for (const r of rides) {
    const key = `${r.date ?? "?"}|${r.time ?? "?"}|${round2(r.gross)}`;
    if (r.date && r.time && seen.has(key)) continue;
    if (r.date && r.time) seen.add(key);
    out.push(r);
  }
  return out;
}

// ─── Convenience: many screenshots → aggregates ───────────────────────────────

export interface MultiExtract {
  rides: ExtractedRide[];
  activity?: ActivityInfo;
  aggregates: DailyAggregate[];
  platforma: Platforma; // these screens are Bolt; kept explicit for the dashboard
}

export function extractFromMany(texts: string[]): MultiExtract {
  const allRides: ExtractedRide[] = [];
  let activity: ActivityInfo | undefined;

  for (const t of texts) {
    const parsed = extractFromScreenshot(t);
    allRides.push(...parsed.rides);
    if (parsed.activity && !activity) activity = parsed.activity;
  }

  const rides = dedupeRides(allRides);
  return {
    rides,
    activity,
    aggregates: aggregateByDate(rides),
    platforma: "Bolt",
  };
}
