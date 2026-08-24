import { beforeEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { secureToken, hashToken, tempPassword } from "@/lib/tokens";
import {
  googleMapsRouteUrl,
  googleMapsStopUrl,
  fitsSingleNavLink,
  whatsappShareUrl,
} from "@/lib/nav-links";
import { solveTsp } from "@/lib/optimizer";
import { fallbackMatrix } from "@/lib/osrm";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit then blocks", () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit("k", 5, 60_000).allowed).toBe(true);
    }
    const blocked = rateLimit("k", 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 5; i++) rateLimit("a", 5, 60_000);
    expect(rateLimit("a", 5, 60_000).allowed).toBe(false);
    expect(rateLimit("b", 5, 60_000).allowed).toBe(true);
  });
});

describe("tokens", () => {
  it("generates unique, URL-safe tokens", () => {
    const t1 = secureToken();
    const t2 = secureToken();
    expect(t1).not.toBe(t2);
    expect(t1).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it("hashes deterministically", () => {
    const t = secureToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toHaveLength(64);
  });

  it("makes readable temp passwords", () => {
    expect(tempPassword()).toMatch(/^[A-Za-z0-9]{3}-[A-Za-z0-9]{3}-[A-Za-z0-9]{3}$/);
  });
});

describe("nav-links", () => {
  it("builds a round-trip Google Maps URL", () => {
    const url = googleMapsRouteUrl({ lat: 23, lng: 72 }, [
      { lat: 23.1, lng: 72.1 },
      { lat: 23.2, lng: 72.2 },
    ]);
    const u = new URL(url);
    expect(u.hostname).toBe("www.google.com");
    expect(u.searchParams.get("origin")).toBe("23,72");
    expect(u.searchParams.get("destination")).toBe("23,72");
    expect(u.searchParams.get("waypoints")).toBe("23.1,72.1|23.2,72.2");
  });

  it("builds per-stop links and enforces the waypoint cap", () => {
    expect(googleMapsStopUrl({ lat: 23.5, lng: 72.5 })).toContain("destination=23.5%2C72.5");
    expect(fitsSingleNavLink(9)).toBe(true);
    expect(fitsSingleNavLink(10)).toBe(false);
  });

  it("builds WhatsApp share links with and without a phone number", () => {
    const withPhone = whatsappShareUrl("+91 90000 00000", "Route: Test\nOpen: http://x/share/t");
    expect(withPhone).toBe(
      `https://wa.me/919000000000?text=${encodeURIComponent("Route: Test\nOpen: http://x/share/t")}`,
    );
    const withoutPhone = whatsappShareUrl(null, "hello");
    expect(withoutPhone).toBe("https://wa.me/?text=hello");
    // Formatting characters in numbers are stripped.
    expect(whatsappShareUrl("(091) 234-567", "x")).toContain("wa.me/091234567?");
  });
});

describe("fallbackMatrix + solver integration", () => {
  it("produces a routable matrix that the solver accepts", () => {
    const pts = [
      { lat: 23.05, lng: 72.5 },
      { lat: 23.07, lng: 72.51 },
      { lat: 23.09, lng: 72.48 },
      { lat: 23.04, lng: 72.45 },
    ];
    const m = fallbackMatrix(pts);
    expect(m.source).toBe("HAVERSINE");
    expect(m.distances[0][1]).toBeGreaterThan(0);
    expect(m.durations[2][3]).toBeGreaterThan(0);
    const { order } = solveTsp(m.durations);
    expect(order).toHaveLength(3);
  });
});
