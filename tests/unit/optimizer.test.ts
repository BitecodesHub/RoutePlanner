import { describe, expect, it } from "vitest";
import { solveTsp, tourCost } from "@/lib/optimizer";
import { haversineMatrix, type LatLng } from "@/lib/geo";

function symmetricMatrix(points: LatLng[]): number[][] {
  return haversineMatrix(points);
}

/** Brute-force optimal tour cost for small instances (depot fixed at 0). */
function bruteForceBest(matrix: number[][]): number {
  const n = matrix.length;
  const stops = Array.from({ length: n - 1 }, (_, i) => i + 1);
  let best = Infinity;
  const permute = (arr: number[], k: number) => {
    if (k === arr.length) {
      best = Math.min(best, tourCost([0, ...arr], matrix));
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  permute(stops, 0);
  return best;
}

describe("solveTsp", () => {
  it("handles empty and single-stop inputs", () => {
    expect(solveTsp([[0]])).toEqual({ order: [], totalCost: 0 });
    const two = [
      [0, 5],
      [5, 0],
    ];
    expect(solveTsp(two)).toEqual({ order: [1], totalCost: 10 });
  });

  it("visits every stop exactly once", () => {
    const points: LatLng[] = Array.from({ length: 15 }, (_, i) => ({
      lat: 23 + Math.sin(i * 1.7) * 0.05,
      lng: 72.5 + Math.cos(i * 2.3) * 0.05,
    }));
    const { order } = solveTsp(symmetricMatrix(points));
    expect(order).toHaveLength(14);
    expect(new Set(order).size).toBe(14);
    expect(Math.min(...order)).toBe(1);
    expect(Math.max(...order)).toBe(14);
  });

  it("finds the optimal tour for small instances", () => {
    for (let trial = 0; trial < 5; trial++) {
      const points: LatLng[] = Array.from({ length: 8 }, (_, i) => ({
        lat: 23 + Math.sin(trial * 7 + i * 3.1) * 0.08,
        lng: 72.5 + Math.cos(trial * 5 + i * 4.7) * 0.08,
      }));
      const matrix = symmetricMatrix(points);
      const { order, totalCost } = solveTsp(matrix);
      const optimal = bruteForceBest(matrix);
      // 2-opt + Or-opt should be within 2% of optimal on tiny instances.
      expect(totalCost).toBeLessThanOrEqual(optimal * 1.02 + 1);
      expect(tourCost([0, ...order], matrix)).toBeCloseTo(totalCost, 6);
    }
  });

  it("dramatically improves on a pathological input order", () => {
    // Points along a line, given in alternating far/near order.
    const points: LatLng[] = [{ lat: 23, lng: 72.5 }];
    for (let i = 1; i <= 12; i++) {
      points.push({ lat: 23, lng: 72.5 + (i % 2 === 0 ? i : 13 - i) * 0.01 });
    }
    const matrix = symmetricMatrix(points);
    const naive = tourCost([0, ...Array.from({ length: 12 }, (_, i) => i + 1)], matrix);
    const { totalCost } = solveTsp(matrix);
    expect(totalCost).toBeLessThan(naive * 0.7);
  });

  it("stays consistent and near-optimal on asymmetric (road-like) matrices", () => {
    // Road duration matrices are asymmetric: one-way systems, turn costs.
    for (let trial = 0; trial < 5; trial++) {
      const n = 7;
      const rand = (i: number, j: number) =>
        1000 + 900 * Math.abs(Math.sin(trial * 131 + i * 17.3 + j * 7.9));
      const matrix = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0 : rand(i, j))),
      );
      const { order, totalCost } = solveTsp(matrix);
      expect(order).toHaveLength(n - 1);
      expect(new Set(order).size).toBe(n - 1);
      // Reported cost must equal the true cost of the returned tour.
      expect(tourCost([0, ...order], matrix)).toBeCloseTo(totalCost, 6);
      // And be close to the brute-force optimum.
      const optimal = bruteForceBest(matrix);
      expect(totalCost).toBeLessThanOrEqual(optimal * 1.15 + 1);
    }
  });

  it("solves 100 stops in reasonable time", () => {
    const points: LatLng[] = Array.from({ length: 101 }, (_, i) => ({
      lat: 23 + Math.sin(i * 12.9898) * 0.2,
      lng: 72.5 + Math.sin(i * 78.233) * 0.2,
    }));
    const matrix = symmetricMatrix(points);
    const startTime = performance.now();
    const { order } = solveTsp(matrix);
    const elapsed = performance.now() - startTime;
    expect(order).toHaveLength(100);
    expect(new Set(order).size).toBe(100);
    expect(elapsed).toBeLessThan(10_000);
  });
});
