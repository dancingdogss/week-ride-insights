import { createWorker, OEM, PSM } from "tesseract.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFromScreenshot, extractFromMany } from "@/lib/rideExtraction";
import { lei } from "@/lib/weekStorage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const langPath = path.join(root, "public", "tesseract", "lang");
// Keep the gunzipped traineddata cache inside node_modules (git-ignored) so
// running this verifier never litters the repo root.
const cachePath = path.join(root, "node_modules", ".cache", "tesseract");

const files = process.argv.slice(2);

const worker = await createWorker(["eng", "ron"], OEM.LSTM_ONLY, { langPath, cachePath, gzip: true });
await worker.setParameters({
  tessedit_pageseg_mode: PSM.SPARSE_TEXT,
  preserve_interword_spaces: "1",
});

const texts: string[] = [];
for (const f of files) {
  const { data } = await worker.recognize(path.resolve(root, f));
  texts.push(data.text);
  const parsed = extractFromScreenshot(data.text);
  console.log(`\n[${parsed.kind}] ${path.basename(f)} → ${parsed.rides.length} rides` +
    (parsed.activity ? ` | activity ore=${parsed.activity.ore}` : ""));
  for (const r of parsed.rides) {
    console.log(
      `   ${r.date ?? "??"} ${r.time ?? ""}  amount=${r.amount ?? "-"} ` +
      `comp=${r.compensation ?? "-"} earn=${r.earnings ?? "-"} tip=${r.tip ?? "-"} ` +
      `gross=${r.gross} ${r.needsReview ? "[REVIEW]" : ""}`,
    );
  }
}
await worker.terminate();

console.log("\n================ AGGREGATED BY DAY ================");
const multi = extractFromMany(texts);
for (const day of multi.aggregates) {
  console.log(
    `${day.date || "(no date)"}: ${day.rideCount} rides, gross ${lei(day.gross)}` +
    (day.tips ? `, tips ${lei(day.tips)}` : "") +
    (day.compensation ? `, comp ${lei(day.compensation)}` : "") +
    (day.hasSpecialCases ? "  ⚠ review" : ""),
  );
}
