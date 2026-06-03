export type Platforma = "Uber" | "Bolt";
export type Sursa = "Manual" | "Poză" | "Screenshot";

export interface ZiData {
  id: string;
  data: string; // YYYY-MM-DD
  platforma: Platforma;
  brut: number;
  curse: number;
  ore: number;
  km?: number;
  combustibil: number;
  observatii?: string;
  sursa: Sursa;
}

export const CONFIG = {
  masina: "Dacia Logan",
  chirie: 500,
  comisionFlota: 0.1,
  comisionUber: 0.25,
  comisionBolt: 0.25,
  kmPerCursa: 1.5,
  reperCombustibil: 500,
  weekStart: "2026-05-10",
  weekEnd: "2026-05-16", // 7-day week: 10–16 May 2026 (inclusive)
};

const KEY = "analiza-saptamana-uber-bolt-v1";

const PLATFORME: Platforma[] = ["Uber", "Bolt"];
const SURSE: Sursa[] = ["Manual", "Poză", "Screenshot"];

/** Validates and coerces one unknown record into a safe ZiData, or null if unusable. */
function sanitizeZi(raw: unknown): ZiData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.data)) return null;

  const numOrZero = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const optNum = (v: unknown) => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  return {
    id:          typeof r.id === "string" && r.id ? r.id : r.data,
    data:        r.data,
    platforma:   PLATFORME.includes(r.platforma as Platforma) ? (r.platforma as Platforma) : "Uber",
    brut:        numOrZero(r.brut),
    curse:       numOrZero(r.curse),
    ore:         numOrZero(r.ore),
    km:          optNum(r.km),
    combustibil: numOrZero(r.combustibil),
    observatii:  typeof r.observatii === "string" ? r.observatii : undefined,
    sursa:       SURSE.includes(r.sursa as Sursa) ? (r.sursa as Sursa) : "Manual",
  };
}

export function parseZile(raw: unknown): ZiData[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeZi).filter((z): z is ZiData => z !== null);
}

export function loadZile(): ZiData[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parseZile(parsed);
  } catch {
    return [];
  }
}

export function saveZile(zile: ZiData[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(zile));
  } catch {
    // Storage full / disabled (private mode) — fail silently, app stays usable in-memory.
  }
}

export function clearZile() {
  localStorage.removeItem(KEY);
}

export function calculZi(z: ZiData) {
  const comPlatRate = z.platforma === "Uber" ? CONFIG.comisionUber : CONFIG.comisionBolt;
  const comPlat = z.brut * comPlatRate;
  const ramas = z.brut - comPlat;
  const comFlota = ramas * CONFIG.comisionFlota;
  const profitInainteChirie = ramas - comFlota - z.combustibil;
  const profitDupaChirie = profitInainteChirie - CONFIG.chirie / 7;
  const kmOperationali = (z.km ?? 0) + z.curse * CONFIG.kmPerCursa;
  return { comPlat, ramas, comFlota, profitInainteChirie, profitDupaChirie, kmOperationali };
}

export function calculSaptamana(zile: ZiData[]) {
  const items = zile.map((z) => ({ z, c: calculZi(z) }));
  const brutTotal = items.reduce((s, x) => s + x.z.brut, 0);
  const combTotal = items.reduce((s, x) => s + x.z.combustibil, 0);
  const comPlatTotal = items.reduce((s, x) => s + x.c.comPlat, 0);
  const comFlotaTotal = items.reduce((s, x) => s + x.c.comFlota, 0);
  const profitNet = brutTotal - comPlatTotal - comFlotaTotal - combTotal - CONFIG.chirie;
  const curseTotal = items.reduce((s, x) => s + x.z.curse, 0);
  const oreTotal = items.reduce((s, x) => s + x.z.ore, 0);
  const kmTotal = items.reduce((s, x) => s + x.c.kmOperationali, 0);
  return {
    brutTotal,
    combTotal,
    comPlatTotal,
    comFlotaTotal,
    profitNet,
    curseTotal,
    oreTotal,
    kmTotal,
    profitPeZi: profitNet / 7,
    profitPeOra: oreTotal ? profitNet / oreTotal : 0,
    profitPeKm: kmTotal ? profitNet / kmTotal : 0,
    profitPeCursa: curseTotal ? profitNet / curseTotal : 0,
  };
}

export function comparaPlatforme(zile: ZiData[]) {
  const make = (plat: Platforma) => {
    const items = zile.filter((z) => z.platforma === plat).map((z) => ({ z, c: calculZi(z) }));
    const brut = items.reduce((s, x) => s + x.z.brut, 0);
    const curse = items.reduce((s, x) => s + x.z.curse, 0);
    const ore = items.reduce((s, x) => s + x.z.ore, 0);
    const comb = items.reduce((s, x) => s + x.z.combustibil, 0);
    const profitInainte = items.reduce((s, x) => s + x.c.profitInainteChirie, 0);
    return {
      platforma: plat,
      brut,
      curse,
      ore,
      comb,
      profitInainte,
      profitPeOra: ore ? profitInainte / ore : 0,
    };
  };
  return { uber: make("Uber"), bolt: make("Bolt") };
}

export function ziuaBuna(zile: ZiData[], best: boolean) {
  if (!zile.length) return null;
  const cu = zile.map((z) => ({ z, p: calculZi(z).profitDupaChirie }));
  cu.sort((a, b) => (best ? b.p - a.p : a.p - b.p));
  return cu[0];
}

export function recomandari(zile: ZiData[]) {
  const recs: string[] = [];
  if (!zile.length) {
    recs.push("Adaugă prima zi pentru a primi recomandări.");
    return recs;
  }
  const s = calculSaptamana(zile);
  const cmp = comparaPlatforme(zile);
  if (s.profitPeOra > 0 && s.profitPeOra < 30) recs.push("Profit/oră sub 30 lei — verifică intervalele orare în care lucrezi.");
  if (s.brutTotal > 0 && s.combTotal / s.brutTotal > 0.25)
    recs.push("Combustibilul depășește 25% din brut — apasă semnificativ profitul.");
  if (cmp.uber.ore > 0 && cmp.bolt.ore > 0) {
    if (cmp.uber.profitPeOra > cmp.bolt.profitPeOra) recs.push("Uber are profit/oră mai bun — alocă mai mult timp pe Uber.");
    else if (cmp.bolt.profitPeOra > cmp.uber.profitPeOra) recs.push("Bolt are profit/oră mai bun — alocă mai mult timp pe Bolt.");
  }
  const lipsesc = zile.some((z) => !z.km || !z.combustibil);
  if (lipsesc) recs.push("Unele zile au km sau combustibil lipsă — completează-le pentru calcule corecte.");
  if (s.profitNet > 0 && s.profitPeOra >= 30) recs.push("Profit net pozitiv și profit/oră bun — păstrează strategia actuală.");
  return recs;
}

export function inInterval(d: string) {
  return d >= CONFIG.weekStart && d <= CONFIG.weekEnd;
}

export function lei(n: number) {
  return n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " lei";
}