import { useMemo, useRef, useState } from "react";
import { createWorker, OEM, PSM } from "tesseract.js";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ImageUp,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Platforma, lei } from "@/lib/weekStorage";
import {
  ActivityInfo,
  ExtractedRide,
  aggregateByDate,
  extractFromScreenshot,
  dedupeRides,
} from "@/lib/rideExtraction";

// ─── Apply contract ───────────────────────────────────────────────────────────

export interface RideDayApply {
  data: string;
  brut: number;
  curse: number;
  platforma: Platforma;
  observatii?: string;
}

interface Props {
  /** The 7 valid YYYY-MM-DD days of the configured week. */
  dates: string[];
  onApplyDay: (day: RideDayApply) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function parseNum(v: string): number | undefined {
  const t = v.trim();
  if (t === "") return undefined;
  const p = Number(t.replace(",", "."));
  return Number.isFinite(p) && p >= 0 ? p : undefined;
}

function recomputeGross(r: ExtractedRide): number {
  if (r.earnings !== undefined) return r.earnings;
  return (r.amount ?? 0) + (r.compensation ?? 0);
}

function dayLabel(date: string) {
  return `${date} (${new Date(`${date}T00:00:00`).toLocaleDateString("ro-RO", {
    weekday: "short",
  })})`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RideImport({ dates, onApplyDay }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rides, setRides] = useState<ExtractedRide[]>([]);
  const [activity, setActivity] = useState<ActivityInfo | undefined>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileCount, setFileCount] = useState(0);
  const [appliedDates, setAppliedDates] = useState<Set<string>>(new Set());
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());

  const aggregates = useMemo(() => aggregateByDate(rides), [rides]);

  async function handleFiles(files: FileList | null) {
    const images = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;

    setIsProcessing(true);
    setProgress(0);
    setFileCount(images.length);

    const worker = await createWorker(["eng", "ron"], OEM.LSTM_ONLY, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/tesseract-core-lstm.wasm.js",
      langPath: "/tesseract/lang",
      gzip: true,
    });

    const collected: ExtractedRide[] = [];
    let nextActivity = activity;

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: "1",
      });

      for (let i = 0; i < images.length; i += 1) {
        try {
          // Dates come ONLY from the OCR text of the screenshot — never from the
          // file name (a WhatsApp file name reflects when the image was saved/sent,
          // not when the ride happened).
          const result = await worker.recognize(images[i]);
          const parsed = extractFromScreenshot(result.data.text ?? "");
          collected.push(...parsed.rides);
          if (parsed.activity && !nextActivity) nextActivity = parsed.activity;
        } catch {
          // Skip an unreadable image; the rest still import.
        }
        setProgress(Math.round(((i + 1) / images.length) * 100));
      }
    } finally {
      await worker.terminate();
      setIsProcessing(false);
    }

    setRides((prev) => dedupeRides([...prev, ...collected]));
    setActivity(nextActivity);
  }

  // ── Editing ───────────────────────────────────────────────────────────────

  function patchRide(id: string, patch: Partial<ExtractedRide>) {
    setRides((items) =>
      items.map((r) => {
        if (r.id !== id) return r;
        const merged = { ...r, ...patch };
        merged.gross = recomputeGross(merged);
        return merged;
      }),
    );
  }

  function removeRide(id: string) {
    setRides((items) => items.filter((r) => r.id !== id));
  }

  function resetAll() {
    setRides([]);
    setActivity(undefined);
    setAppliedDates(new Set());
  }

  function toggleDay(date: string) {
    setOpenDays((s) => {
      const next = new Set(s);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }

  function applyDay(date: string, brut: number, curse: number) {
    // Guard: only days inside the selected week can be applied (defense in depth).
    if (!date || !dates.includes(date)) return;
    onApplyDay({
      data: date,
      brut: Math.round(brut * 100) / 100,
      curse,
      platforma: "Bolt",
      observatii: `Import OCR: ${curse} curse`,
    });
    setAppliedDates((s) => new Set(s).add(date));
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const hasRides = rides.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Import curse din screenshot-uri</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border-l-4 border-accent bg-accent/10 p-3 text-xs sm:text-sm">
          Încarcă liste de curse sau curse individuale. Aplicația extrage fiecare cursă, le
          grupează pe zile și calculează venitul brut zilnic. <strong>Nimic nu se aplică
          automat</strong> — verifici tabelul și apeși „Aplică ziua”. Poți edita orice valoare manual.
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ImageUp className="mr-2 h-4 w-4" />
            )}
            Încarcă screenshot-uri
          </Button>
          {hasRides && (
            <Button variant="ghost" size="sm" onClick={resetAll} disabled={isProcessing}>
              <RotateCcw className="mr-2 h-4 w-4" /> Resetează
            </Button>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="text-xs text-muted-foreground">
            Imaginile rămân pe acest dispozitiv. Fără server.
          </span>
        </div>

        {isProcessing && (
          <div className="text-xs text-muted-foreground">
            Procesez {fileCount} imagini… {progress}%
          </div>
        )}

        {activity && (
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            Ecran activitate detectat
            {activity.weekRange ? ` (${activity.weekRange})` : ""}:{" "}
            {activity.ore !== undefined ? (
              <strong>{activity.ore.toFixed(2)} ore online</strong>
            ) : (
              "ore indisponibile"
            )}
            . Orele nu se distribuie automat pe zile — completează-le manual dacă e nevoie.
          </div>
        )}

        {!hasRides && !isProcessing && (
          <p className="text-xs text-muted-foreground">
            Nicio cursă încă. Încarcă screenshot-uri pentru a începe.
          </p>
        )}

        {/* Per-day review groups */}
        {aggregates.map((day) => {
          const isUndated = day.date === "";
          const isOutside = day.outsideWeek; // date present but outside the selected week
          const isApplicable = !isUndated && !isOutside;
          // Auto-expand the buckets that need attention so the user can't miss them.
          const isOpen = openDays.has(day.date) || isUndated || isOutside;
          const applied = appliedDates.has(day.date);

          return (
            <div key={day.date || "undated"} className="rounded-md border">
              <button
                type="button"
                onClick={() => toggleDay(day.date)}
                className="flex w-full items-center justify-between gap-2 p-3 text-left"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {isUndated ? (
                      <span className="text-orange-600">Curse fără dată</span>
                    ) : (
                      <span className={isOutside ? "text-orange-600" : undefined}>{dayLabel(day.date)}</span>
                    )}
                    {isOutside && (
                      <Badge variant="outline" className="border-orange-500 text-orange-600">
                        <AlertTriangle className="mr-1 h-3 w-3" /> în afara săptămânii
                      </Badge>
                    )}
                    {!isOutside && day.hasSpecialCases && (
                      <Badge variant="outline" className="border-orange-400 text-orange-600">
                        <AlertTriangle className="mr-1 h-3 w-3" /> verifică
                      </Badge>
                    )}
                    {applied && (
                      <Badge variant="outline" className="border-green-500 text-green-600">
                        <Check className="mr-1 h-3 w-3" /> aplicat
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {day.rideCount} curse · brut {lei(day.gross)}
                    {day.tips > 0 ? ` · bacșiș ${lei(day.tips)}` : ""}
                    {isOutside ? " · nu se adună la total" : ""}
                  </div>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>

              {isOpen && (
                <div className="space-y-2 border-t p-3">
                  {day.rides.map((ride) => (
                    <div key={ride.id} className="rounded-md border bg-card p-2">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {/* Date */}
                        <div className="col-span-2 sm:col-span-1">
                          <Label className="text-[10px] uppercase text-muted-foreground">
                            Ziua
                          </Label>
                          <Select
                            value={ride.date && dates.includes(ride.date) ? ride.date : ""}
                            onValueChange={(v) => patchRide(ride.id, { date: v })}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Alege ziua" />
                            </SelectTrigger>
                            <SelectContent>
                              {dates.map((d) => (
                                <SelectItem key={d} value={d}>
                                  {dayLabel(d)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Time (read-only hint) */}
                        <div>
                          <Label className="text-[10px] uppercase text-muted-foreground">Ora</Label>
                          <Input className="h-8" value={ride.time ?? ""} readOnly />
                        </div>

                        {/* Amount */}
                        <div>
                          <Label className="text-[10px] uppercase text-muted-foreground">
                            Sumă (lei)
                          </Label>
                          <Input
                            className="h-8"
                            inputMode="decimal"
                            type="number"
                            min={0}
                            step="0.01"
                            value={ride.amount ?? ""}
                            placeholder="manual"
                            onChange={(e) =>
                              patchRide(ride.id, { amount: parseNum(e.target.value) })
                            }
                          />
                        </div>

                        {/* Completed */}
                        <div className="flex items-end gap-2 pb-1">
                          <Checkbox
                            id={`done-${ride.id}`}
                            checked={ride.isCompleted}
                            onCheckedChange={(c) =>
                              patchRide(ride.id, { isCompleted: c === true })
                            }
                          />
                          <Label htmlFor={`done-${ride.id}`} className="text-xs">
                            Finalizată
                          </Label>
                        </div>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {ride.compensation !== undefined && (
                          <Badge variant="secondary" className="text-[10px]">
                            compensare {lei(ride.compensation)}
                          </Badge>
                        )}
                        {ride.earnings !== undefined && (
                          <Badge variant="secondary" className="text-[10px]">
                            venituri {lei(ride.earnings)}
                          </Badge>
                        )}
                        {ride.tip !== undefined && (
                          <Badge variant="secondary" className="text-[10px]">
                            bacșiș {lei(ride.tip)}
                          </Badge>
                        )}
                        {ride.needsReview && ride.reviewReason && (
                          <span className="text-[10px] text-orange-600">{ride.reviewReason}</span>
                        )}
                        <span className="ml-auto text-xs font-medium">
                          gross {lei(ride.gross)}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => removeRide(ride.id)}
                          title="Elimină cursa"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {isApplicable && (
                    <div className="flex items-center justify-between pt-1">
                      <div className="text-xs text-muted-foreground">
                        Total zi: <strong>{lei(day.gross)}</strong> · {day.rideCount} curse
                      </div>
                      <Button
                        size="sm"
                        disabled={day.rideCount === 0}
                        onClick={() => applyDay(day.date, day.gross, day.rideCount)}
                      >
                        <Check className="mr-2 h-4 w-4" /> Aplică ziua
                      </Button>
                    </div>
                  )}
                  {isUndated && (
                    <p className="text-[11px] text-orange-600">
                      Alege o zi pentru fiecare cursă de mai sus ca să poată fi aplicată.
                    </p>
                  )}
                  {isOutside && (
                    <p className="text-[11px] text-orange-600">
                      Curse în afara săptămânii 10–16 mai 2026 — nu se adună la total și nu pot fi
                      aplicate. Dacă data a fost citită greșit, reasignează-le unei zile din interval.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
