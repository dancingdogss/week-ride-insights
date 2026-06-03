// ─── Shared OCR text helpers ──────────────────────────────────────────────────
// Single source of truth for cleaning + interpreting raw OCR output.
// Used by both the legacy summary parser (ocrParsing) and the ride-level
// extractor (rideExtraction).

/**
 * Fixes common OCR substitution artifacts before any parsing takes place:
 * - Smart/curly quotes → straight apostrophe / quote
 * - Typographic ligatures (fi, fl) → plain ASCII
 * - Pipe character between digits → digit 1 (e.g. "24|5" → "2415")
 * - "lei" currency token misread next to digits ("15,021ei" → "15,02 lei")
 * - Zero-width / BOM characters stripped
 * - Degree symbol that OCR sometimes places near digit separators
 */
export function sanitizeOcr(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/(?<=\d)\|(?=\d)/g, "1")
    // "lei" after a number is often mangled (l→1, l→i): "15,021ei" / "12,7Oiei".
    .replace(/(?<=\d)\s*[1li]ei\b/gi, " lei")
    .replace(/[​‌‍﻿]/g, "")
    .replace(/°/g, "");
}

/** Lowercase + strip diacritics so Romanian keywords match reliably. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Parses a Romanian/international number string to a float.
 * "245,50" → 245.5  |  "1.245,50" → 1245.5  |  "245.50" → 245.5
 * Never turns "123,63" into 12363.
 */
export function parseNumber(raw: string): number | undefined {
  const cleaned = raw.replace(/\s+/g, "");
  if (!cleaned) return undefined;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimal = lastComma > lastDot ? "," : lastDot > -1 ? "." : "";
  const normalized = decimal
    ? cleaned
        .replace(new RegExp(`\\${decimal === "," ? "." : ","}`, "g"), "")
        .replace(decimal, ".")
    : cleaned.replace(/[,.]/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Extracts the first monetary amount immediately followed by a currency token
 * (lei / ron / mdl). Returns undefined when no currency-tagged number is found.
 * "Plata in numerar 16,70 lei" → 16.7   |   "Puncte Bolt 100" → undefined
 */
export function parseMoney(text: string): number | undefined {
  const n = normalize(text);
  const m = n.match(/(\d[\d.,]*)\s*(?:lei|ron|mdl)\b/);
  return m ? parseNumber(m[1]) : undefined;
}

/** All currency-tagged amounts found in the text, in order of appearance. */
export function parseAllMoney(text: string): number[] {
  const n = normalize(text);
  const out: number[] = [];
  for (const m of n.matchAll(/(\d[\d.,]*)\s*(?:lei|ron|mdl)\b/g)) {
    const v = parseNumber(m[1]);
    if (v !== undefined) out.push(v);
  }
  return out;
}

// ─── Romanian dates ─────────────────────────────────────────────────────────

export const MONTHS: Record<string, number> = {
  ianuarie: 1, februarie: 2, martie: 3, aprilie: 4, mai: 5, iunie: 6,
  iulie: 7, august: 8, septembrie: 9, octombrie: 10, noiembrie: 11, decembrie: 12,
};

const MONTH_NAMES = Object.keys(MONTHS).join("|");

export function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface ParsedDate {
  /** YYYY-MM-DD when day+month resolved, else undefined. */
  date?: string;
  /** HH:MM when a time component is present. */
  time?: string;
  /** The matched substring, for display / verification. */
  raw: string;
}

/**
 * Parses a single Romanian date line in the formats produced by the Bolt app:
 *   "10 mai 2026, 13:26"  → { date: "2026-05-10", time: "13:26" }
 *   "17 mai, 14:00"       → { date: "<defaultYear>-05-17", time: "14:00" }
 *   "17 mai"              → { date: "<defaultYear>-05-17" }
 *   "10.05.2026 13:26"    → { date: "2026-05-10", time: "13:26" }
 * Returns undefined when no day+month can be found.
 */
export function parseRomanianDate(line: string, defaultYear: number): ParsedDate | undefined {
  const n = normalize(line);

  // Named month: "10 mai 2026, 13:26" / "17 mai, 14:00" / "17 mai"
  const named = n.match(
    new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES})(?:\\s+(20\\d{2}))?`),
  );
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2]];
    const year = named[3] ? Number(named[3]) : defaultYear;
    if (day >= 1 && day <= 31) {
      const time = n.match(/\b(\d{1,2}):(\d{2})\b/);
      return {
        date: formatDate(year, month, day),
        time: time ? `${time[1].padStart(2, "0")}:${time[2]}` : undefined,
        raw: named[0],
      };
    }
  }

  // Numeric: "10.05.2026" / "10/05/2026" / "10-05-2026"
  const numeric = n.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](20\d{2}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = numeric[3] ? Number(numeric[3]) : defaultYear;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const time = n.match(/\b(\d{1,2}):(\d{2})\b/);
      return {
        date: formatDate(year, month, day),
        time: time ? `${time[1].padStart(2, "0")}:${time[2]}` : undefined,
        raw: numeric[0],
      };
    }
  }

  return undefined;
}
