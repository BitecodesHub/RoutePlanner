import { describe, expect, it } from "vitest";
import {
  haversineMeters,
  isValidCoordinate,
  parseGoogleMapsUrl,
  parseLatLngText,
  formatDistance,
  formatDuration,
  isShortMapsLink,
} from "@/lib/geo";

describe("isValidCoordinate", () => {
  it("accepts normal coordinates", () => {
    expect(isValidCoordinate(23.06, 72.51)).toBe(true);
    expect(isValidCoordinate(-89.9, 179.9)).toBe(true);
  });
  it("rejects out-of-range and null-island", () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(0, 0)).toBe(false);
    expect(isValidCoordinate(NaN, 72)).toBe(false);
  });
});

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters({ lat: 23, lng: 72 }, { lat: 23, lng: 72 })).toBe(0);
  });
  it("matches a known distance (~5 km within Ahmedabad)", () => {
    const a = { lat: 23.0634, lng: 72.512 };
    const b = { lat: 23.0929, lng: 72.478 };
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(4000);
    expect(d).toBeLessThan(6000);
  });
});

describe("parseGoogleMapsUrl", () => {
  it("parses dir api destination links", () => {
    expect(
      parseGoogleMapsUrl(
        "https://www.google.com/maps/dir/?api=1&destination=23.0634347,72.5120108&travelmode=driving",
      ),
    ).toEqual({ lat: 23.0634347, lng: 72.5120108 });
  });
  it("parses q= and @ viewport forms", () => {
    expect(parseGoogleMapsUrl("https://maps.google.com/?q=23.05,72.51")).toEqual({
      lat: 23.05,
      lng: 72.51,
    });
    expect(
      parseGoogleMapsUrl("https://www.google.com/maps/@23.0705,72.5139,15z"),
    ).toEqual({ lat: 23.0705, lng: 72.5139 });
  });
  it("prefers precise !3d!4d pin data over the viewport", () => {
    expect(
      parseGoogleMapsUrl(
        "https://www.google.com/maps/place/Shop/@23.07,72.51,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d23.0743271!4d72.505498",
      ),
    ).toEqual({ lat: 23.0743271, lng: 72.505498 });
  });
  it("rejects non-Google hosts and junk", () => {
    expect(parseGoogleMapsUrl("https://evil.example.com/?q=23,72")).toBeNull();
    expect(parseGoogleMapsUrl("not a url")).toBeNull();
    expect(parseGoogleMapsUrl("https://www.google.com/maps")).toBeNull();
  });
});

describe("parseLatLngText", () => {
  it("parses plain pairs", () => {
    expect(parseLatLngText(" 23.0634 , 72.5120 ")).toEqual({ lat: 23.0634, lng: 72.512 });
    expect(parseLatLngText("-33.86,151.20")).toEqual({ lat: -33.86, lng: 151.2 });
  });
  it("rejects invalid input", () => {
    expect(parseLatLngText("hello")).toBeNull();
    expect(parseLatLngText("95,72")).toBeNull();
    expect(parseLatLngText("0,0")).toBeNull();
  });
});

describe("isShortMapsLink", () => {
  it("detects goo.gl short links", () => {
    expect(isShortMapsLink("https://maps.app.goo.gl/AbCdEf123")).toBe(true);
    expect(isShortMapsLink("https://goo.gl/maps/XyZ")).toBe(true);
    expect(isShortMapsLink("https://www.google.com/maps/@23,72,15z")).toBe(false);
  });
});

describe("formatting", () => {
  it("formats distances", () => {
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(12_340)).toBe("12.3 km");
  });
  it("formats durations", () => {
    expect(formatDuration(540)).toBe("9 min");
    expect(formatDuration(3660)).toBe("1 h 1 min");
    expect(formatDuration(7200)).toBe("2 h");
  });
});
