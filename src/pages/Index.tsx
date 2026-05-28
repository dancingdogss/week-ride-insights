import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { CONFIG, ZiData, clearZile, loadZile, saveZile } from "@/lib/weekStorage";
import { ZiForm } from "@/components/ZiForm";
import { ZileList } from "@/components/ZileList";
import { Dashboard } from "@/components/Dashboard";

const Index = () => {
  const [zile, setZile] = useState<ZiData[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ZiData | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setZile(loadZile()); }, []);
  useEffect(() => { saveZile(zile); }, [zile]);

  function upsert(z: ZiData) {
    setZile((prev) => {
      const exists = prev.some((p) => p.id === z.id);
      return exists ? prev.map((p) => (p.id === z.id ? z : p)) : [...prev, z];
    });
    setAdding(false);
    setEditing(null);
    toast.success("Zi salvată.");
  }

  function del(id: string) {
    setZile((prev) => prev.filter((p) => p.id !== id));
    toast.success("Zi ștearsă.");
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(zile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `saptamana-10-17-mai-2026.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(file: File) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result));
        if (!Array.isArray(parsed)) throw new Error();
        setZile(parsed);
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
          <p className="text-xs text-muted-foreground sm:text-sm">10 mai 2026 – 17 mai 2026 · {CONFIG.masina}</p>
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
          <p>Analiza este bazată doar pe datele introduse pentru săptămâna 10–17 mai 2026. Nu este o proiecție lunară.</p>
          <p className="mt-1">Combustibilul este introdus manual. Kilometrii până la client sunt estimați la 1,5 km pentru fiecare cursă.</p>
        </div>

        <Tabs defaultValue="dashboard">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="zile">Zile ({zile.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard" className="mt-4">
            <Dashboard zile={zile} />
          </TabsContent>
          <TabsContent value="zile" className="mt-4 space-y-3">
            <Dialog open={adding || !!editing} onOpenChange={(o) => { if (!o) { setAdding(false); setEditing(null); } }}>
              <DialogTrigger asChild>
                <Button className="w-full" onClick={() => setAdding(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Adaugă zi
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>{editing ? "Editează zi" : "Adaugă zi"}</DialogTitle></DialogHeader>
                <ZiForm
                  initial={editing ?? undefined}
                  onSave={upsert}
                  onCancel={() => { setAdding(false); setEditing(null); }}
                />
              </DialogContent>
            </Dialog>
            <ZileList zile={zile} onEdit={(z) => setEditing(z)} onDelete={del} />
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
