import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Download, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { CONFIG, ZiData, clearZile, loadZile, parseZile, saveZile } from "@/lib/weekStorage";
import { SaptamanaTable } from "@/components/SaptamanaTable";
import { Dashboard } from "@/components/Dashboard";

const Index = () => {
  const [zile, setZile] = useState<ZiData[]>(() => loadZile());
  const fileRef = useRef<HTMLInputElement>(null);

  // Single source of truth for mutating the week: update React state AND persist
  // to localStorage synchronously, in the same action. This guarantees imported
  // (and manual) changes survive a page refresh without relying on effect timing.
  const commitZile = useCallback((next: ZiData[]) => {
    setZile(next);
    saveZile(next);
  }, []);

  function exportJson() {
    const blob = new Blob([JSON.stringify(zile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `saptamana-11-17-mai-2026.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(file: File) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result));
        const zileImportate = parseZile(parsed);
        if (!zileImportate) throw new Error();
        commitZile(zileImportate);
        toast.success("Date importate.");
      } catch {
        toast.error("Fișier JSON invalid.");
      }
    };
    r.readAsText(file);
  }

  function stergeTot() {
    clearZile();
    setZile([]);
    toast.success("Datele locale au fost șterse.");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto max-w-2xl px-4 py-4">
          <h1 className="text-xl font-bold sm:text-2xl">Analiză săptămână Uber/Bolt</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">11 mai 2026 – 17 mai 2026 · {CONFIG.masina}</p>
        </div>
      </header>

      <main className="container mx-auto max-w-2xl space-y-4 px-4 py-4 pb-24">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Context fix</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground sm:text-sm">
            <div>Mașină: <strong className="text-foreground">Dacia Logan</strong></div>
            <div>Chirie: <strong className="text-foreground">500 lei/săpt.</strong>, scăzută automat din profit</div>
            <div>Comision flotă: <strong className="text-foreground">10%</strong></div>
            <div>Comision platformă: <strong className="text-foreground">Uber 25% · Bolt 25%</strong></div>
            <div>Km până la client: <strong className="text-foreground">1,5 km/cursă</strong> (estimare automată)</div>
            <div>Reper combustibil: <strong className="text-foreground">500 lei/săpt.</strong> (doar reper)</div>
          </CardContent>
        </Card>

        <div className="rounded-md border-l-4 border-accent bg-accent/10 p-3 text-xs sm:text-sm">
          <p>Analiza este bazată doar pe datele introduse pentru săptămâna 11–17 mai 2026. Nu este o proiecție lunară.</p>
          <p className="mt-1">Combustibilul este introdus manual. Kilometrii până la client sunt estimați la 1,5 km pentru fiecare cursă.</p>
        </div>

        <Tabs defaultValue="tabel">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="tabel">Tabel săptămână</TabsTrigger>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          </TabsList>
          <TabsContent value="tabel" className="mt-4">
            <SaptamanaTable zile={zile} onChange={commitZile} />
          </TabsContent>
          <TabsContent value="dashboard" className="mt-4">
            <Dashboard zile={zile} />
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Date locale</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={exportJson}>
              <Download className="mr-2 h-4 w-4" /> Export JSON
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Import JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; }}
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="mr-2 h-4 w-4" /> Șterge datele locale
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Ștergi toate datele locale?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Această acțiune nu poate fi anulată. Toate zilele salvate vor fi pierdute.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Anulează</AlertDialogCancel>
                  <AlertDialogAction onClick={stergeTot}>Șterge tot</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Index;
