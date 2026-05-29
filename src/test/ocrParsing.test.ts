import { describe, expect, it } from "vitest";
import { parseScreenshotText } from "@/lib/ocrParsing";

describe("OCR parsing", () => {
  it("extracts likely Uber values from OCR text", () => {
    const result = parseScreenshotText(`
      Uber
      Total earnings
      245,50 lei
      Trips 14
      Online 6 h 30 min
      10 mai 2026
    `);

    expect(result).toEqual({
      platforma: "Uber",
      brut: 245.5,
      curse: 14,
      ore: 6.5,
      data: "2026-05-10",
    });
  });

  it("extracts likely Bolt values from Romanian OCR text", () => {
    const result = parseScreenshotText(`
      Bolt
      Incasari totale
      310 RON
      Curse 18
      Timp online 07:15
      12.05.2026
    `);

    expect(result.platforma).toBe("Bolt");
    expect(result.brut).toBe(310);
    expect(result.curse).toBe(18);
    expect(result.ore).toBe(7.25);
    expect(result.data).toBe("2026-05-12");
  });
});
