import { CONFIG, Platforma, inInterval } from "@/lib/weekStorage";

export interface ScreenshotExtract {
  platforma?: Platforma;
  brut?: number;
  curse?: number;
  ore?: number;
  data?: string;
}

const MONTHS: Record<string, number> = {
  ianuarie: 1,
  februarie: 2,
  martie: 3,
  aprilie: 4,
  mai: 5,
  iunie: 6,
  iulie: 7,
  august: 8,
  septembrie: 9,
  octombrie: 10,
  noiembrie: 11,
  decembrie: 12,
};

function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseNumber(raw: string): number | undefined {
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

function numbersIn(text: string): number[] {
  return Array.from(text.matchAll(/\d+(?:[\s.,]\d{3})*(?:[,.]\d+)?|\d+/g))
    .map((match) => parseNumber(match[0]))
    .filter((value): value is number => value !== undefined);
}

function lineScore(line: string, keywords: string[]) {
  const normalized = normalize(line);
  return keywords.reduce((score, keyword) => (normalized.includes(keyword) ? score + 1 : score), 0);
}

function findPlatform(text: string): Platforma | undefined {
  const normalized = normalize(text);
  if (normalized.includes("bolt")) return "Bolt";
  if (normalized.includes("uber")) return "Uber";
  return undefined;
}

function findGross(lines: string[]) {
  const keywords = ["castig", "incas", "venit", "brut", "total", "earnings", "income", "fare"];
  let best: { value: number; score: number } | undefined;

  lines.forEach((line, index) => {
    const joined = `${line} ${lines[index + 1] ?? ""}`;
    const hasCurrency = /\b(lei|ron|mdl)\b/i.test(joined);
    const score = lineScore(joined, keywords) + (hasCurrency ? 1 : 0);
    if (!score) return;

    const values = numbersIn(joined).filter((value) => value >= 1);
    const value = values.length ? Math.max(...values) : undefined;
    if (value === undefined) return;
    if (!best || score > best.score || (score === best.score && value > best.value)) {
      best = { value, score };
    }
  });

  return best?.value;
}

function findIntegerByKeywords(lines: string[], keywords: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const joined = `${lines[index]} ${lines[index + 1] ?? ""}`;
    const normalized = normalize(joined);
    const keyword = keywords.find((item) => normalized.includes(item));
    if (!keyword) continue;
    const afterKeyword = normalized.slice(normalized.indexOf(keyword));
    const value = numbersIn(afterKeyword).find((item) => Number.isInteger(item) && item >= 0 && item < 1000);
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseHours(text: string): number | undefined {
  const normalized = normalize(text);
  const hMin = normalized.match(/(\d+(?:[,.]\d+)?)\s*(?:h|ore|hours?)\s*(?:(\d+)\s*(?:m|min|minute))?/);
  if (hMin) {
    const hours = parseNumber(hMin[1]) ?? 0;
    const minutes = hMin[2] ? Number(hMin[2]) / 60 : 0;
    return hours + minutes;
  }

  const colon = normalized.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colon) return Number(colon[1]) + Number(colon[2]) / 60;

  return numbersIn(normalized).find((value) => value > 0 && value < 24);
}

function findHours(lines: string[]) {
  const keywords = ["online", "timp", "ore", "hours", "active"];
  for (let index = 0; index < lines.length; index += 1) {
    const joined = `${lines[index]} ${lines[index + 1] ?? ""}`;
    if (!lineScore(joined, keywords)) continue;
    const value = parseHours(joined);
    if (value !== undefined) return value;
  }
  return undefined;
}

function formatDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function findDate(text: string) {
  const normalized = normalize(text);
  const defaultYear = Number(CONFIG.weekStart.slice(0, 4));

  const iso = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const date = formatDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (inInterval(date)) return date;
  }

  const numeric = normalized.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](20\d{2}))?\b/);
  if (numeric) {
    const date = formatDate(Number(numeric[3] ?? defaultYear), Number(numeric[2]), Number(numeric[1]));
    if (inInterval(date)) return date;
  }

  const monthNames = Object.keys(MONTHS).join("|");
  const named = normalized.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})(?:\\s+(20\\d{2}))?\\b`));
  if (named) {
    const date = formatDate(Number(named[3] ?? defaultYear), MONTHS[named[2]], Number(named[1]));
    if (inInterval(date)) return date;
  }

  return undefined;
}

export function parseScreenshotText(text: string): ScreenshotExtract {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    platforma: findPlatform(text),
    brut: findGross(lines),
    curse: findIntegerByKeywords(lines, ["curse", "calatorii", "rides", "trips", "comenzi"]),
    ore: findHours(lines),
    data: findDate(text),
  };
}
