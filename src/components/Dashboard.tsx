import { calculSaptamana, comparaPlatforme, lei, recomandari, ziuaBuna, ZiData } from "@/lib/weekStorage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Stat({ label, value, accent }: { label: string; value: string; accent?: "profit" | "loss" }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${accent === "profit" ? "text-[hsl(var(--profit))]" : accent === "loss" ? "text-[hsl(var(--loss))]" : ""}`}>
        {value}
      </div>
    </div>
  );
}

export function Dashboard({ zile }: { zile: ZiData[] }) {
  const s = calculSaptamana(zile);
  const cmp = comparaPlatforme(zile);
  const best = ziuaBuna(zile, true);
  const worst = ziuaBuna(zile, false);
  const recs = recomandari(zile);

  const profitAccent = s.profitNet >= 0 ? "profit" : "loss";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Venit brut săptămână" value={lei(s.brutTotal)} />
        <Stat label="Profit net săptămână" value={lei(s.profitNet)} accent={profitAccent} />
        <Stat label="Profit net / zi" value={lei(s.profitPeZi)} />
        <Stat label="Profit / oră" value={lei(s.profitPeOra)} />
        <Stat label="Profit / km" value={lei(s.profitPeKm)} />
        <Stat label="Profit / cursă" value={lei(s.profitPeCursa)} />
        <Stat label="Cost combustibil total" value={lei(s.combTotal)} />
        <Stat label="Chirie scăzută auto" value={lei(500)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uber vs Bolt</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["uber", "bolt"] as const).map((k) => {
            const p = cmp[k];
            return (
              <div key={k} className="rounded-md border p-3">
                <div className="mb-2 font-semibold">{p.platforma}</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Brut: </span>{lei(p.brut)}</div>
                  <div><span className="text-muted-foreground">Curse: </span>{p.curse}</div>
                  <div><span className="text-muted-foreground">Ore: </span>{p.ore.toFixed(1)}</div>
                  <div><span className="text-muted-foreground">Combustibil: </span>{lei(p.comb)}</div>
                  <div><span className="text-muted-foreground">Profit înainte chirie: </span>{lei(p.profitInainte)}</div>
                  <div><span className="text-muted-foreground">Profit/oră: </span>{lei(p.profitPeOra)}</div>
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">Comparația platformelor este înainte de chiria săptămânală.</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Cea mai bună zi</CardTitle></CardHeader>
          <CardContent>
            {best ? (
              <div className="text-sm">
                <div className="font-semibold">{best.z.data} · {best.z.platforma}</div>
                <div>Profit (cu chirie alocată): {lei(best.p)}</div>
              </div>
            ) : <div className="text-sm text-muted-foreground">Nicio zi.</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Cea mai slabă zi</CardTitle></CardHeader>
          <CardContent>
            {worst ? (
              <div className="text-sm">
                <div className="font-semibold">{worst.z.data} · {worst.z.platforma}</div>
                <div>Profit (cu chirie alocată): {lei(worst.p)}</div>
              </div>
            ) : <div className="text-sm text-muted-foreground">Nicio zi.</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recomandări pentru săptămâna următoare</CardTitle></CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {recs.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}