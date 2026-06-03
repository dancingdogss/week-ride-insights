import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eraser } from "lucide-react";
import { RideDayApply, RideImport } from "@/components/RideImport";
import { CONFIG, Platforma, Sursa, ZiData, applyImportedDay, calculZi, inInterval, lei } from "@/lib/weekStorage";

function datesOfWeek(): string[] {
  const out: string[] = [];
  const [year, month, day] = CONFIG.weekStart.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

function makeBlank(data: string): ZiData {
  return {
    id: data,
    data,
    platforma: "Uber",
    brut: 0,
    curse: 0,
    ore: 0,
    km: undefined,
    combustibil: 0,
    observatii: "",
    sursa: "Manual",
  };
}

const WEEKDAYS = ["Dum", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm"];
function ziLabel(d: string) {
  const [year, month, day] = d.split("-").map(Number);
  const dt = new Date(year, month - 1, day);
  return `${WEEKDAYS[dt.getDay()]} ${dt.getDate()}.${(dt.getMonth() + 1).toString().padStart(2, "0")}`;
}

interface Props {
  zile: ZiData[];
  onChange: (zile: ZiData[]) => void;
}

export function SaptamanaTable({ zile, onChange }: Props) {
  const dates = useMemo(datesOfWeek, []);

  const rows: ZiData[] = dates.map((d) => zile.find((z) => z.data === d) ?? makeBlank(d));

  function update(row: ZiData, patch: Partial<ZiData>) {
    const next: ZiData = { ...row, ...patch };
    const exists = zile.some((z) => z.id === next.id);
    onChange(exists ? zile.map((z) => (z.id === next.id ? next : z)) : [...zile, next]);
  }

  function clearRow(row: ZiData) {
    onChange(zile.filter((z) => z.id !== row.id));
  }

  function applyRideDay(day: RideDayApply) {
    // Never write a day outside the configured week (e.g. an OCR'd 2026-05-17).
    if (!inInterval(day.data)) return;
    // Pure merge into the SAME zile array the table renders; onChange persists it
    // immediately (see Index). Preserves manually entered hours / km / fuel.
    onChange(applyImportedDay(zile, day));
  }

  const num = (v: number | undefined) => (v === undefined || v === 0 ? "" : String(v));
  const parseNum = (s: string) => {
    const n = Number(s.replace(",", "."));
    return isNaN(n) || n < 0 ? 0 : n;
  };

  return (
    <div className="space-y-3">
      <RideImport dates={dates} onApplyDay={applyRideDay} />

      <div className="rounded-md border-l-4 border-accent bg-accent/10 p-3 text-xs sm:text-sm">
        Poți corecta oricând valorile manual. OCR-ul este doar un ajutor pentru completarea datelor din screenshot-uri.
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {rows.map((r) => {
          const c = calculZi(r);
          const filled = r.brut > 0 || r.ore > 0 || r.curse > 0;
          return (
            <div key={r.id} className="rounded-lg border bg-card p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{ziLabel(r.data)}</div>
                <Button size="sm" variant="ghost" onClick={() => clearRow(r)} disabled={!filled}>
                  <Eraser className="mr-1 h-4 w-4" /> Curăță
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Platformă</Label>
                  <Select value={r.platforma} onValueChange={(v) => update(r, { platforma: v as Platforma })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Uber">Uber</SelectItem>
                      <SelectItem value="Bolt">Bolt</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Brut (lei)</Label>
                  <Input inputMode="decimal" type="number" min={0} step="0.01" value={num(r.brut)} onChange={(e) => update(r, { brut: parseNum(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Curse</Label>
                  <Input inputMode="numeric" type="number" min={0} step="1" value={num(r.curse)} onChange={(e) => update(r, { curse: parseNum(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Ore</Label>
                  <Input inputMode="decimal" type="number" min={0} step="0.1" value={num(r.ore)} onChange={(e) => update(r, { ore: parseNum(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Km (opțional)</Label>
                  <Input inputMode="decimal" type="number" min={0} step="0.1" value={r.km === undefined ? "" : String(r.km)} onChange={(e) => update(r, { km: e.target.value === "" ? undefined : parseNum(e.target.value) })} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Combustibil (lei)</Label>
                  <Input inputMode="decimal" type="number" min={0} step="0.01" value={num(r.combustibil)} onChange={(e) => update(r, { combustibil: parseNum(e.target.value) })} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Sursă date</Label>
                  <Select value={r.sursa} onValueChange={(v) => update(r, { sursa: v as Sursa })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Manual">Manual</SelectItem>
                      <SelectItem value="Screenshot">Screenshot</SelectItem>
                      <SelectItem value="Poză">Poză</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Observații</Label>
                  <Textarea rows={2} value={r.observatii ?? ""} onChange={(e) => update(r, { observatii: e.target.value })} />
                </div>
              </div>
              {filled && (
                <div className="rounded-md bg-muted/40 p-2 text-xs">
                  Profit zi (cu chirie alocată): <strong>{lei(c.profitDupaChirie)}</strong>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop: table */}
      <div className="hidden lg:block overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Zi</th>
              <th className="p-2 text-left">Platformă</th>
              <th className="p-2 text-right">Brut</th>
              <th className="p-2 text-right">Curse</th>
              <th className="p-2 text-right">Ore</th>
              <th className="p-2 text-right">Km</th>
              <th className="p-2 text-right">Combust.</th>
              <th className="p-2 text-left">Sursă</th>
              <th className="p-2 text-left">Observații</th>
              <th className="p-2 text-right">Profit</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = calculZi(r);
              const filled = r.brut > 0 || r.ore > 0 || r.curse > 0;
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-2 font-medium whitespace-nowrap">{ziLabel(r.data)}</td>
                  <td className="p-2">
                    <Select value={r.platforma} onValueChange={(v) => update(r, { platforma: v as Platforma })}>
                      <SelectTrigger className="h-8 w-[90px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Uber">Uber</SelectItem>
                        <SelectItem value="Bolt">Bolt</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-2"><Input className="h-8 w-24 text-right" type="number" min={0} step="0.01" value={num(r.brut)} onChange={(e) => update(r, { brut: parseNum(e.target.value) })} /></td>
                  <td className="p-2"><Input className="h-8 w-16 text-right" type="number" min={0} step="1" value={num(r.curse)} onChange={(e) => update(r, { curse: parseNum(e.target.value) })} /></td>
                  <td className="p-2"><Input className="h-8 w-16 text-right" type="number" min={0} step="0.1" value={num(r.ore)} onChange={(e) => update(r, { ore: parseNum(e.target.value) })} /></td>
                  <td className="p-2"><Input className="h-8 w-20 text-right" type="number" min={0} step="0.1" value={r.km === undefined ? "" : String(r.km)} onChange={(e) => update(r, { km: e.target.value === "" ? undefined : parseNum(e.target.value) })} /></td>
                  <td className="p-2"><Input className="h-8 w-24 text-right" type="number" min={0} step="0.01" value={num(r.combustibil)} onChange={(e) => update(r, { combustibil: parseNum(e.target.value) })} /></td>
                  <td className="p-2">
                    <Select value={r.sursa} onValueChange={(v) => update(r, { sursa: v as Sursa })}>
                      <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Manual">Manual</SelectItem>
                        <SelectItem value="Screenshot">Screenshot</SelectItem>
                        <SelectItem value="Poză">Poză</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-2"><Input className="h-8 w-40" value={r.observatii ?? ""} onChange={(e) => update(r, { observatii: e.target.value })} /></td>
                  <td className="p-2 text-right font-medium whitespace-nowrap">{filled ? lei(c.profitDupaChirie) : "—"}</td>
                  <td className="p-2 text-right">
                    <Button size="icon" variant="ghost" onClick={() => clearRow(r)} disabled={!filled} title="Curăță rândul">
                      <Eraser className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Modificările se salvează automat în acest dispozitiv (localStorage). „Curăță” golește rândul.
      </p>
    </div>
  );
}
