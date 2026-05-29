import { useRef, useState } from "react";
import { createWorker, OEM, PSM } from "tesseract.js";
import { AlertCircle, Check, ImageUp, Loader2, X } from "lucide-react";
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
import { CONFIG, Platforma, ZiData } from "@/lib/weekStorage";
import { parseScreenshotText } from "@/lib/ocrParsing";

export interface ScreenshotApplyData {
  data: string;
  platforma: Platforma;
  brut: number;
  curse: number;
  ore: number;
  observatii?: string;
}

interface Draft {
  id: string;
  fileName: string;
  status: "processing" | "ready" | "error";
  progress: number;
  rawText: string;
  error?: string;
  values: {
    data: string;
    platforma: Platforma;
    brut: string;
    curse: string;
    ore: string;
    observatii: string;
  };
}

interface Props {
  dates: string[];
  zile: ZiData[];
  onApply: (draft: ScreenshotApplyData) => void;
}

const makeId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const formatNum = (value: number | undefined) => (value === undefined ? "" : String(Number(value.toFixed(2))));
const parseNum = (value: string) => {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

function dayLabel(date: string) {
  const existing = new Date(`${date}T00:00:00`);
  return `${date} (${existing.toLocaleDateString("ro-RO", { weekday: "short" })})`;
}

export function ScreenshotUpload({ dates, zile, onApply }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function updateValues(id: string, values: Partial<Draft["values"]>) {
    setDrafts((items) =>
      items.map((item) => (item.id === id ? { ...item, values: { ...item.values, ...values } } : item)),
    );
  }

  async function handleFiles(files: FileList | null) {
    const images = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;

    const nextDrafts: Draft[] = images.map((file) => ({
      id: makeId(),
      fileName: file.name,
      status: "processing",
      progress: 0,
      rawText: "",
      values: {
        data: CONFIG.weekStart,
        platforma: "Uber",
        brut: "",
        curse: "",
        ore: "",
        observatii: `OCR screenshot: ${file.name}`,
      },
    }));

    setDrafts((items) => [...nextDrafts, ...items]);
    setIsProcessing(true);

    const worker = await createWorker(["eng", "ron"], OEM.LSTM_ONLY, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/tesseract-core-lstm.wasm.js",
      langPath: "/tesseract/lang",
      gzip: true,
      logger: (message) => {
        const current = nextDrafts.find((draft) => message.userJobId?.includes(draft.id));
        if (current && typeof message.progress === "number") {
          updateDraft(current.id, { progress: Math.round(message.progress * 100) });
        }
      },
    });

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
      });

      for (let index = 0; index < images.length; index += 1) {
        const file = images[index];
        const draft = nextDrafts[index];
        try {
          const result = await worker.recognize(file, {}, { text: true }, draft.id);
          const rawText = result.data.text ?? "";
          const extracted = parseScreenshotText(rawText);
          const data = extracted.data && dates.includes(extracted.data) ? extracted.data : CONFIG.weekStart;
          const existing = zile.find((zi) => zi.data === data);

          updateDraft(draft.id, {
            status: "ready",
            progress: 100,
            rawText,
            values: {
              data,
              platforma: extracted.platforma ?? existing?.platforma ?? "Uber",
              brut: formatNum(extracted.brut ?? existing?.brut),
              curse: formatNum(extracted.curse ?? existing?.curse),
              ore: formatNum(extracted.ore ?? existing?.ore),
              observatii: `OCR screenshot: ${file.name}`,
            },
          });
        } catch (error) {
          updateDraft(draft.id, {
            status: "error",
            error: error instanceof Error ? error.message : "OCR failed for this image.",
          });
        }
      }
    } finally {
      await worker.terminate();
      setIsProcessing(false);
    }
  }

  function applyDraft(draft: Draft) {
    onApply({
      data: draft.values.data,
      platforma: draft.values.platforma,
      brut: parseNum(draft.values.brut),
      curse: parseNum(draft.values.curse),
      ore: parseNum(draft.values.ore),
      observatii: draft.values.observatii || undefined,
    });
    setDrafts((items) => items.filter((item) => item.id !== draft.id));
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Upload screenshots</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border-l-4 border-accent bg-accent/10 p-3 text-xs sm:text-sm">
          OCR may be imperfect. Please verify values before applying them to the weekly table.
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={isProcessing}>
            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageUp className="mr-2 h-4 w-4" />}
            Upload screenshots
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <span className="text-xs text-muted-foreground">Images stay in this browser. No backend is used.</span>
        </div>

        {drafts.map((draft) => (
          <div key={draft.id} className="rounded-md border p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{draft.fileName}</div>
                {draft.status === "processing" && (
                  <div className="text-xs text-muted-foreground">OCR in progress... {draft.progress}%</div>
                )}
                {draft.status === "error" && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5" /> {draft.error}
                  </div>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setDrafts((items) => items.filter((item) => item.id !== draft.id))}
                title="Remove OCR draft"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {draft.status === "ready" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 sm:col-span-1">
                    <Label className="text-xs">Day</Label>
                    <Select value={draft.values.data} onValueChange={(value) => updateValues(draft.id, { data: value })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {dates.map((date) => (
                          <SelectItem key={date} value={date}>{dayLabel(date)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <Label className="text-xs">Platform</Label>
                    <Select
                      value={draft.values.platforma}
                      onValueChange={(value) => updateValues(draft.id, { platforma: value as Platforma })}
                    >
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Uber">Uber</SelectItem>
                        <SelectItem value="Bolt">Bolt</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Gross income</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.values.brut}
                      onChange={(event) => updateValues(draft.id, { brut: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Rides</Label>
                    <Input
                      type="number"
                      min={0}
                      step="1"
                      value={draft.values.curse}
                      onChange={(event) => updateValues(draft.id, { curse: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Hours / online time</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      value={draft.values.ore}
                      onChange={(event) => updateValues(draft.id, { ore: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Input
                      value={draft.values.observatii}
                      onChange={(event) => updateValues(draft.id, { observatii: event.target.value })}
                    />
                  </div>
                </div>

                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">OCR text</summary>
                  <Textarea className="mt-2 font-mono text-xs" rows={4} readOnly value={draft.rawText} />
                </details>

                <Button size="sm" onClick={() => applyDraft(draft)}>
                  <Check className="mr-2 h-4 w-4" /> Apply to weekly table
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
