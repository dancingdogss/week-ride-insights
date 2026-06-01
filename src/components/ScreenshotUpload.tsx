import { useRef, useState } from "react";
import { createWorker, OEM, PSM } from "tesseract.js";
import { AlertCircle, AlertTriangle, Check, ImageUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Platforma, ZiData } from "@/lib/weekStorage";
import {
  parseScreenshotText,
  ConfidenceLevel,
  shouldAutofill,
  shouldAutofillGross,
} from "@/lib/ocrParsing";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScreenshotApplyData {
  data: string;
  platforma: Platforma;
  brut: number;
  curse: number;
  ore: number;
  observatii?: string;
}

interface FieldMeta {
  confidence: ConfidenceLevel;
  sourceLine?: string;
}

interface DraftMeta {
  platforma: FieldMeta;
  brut: FieldMeta;
  curse: FieldMeta;
  ore: FieldMeta;
  data: FieldMeta;
}

interface Draft {
  id:              string;
  fileName:        string;
  status:          "processing" | "ready" | "error";
  progress:        number;
  rawText:         string;
  rawTextQuality?: "ok" | "short" | "empty";
  error?:          string;
  meta:            DraftMeta;
  values: {
    /** Empty string = not chosen yet. */
    data:       string;
    platforma:  "" | Platforma;
    brut:       string;
    curse:      string;
    ore:        string;
    observatii: string;
  };
}

interface Props {
  dates:   string[];
  onApply: (draft: ScreenshotApplyData) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeId    = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const formatNum = (v: number | undefined) => (v === undefined ? "" : String(Number(v.toFixed(2))));
const parseNum  = (v: string) => {
  const p = Number(v.replace(",", "."));
  return Number.isFinite(p) && p >= 0 ? p : 0;
};

function dayLabel(date: string) {
  return `${date} (${new Date(`${date}T00:00:00`).toLocaleDateString("ro-RO", { weekday: "short" })})`;
}

const BLANK_META: DraftMeta = {
  platforma: { confidence: "none" },
  brut:      { confidence: "none" },
  curse:     { confidence: "none" },
  ore:       { confidence: "none" },
  data:      { confidence: "none" },
};

// ─── Confidence badge ─────────────────────────────────────────────────────────

const BADGE: Record<ConfidenceLevel, { label: string; cls: string }> = {
  high:   { label: "sigur",          cls: "text-green-600" },
  medium: { label: "verifică",       cls: "text-yellow-600" },
  low:    { label: "nesigur",        cls: "text-orange-500" },
  none:   { label: "nedetectat",     cls: "text-red-500" },
};

function ConfidenceBadge({ meta }: { meta: FieldMeta }) {
  const b = BADGE[meta.confidence];
  return (
    <span className={`ml-1 text-[10px] font-semibold tracking-wide ${b.cls}`} title={meta.sourceLine}>
      {b.label}
    </span>
  );
}

/** Small grey line showing which OCR text produced the value. */
function SourceHint({ meta }: { meta: FieldMeta }) {
  if (!meta.sourceLine || meta.confidence === "none") return null;
  return (
    <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={meta.sourceLine}>
      din: „{meta.sourceLine}”
    </p>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ScreenshotUpload({ dates, onApply }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts]             = useState<Draft[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((items) => items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function updateValues(id: string, values: Partial<Draft["values"]>) {
    setDrafts((items) =>
      items.map((it) => (it.id === id ? { ...it, values: { ...it.values, ...values } } : it)),
    );
  }

  async function handleFiles(files: FileList | null) {
    const images = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;

    const nextDrafts: Draft[] = images.map((file) => ({
      id:       makeId(),
      fileName: file.name,
      status:   "processing",
      progress: 0,
      rawText:  "",
      meta:     BLANK_META,
      values: {
        data:       "",      // never default the day
        platforma:  "",      // never default the platform
        brut:       "",
        curse:      "",
        ore:        "",
        observatii: `OCR screenshot: ${file.name}`,
      },
    }));

    setDrafts((items) => [...nextDrafts, ...items]);
    setIsProcessing(true);

    const worker = await createWorker(["eng", "ron"], OEM.LSTM_ONLY, {
      workerPath: "/tesseract/worker.min.js",
      corePath:   "/tesseract/tesseract-core-lstm.wasm.js",
      langPath:   "/tesseract/lang",
      gzip:       true,
      logger: (m) => {
        const cur = nextDrafts.find((d) => m.userJobId?.includes(d.id));
        if (cur && typeof m.progress === "number") {
          updateDraft(cur.id, { progress: Math.round(m.progress * 100) });
        }
      },
    });

    try {
      await worker.setParameters({
        tessedit_pageseg_mode:     PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
      });

      for (let index = 0; index < images.length; index += 1) {
        const file  = images[index];
        const draft = nextDrafts[index];
        try {
          const result  = await worker.recognize(file, {}, { text: true }, draft.id);
          const rawText = result.data.text ?? "";
          const ext     = parseScreenshotText(rawText);

          // Date: only fill if confidently inside the week; otherwise leave unselected.
          const dataVal =
            ext.data.value && dates.includes(ext.data.value) ? ext.data.value : "";

          // Platform: fill only at medium+; otherwise leave unselected (no Uber default).
          const platformaVal: "" | Platforma =
            shouldAutofill(ext.platforma.confidence) && ext.platforma.value
              ? ext.platforma.value
              : "";

          // Gross: HIGH only. Rides/hours: medium+.
          const brutVal  = shouldAutofillGross(ext.brut.confidence) ? formatNum(ext.brut.value)  : "";
          const curseVal = shouldAutofill(ext.curse.confidence)      ? formatNum(ext.curse.value) : "";
          const oreVal   = shouldAutofill(ext.ore.confidence)        ? formatNum(ext.ore.value)   : "";

          updateDraft(draft.id, {
            status:         "ready",
            progress:       100,
            rawText,
            rawTextQuality: ext.rawTextQuality,
            meta: {
              platforma: { confidence: ext.platforma.confidence, sourceLine: ext.platforma.sourceLine },
              brut:      { confidence: ext.brut.confidence,      sourceLine: ext.brut.sourceLine },
              curse:     { confidence: ext.curse.confidence,     sourceLine: ext.curse.sourceLine },
              ore:       { confidence: ext.ore.confidence,       sourceLine: ext.ore.sourceLine },
              data:      { confidence: ext.data.confidence,      sourceLine: ext.data.sourceLine },
            },
            values: {
              data:       dataVal,
              platforma:  platformaVal,
              brut:       brutVal,
              curse:      curseVal,
              ore:        oreVal,
              observatii: `OCR screenshot: ${file.name}`,
            },
          });
        } catch (error) {
          updateDraft(draft.id, {
            status: "error",
            error:  error instanceof Error ? error.message : "OCR a eșuat pentru această imagine.",
          });
        }
      }
    } finally {
      await worker.terminate();
      setIsProcessing(false);
    }
  }

  function canApply(draft: Draft): boolean {
    return draft.values.platforma !== "" && draft.values.data !== "";
  }

  function applyDraft(draft: Draft) {
    if (!canApply(draft)) return;
    onApply({
      data:       draft.values.data,
      platforma:  draft.values.platforma as Platforma,
      brut:       parseNum(draft.values.brut),
      curse:      parseNum(draft.values.curse),
      ore:        parseNum(draft.values.ore),
      observatii: draft.values.observatii || undefined,
    });
    setDrafts((items) => items.filter((it) => it.id !== draft.id));
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Încarcă screenshot-uri (opțional)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border-l-4 border-accent bg-accent/10 p-3 text-xs sm:text-sm">
          OCR-ul este doar o <strong>sugestie</strong>. Verifică fiecare câmp. Trebuie să alegi
          manual <strong>platforma</strong> și <strong>ziua</strong> înainte de a aplica.
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={isProcessing}>
            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageUp className="mr-2 h-4 w-4" />}
            Încarcă screenshot-uri
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }}
          />
          <span className="text-xs text-muted-foreground">Imaginile rămân pe acest dispozitiv. Fără server.</span>
        </div>

        {drafts.map((draft) => (
          <div key={draft.id} className="rounded-md border p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{draft.fileName}</div>
                {draft.status === "processing" && (
                  <div className="text-xs text-muted-foreground">OCR în curs… {draft.progress}%</div>
                )}
                {draft.status === "error" && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5" /> {draft.error}
                  </div>
                )}
                {draft.status === "ready" && draft.rawTextQuality !== "ok" && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-orange-500">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {draft.rawTextQuality === "empty"
                      ? "OCR nu a găsit text — completează manual toate câmpurile."
                      : "Text OCR foarte scurt — rezultatele pot fi greșite."}
                  </div>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setDrafts((items) => items.filter((it) => it.id !== draft.id))}
                title="Elimină"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {draft.status === "ready" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {/* Day */}
                  <div className="col-span-2 sm:col-span-1">
                    <Label className="text-xs">
                      Ziua <ConfidenceBadge meta={draft.meta.data} />
                    </Label>
                    <Select value={draft.values.data} onValueChange={(v) => updateValues(draft.id, { data: v })}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Alege ziua" /></SelectTrigger>
                      <SelectContent>
                        {dates.map((d) => (
                          <SelectItem key={d} value={d}>{dayLabel(d)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <SourceHint meta={draft.meta.data} />
                  </div>

                  {/* Platform */}
                  <div className="col-span-2 sm:col-span-1">
                    <Label className="text-xs">
                      Platformă <ConfidenceBadge meta={draft.meta.platforma} />
                    </Label>
                    <Select
                      value={draft.values.platforma}
                      onValueChange={(v) => updateValues(draft.id, { platforma: v as Platforma })}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="Alege platforma" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Uber">Uber</SelectItem>
                        <SelectItem value="Bolt">Bolt</SelectItem>
                      </SelectContent>
                    </Select>
                    <SourceHint meta={draft.meta.platforma} />
                  </div>

                  {/* Gross */}
                  <div>
                    <Label className="text-xs">
                      Venit brut (lei) <ConfidenceBadge meta={draft.meta.brut} />
                    </Label>
                    <Input
                      inputMode="decimal" type="number" min={0} step="0.01"
                      placeholder="Completează manual"
                      value={draft.values.brut}
                      onChange={(e) => updateValues(draft.id, { brut: e.target.value })}
                    />
                    <SourceHint meta={draft.meta.brut} />
                  </div>

                  {/* Rides */}
                  <div>
                    <Label className="text-xs">
                      Curse <ConfidenceBadge meta={draft.meta.curse} />
                    </Label>
                    <Input
                      inputMode="numeric" type="number" min={0} step="1"
                      placeholder="Completează manual"
                      value={draft.values.curse}
                      onChange={(e) => updateValues(draft.id, { curse: e.target.value })}
                    />
                    <SourceHint meta={draft.meta.curse} />
                  </div>

                  {/* Hours */}
                  <div>
                    <Label className="text-xs">
                      Ore online <ConfidenceBadge meta={draft.meta.ore} />
                    </Label>
                    <Input
                      inputMode="decimal" type="number" min={0} step="0.1"
                      placeholder="Completează manual"
                      value={draft.values.ore}
                      onChange={(e) => updateValues(draft.id, { ore: e.target.value })}
                    />
                    <SourceHint meta={draft.meta.ore} />
                  </div>

                  {/* Notes */}
                  <div>
                    <Label className="text-xs">Observații</Label>
                    <Input
                      value={draft.values.observatii}
                      onChange={(e) => updateValues(draft.id, { observatii: e.target.value })}
                    />
                  </div>
                </div>

                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">
                    Text OCR brut ({draft.rawText.trim().length} caractere)
                  </summary>
                  <Textarea className="mt-2 font-mono text-xs" rows={5} readOnly value={draft.rawText} />
                </details>

                <Button size="sm" onClick={() => applyDraft(draft)} disabled={!canApply(draft)}>
                  <Check className="mr-2 h-4 w-4" /> Aplică la ziua aleasă
                </Button>
                {!canApply(draft) && (
                  <p className="text-[11px] text-orange-500">
                    Alege platforma și ziua pentru a putea aplica.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
