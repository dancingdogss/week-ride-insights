import { calculZi, lei, ZiData } from "@/lib/weekStorage";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";

export function ZileList({ zile, onEdit, onDelete }: { zile: ZiData[]; onEdit: (z: ZiData) => void; onDelete: (id: string) => void }) {
  if (!zile.length) {
    return <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Nicio zi adăugată încă.</div>;
  }
  const sorted = [...zile].sort((a, b) => a.data.localeCompare(b.data));
  return (
    <div className="space-y-3">
      {sorted.map((z) => {
        const c = calculZi(z);
        return (
          <div key={z.id} className="rounded-lg border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="font-semibold">{z.data}</div>
                <div className="text-xs text-muted-foreground">{z.platforma} · {z.sursa}</div>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => onEdit(z)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => onDelete(z.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 text-sm">
              <div><span className="text-muted-foreground">Brut: </span>{lei(z.brut)}</div>
              <div><span className="text-muted-foreground">Curse: </span>{z.curse}</div>
              <div><span className="text-muted-foreground">Ore: </span>{z.ore}</div>
              <div><span className="text-muted-foreground">Km op.: </span>{c.kmOperationali.toFixed(1)}</div>
              <div><span className="text-muted-foreground">Combustibil: </span>{lei(z.combustibil)}</div>
              <div className="font-medium"><span className="text-muted-foreground">Profit zi: </span>{lei(c.profitDupaChirie)}</div>
            </div>
            {z.observatii && <div className="mt-2 text-xs text-muted-foreground">„{z.observatii}”</div>}
          </div>
        );
      })}
    </div>
  );
}