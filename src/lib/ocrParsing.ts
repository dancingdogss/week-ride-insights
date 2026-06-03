import { CONFIG, Platforma, inInterval } from "@/lib/weekStorage";
import { MONTHS, formatDate, normalize, parseNumber, sanitizeOcr } from "@/lib/ocrText";

// ─── Limits (shared, single source of truth) ──────────────────────────────────

export const LIMITS = {
  maxGrossPerDay: 3000, // RON
  maxRidesPerDay: 100,
  maxHoursPerDay: 24,
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = "high" | "medium" | "low" | "none";

export interface ExtractedField<T> {
  value: T | undefined;
  confidence: ConfidenceLevel;
  /** The OCR line the value was taken from, so the user can verify it. */
  sourceLine?: string;
  /** Short human note for debugging / UI tooltip. */
  reason?: string;
}

export interface ScreenshotExtract {
  platforma: ExtractedField<Platforma>;
  brut: ExtractedField<number>;
  curse: ExtractedField<number>;
  ore: ExtractedField<number>;
  data: ExtractedField<string>;
  rawTextQuality: "ok" | "short" | "empty";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GROSS_KEYWORDS_STRONG = ["castig", "incasari", "venit", "earnings", "fare"];
const GROSS_KEYWORDS_WEAK   = ["total", "income", "suma"];
const HOURS_KEYWORDS        = ["online", "timp", "ore", "hours", "active"];
const RIDES_KEYWORDS        = ["curse", "calatorii", "rides", "trips", "comenzi"];

// ─── Generic helpers ──────────────────────────────────────────────────────────

/** Count exact whole-word occurrences of `word` in normalized `text`. */
function countWord(text: string, word: string): number {
  return (text.match(new RegExp(`\\b${word}\\b`, "g")) ?? []).length;
}

function none<T>(reason: string): ExtractedField<T> {
  return { value: undefined, confidence: "none", reason };
}

// ─── Platform ─────────────────────────────────────────────────────────────────
// Rule: NEVER default to Uber. If ambiguous → none.

function findPlatform(text: string): ExtractedField<Platforma> {
  const n = normalize(text);
  const boltCount = countWord(n, "bolt");
  const uberCount = countWord(n, "uber");

  if (boltCount > 0 && uberCount > 0) {
    if (boltCount > uberCount)
      return { value: "Bolt", confidence: "medium", reason: `Bolt(${boltCount}) > Uber(${uberCount}) — verify` };
    if (uberCount > boltCount)
      return { value: "Uber", confidence: "medium", reason: `Uber(${uberCount}) > Bolt(${boltCount}) — verify` };
    return none("Both Bolt and Uber found equally — ambiguous");
  }

  if (boltCount >= 2) return { value: "Bolt", confidence: "high",   reason: `"Bolt" found ${boltCount}×` };
  if (uberCount >= 2) return { value: "Uber", confidence: "high",   reason: `"Uber" found ${uberCount}×` };
  if (boltCount === 1) return { value: "Bolt", confidence: "medium", reason: `"Bolt" found once` };
  if (uberCount === 1) return { value: "Uber", confidence: "medium", reason: `"Uber" found once` };

  return none("No platform keyword found");
}

// ─── Gross income ─────────────────────────────────────────────────────────────
// Rule: only autofill when HIGH. Reject > 3000. Parse comma decimals correctly.

function findGross(lines: string[]): ExtractedField<number> {
  for (const [group, isStrong] of [
    [GROSS_KEYWORDS_STRONG, true],
    [GROSS_KEYWORDS_WEAK,   false],
  ] as [string[], boolean][]) {
    for (let i = 0; i < lines.length; i++) {
      const keywordLine = normalize(lines[i]);
      const keyword     = group.find((k) => keywordLine.includes(k));
      if (!keyword) continue;

      // Look at the keyword line first. Only borrow the next line if the
      // keyword line has no usable number (avoids stealing the rides count).
      const keywordHasNumber = /\d/.test(keywordLine);
      const scanText = keywordHasNumber
        ? keywordLine
        : normalize(`${lines[i]} ${lines[i + 1] ?? ""}`);
      const sourceLine = keywordHasNumber ? lines[i] : `${lines[i]} ${lines[i + 1] ?? ""}`.trim();

      const hasCurrency = /\b(lei|ron|mdl)\b/.test(scanText);

      const candidates: number[] = [];
      for (const m of scanText.matchAll(/\d[\d.,]*/g)) {
        const val = parseNumber(m[0]);
        // Reject impossible / suspicious values up front.
        if (val !== undefined && val >= 1 && val <= LIMITS.maxGrossPerDay) {
          candidates.push(val);
        }
      }
      if (candidates.length === 0) continue;

      // Prefer values with decimals (more likely money); else the largest valid.
      const withDecimal = candidates.filter((v) => !Number.isInteger(v));
      const chosen = withDecimal.length > 0 ? withDecimal[0] : Math.max(...candidates);

      const confidence: ConfidenceLevel =
        isStrong && hasCurrency ? "high" :
        isStrong || hasCurrency ? "medium" :
        "low";

      return {
        value: chosen,
        confidence,
        sourceLine,
        reason: `Keyword "${keyword}"${hasCurrency ? " + currency" : ""}`,
      };
    }
  }
  return none("No income keyword matched");
}

// ─── Hours ────────────────────────────────────────────────────────────────────
// Rule: only explicit time patterns. Reject > 24. Never grab a random number.

function parseHoursValue(text: string): { value: number; explicit: boolean } | undefined {
  // Matches "6h 30min", "6h30min", "6 ore 30 min", "6,5h", "6hours30min" etc.
  // ore/hours? are checked before bare h so "hours" is consumed whole, not just "h".
  const hMin = text.match(/(\d+(?:[,.]\d+)?)\s*(?:ore|hours?|h)\s*(?:(\d+)\s*(?:m\b|min|minute))?/);
  if (hMin) {
    const hours   = parseNumber(hMin[1]) ?? 0;
    const minutes = hMin[2] ? Number(hMin[2]) / 60 : 0;
    return { value: hours + minutes, explicit: true };
  }
  const colon = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colon) return { value: Number(colon[1]) + Number(colon[2]) / 60, explicit: true };
  return undefined;
}

function findHours(lines: string[]): ExtractedField<number> {
  for (let i = 0; i < lines.length; i++) {
    const sourceLine = `${lines[i]}${lines[i + 1] ? " " + lines[i + 1] : ""}`;
    const combined   = normalize(sourceLine);
    const keyword    = HOURS_KEYWORDS.find((k) => combined.includes(k));
    if (!keyword) continue;

    const result = parseHoursValue(combined);
    if (result && result.value > 0 && result.value <= LIMITS.maxHoursPerDay) {
      return {
        value: result.value,
        confidence: result.explicit ? "high" : "medium",
        sourceLine,
        reason: `Time pattern near "${keyword}"`,
      };
    }
  }
  return none("No hours pattern near keyword");
}

// ─── Rides ────────────────────────────────────────────────────────────────────
// Rule: only near keywords, reject > 100, ignore decimal sub-parts.

function findRides(lines: string[]): ExtractedField<number> {
  for (let i = 0; i < lines.length; i++) {
    const keywordLine = normalize(lines[i]);
    const keyword     = RIDES_KEYWORDS.find((k) => keywordLine.includes(k));
    if (!keyword) continue;

    // Integers NOT adjacent to comma/dot (avoids "50" inside "245,50").
    const ridesRegex = /(?<![.,\d])(\d{1,3})(?![.,\d])/g;
    const onKeywordLine = Array.from(keywordLine.matchAll(ridesRegex))
      .map((m) => parseInt(m[1], 10))
      .filter((n) => n >= 1 && n <= LIMITS.maxRidesPerDay);

    if (onKeywordLine.length > 0) {
      return { value: onKeywordLine[0], confidence: "high", sourceLine: lines[i], reason: `Near keyword "${keyword}"` };
    }

    // If the keyword line already has digits (just out of range/invalid), trust it —
    // do NOT borrow a number from the next line.
    if (/\d/.test(keywordLine)) {
      return none(`Rides value near "${keyword}" was invalid or > ${LIMITS.maxRidesPerDay}`);
    }

    // Keyword line had no digit at all — try the next line (label/value split layout).
    const nextLine = normalize(lines[i + 1] ?? "");
    const onNextLine = Array.from(nextLine.matchAll(ridesRegex))
      .map((m) => parseInt(m[1], 10))
      .filter((n) => n >= 1 && n <= LIMITS.maxRidesPerDay);

    if (onNextLine.length > 0) {
      return {
        value: onNextLine[0],
        confidence: "medium",
        sourceLine: `${lines[i]} ${lines[i + 1] ?? ""}`.trim(),
        reason: `Value on line after keyword "${keyword}"`,
      };
    }
  }
  return none("No rides keyword matched (or value > 100)");
}

// ─── Date ─────────────────────────────────────────────────────────────────────
// Rule: only accept dates inside the configured week. Never default to day one.

function findDate(text: string): ExtractedField<string> {
  const n           = normalize(text);
  const defaultYear = Number(CONFIG.weekStart.slice(0, 4));

  const iso = n.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const d = formatDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (inInterval(d)) return { value: d, confidence: "high", sourceLine: iso[0], reason: "ISO date" };
  }

  const numeric = n.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](20\d{2}))?\b/);
  if (numeric) {
    const d = formatDate(Number(numeric[3] ?? defaultYear), Number(numeric[2]), Number(numeric[1]));
    if (inInterval(d)) return { value: d, confidence: "high", sourceLine: numeric[0], reason: "Numeric date" };
  }

  const monthNames = Object.keys(MONTHS).join("|");
  const named = n.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})(?:\\s+(20\\d{2}))?\\b`));
  if (named) {
    const d = formatDate(Number(named[3] ?? defaultYear), MONTHS[named[2]], Number(named[1]));
    if (inInterval(d)) return { value: d, confidence: "high", sourceLine: named[0], reason: "Named date" };
  }

  return none("No valid work date found in text");
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function parseScreenshotText(rawInput: string): ScreenshotExtract {
  const text    = sanitizeOcr(rawInput);
  const trimmed = text.trim();

  const rawTextQuality: ScreenshotExtract["rawTextQuality"] =
    !trimmed            ? "empty" :
    trimmed.length < 60 ? "short" :
    "ok";

  if (rawTextQuality !== "ok") {
    const reason = rawTextQuality === "empty"
      ? "OCR returned no text"
      : "OCR text too short to parse reliably";
    return {
      platforma: none(reason),
      brut:      none(reason),
      curse:     none(reason),
      ore:       none(reason),
      data:      none(reason),
      rawTextQuality,
    };
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  return {
    platforma: findPlatform(text),
    brut:      findGross(lines),
    curse:     findRides(lines),
    ore:       findHours(lines),
    data:      findDate(text),
    rawTextQuality,
  };
}

/** True when the field can be auto-filled into the form without user input. */
export function shouldAutofill(confidence: ConfidenceLevel): boolean {
  return confidence === "high" || confidence === "medium";
}

/** Gross income is the most dangerous field — only autofill when HIGH. */
export function shouldAutofillGross(confidence: ConfidenceLevel): boolean {
  return confidence === "high";
}
