import { useState } from "react";
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
import { CONFIG, inInterval, Platforma, Sursa, ZiData } from "@/lib/weekStorage";
import { toast } from "sonner";

interface Props {
  initial?: ZiData;
  onSave: (z: ZiData) => void;
  onCancel?: () => void;
}

export function ZiForm({ initial, onSave, onCancel }: Props) {
  const [data, setData] = useState(initial?.data ?? CONFIG.weekStart);
  const [platforma, setPlatforma] = useState<Platforma>(initial?.platforma ?? "Uber");
  const [brut, setBrut] = useState(initial?.brut.toString() ?? "");
  const [curse, setCurse] = useState(initial?.curse.toString() ?? "");
  const [ore, setOre] = useState(initial?.ore.toString() ?? "");
  const [km, setKm] = useState(initial?.km?.toString() ?? "");
  const [combustibil, setCombustibil] = useState(initial?.combustibil.toString() ?? "");
  const [observatii, setObservatii] = useState(initial?.observatii ?? "");
  const [sursa, setSursa] = useState<Sursa>(initial?.sursa ?? "Manual");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!inInterval(data)) return toast.error("Data trebuie în intervalul 10–16 mai 2026.");
    if (!platforma) return toast.error("Selectează platforma.");
    const nums = { brut: +brut, curse: +curse, ore: +ore, combustibil: +combustibil, km: km ? +km : undefined };
    if ([nums.brut, nums.curse, nums.ore, nums.combustibil].some((n) => isNaN(n) || n < 0))
      return toast.error("Valorile numerice nu pot fi negative.");
    if (nums.km !== undefined && (isNaN(nums.km) || nums.km < 0))
      return toast.error("Kilometrii nu pot fi negativi.");
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      data,
      platforma,
      brut: nums.brut,
      curse: nums.curse,
      ore: nums.ore,
      km: nums.km,
      combustibil: nums.combustibil,
      observatii: observatii || undefined,
      sursa,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Data</Label>
          <Input
            type="date"
            value={data}
            min={CONFIG.weekStart}
            max={CONFIG.weekEnd}
            onChange={(e) => setData(e.target.value)}
            required
          />
        </div>
        <div className="col-span-2">
          <Label>Platformă</Label>
          <Select value={platforma} onValueChange={(v) => setPlatforma(v as Platforma)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Uber">Uber</SelectItem>
              <SelectItem value="Bolt">Bolt</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Venit brut (lei)</Label>
          <Input inputMode="decimal" type="number" min={0} step="0.01" value={brut} onChange={(e) => setBrut(e.target.value)} required />
        </div>
        <div>
          <Label>Curse</Label>
          <Input inputMode="numeric" type="number" min={0} step="1" value={curse} onChange={(e) => setCurse(e.target.value)} required />
        </div>
        <div>
          <Label>Ore lucrate</Label>
          <Input inputMode="decimal" type="number" min={0} step="0.1" value={ore} onChange={(e) => setOre(e.target.value)} required />
        </div>
        <div>
          <Label>Km parcurși (opțional)</Label>
          <Input inputMode="decimal" type="number" min={0} step="0.1" value={km} onChange={(e) => setKm(e.target.value)} />
        </div>
        <div className="col-span-2">
          <Label>Cost combustibil (lei)</Label>
          <Input inputMode="decimal" type="number" min={0} step="0.01" value={combustibil} onChange={(e) => setCombustibil(e.target.value)} required />
        </div>
        <div className="col-span-2">
          <Label>Sursă date</Label>
          <Select value={sursa} onValueChange={(v) => setSursa(v as Sursa)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Manual">Manual</SelectItem>
              <SelectItem value="Poză">Poză</SelectItem>
              <SelectItem value="Screenshot">Screenshot</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <Label>Observații</Label>
          <Textarea value={observatii} onChange={(e) => setObservatii(e.target.value)} rows={2} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1">Salvează ziua</Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Anulează</Button>}
      </div>
    </form>
  );
}