/**
 * Round-trip TSP solver with a fixed starting depot.
 *
 * matrix[i][j] = travel cost from point i to point j, where index 0 is the
 * depot (starting point) and 1..n are the stops. The tour starts at 0,
 * visits every stop exactly once, and returns to 0.
 *
 * Strategy: nearest-neighbour construction followed by 2-opt and Or-opt
 * local search until convergence. Exact for tiny inputs, near-optimal and
 * fast (O(n²) per pass) for the realistic 10–200 stop range.
 */

export interface TspResult {
  /** Matrix indices (1..n) in optimised visiting order — depot excluded. */
  order: number[];
  /** Total tour cost including the return leg to the depot. */
  totalCost: number;
}

export function tourCost(tour: number[], matrix: number[][]): number {
  // tour is the full cycle start: [0, s1, s2, ... sn]; cost includes sn -> 0.
  let cost = 0;
  for (let i = 0; i < tour.length; i++) {
    cost += matrix[tour[i]][tour[(i + 1) % tour.length]];
  }
  return cost;
}

function nearestNeighborTour(matrix: number[][]): number[] {
  const n = matrix.length;
  const visited = new Array<boolean>(n).fill(false);
  const tour = [0];
  visited[0] = true;
  let current = 0;
  for (let step = 1; step < n; step++) {
    let best = -1;
    let bestCost = Infinity;
    for (let j = 1; j < n; j++) {
      if (!visited[j] && matrix[current][j] < bestCost) {
        bestCost = matrix[current][j];
        best = j;
      }
    }
    tour.push(best);
    visited[best] = true;
    current = best;
  }
  return tour;
}

/**
 * 2-opt: reverse tour[i..k] when it shortens the cycle. Depot stays fixed.
 * Road matrices are asymmetric (m[i][j] !== m[j][i]), so the cheap boundary
 * delta is only a filter; a move is accepted on its exact delta, which also
 * prices the reversed internal arcs. This keeps every accepted move a strict
 * improvement, guaranteeing monotone convergence.
 */
function twoOptPass(tour: number[], matrix: number[][]): boolean {
  const n = tour.length;
  let improved = false;
  for (let i = 1; i < n - 1; i++) {
    for (let k = i + 1; k < n; k++) {
      const a = tour[i - 1];
      const b = tour[i];
      const c = tour[k];
      const d = tour[(k + 1) % n];
      const boundaryDelta = matrix[a][c] + matrix[b][d] - (matrix[a][b] + matrix[c][d]);
      if (boundaryDelta >= -1e-9) continue;
      let reversalDelta = 0;
      for (let t = i; t < k; t++) {
        reversalDelta += matrix[tour[t + 1]][tour[t]] - matrix[tour[t]][tour[t + 1]];
      }
      const delta = boundaryDelta + reversalDelta;
      if (delta < -1e-9) {
        let lo = i;
        let hi = k;
        while (lo < hi) {
          [tour[lo], tour[hi]] = [tour[hi], tour[lo]];
          lo++;
          hi--;
        }
        improved = true;
      }
    }
  }
  return improved;
}

/** Or-opt: relocate segments of length 1–3 to a better position. */
function orOptPass(tour: number[], matrix: number[][]): boolean {
  const n = tour.length;
  let improved = false;
  for (let segLen = 1; segLen <= 3; segLen++) {
    for (let i = 1; i + segLen - 1 < n; i++) {
      const prev = tour[i - 1];
      const segStart = tour[i];
      const segEnd = tour[i + segLen - 1];
      const next = tour[(i + segLen) % n];
      const removalGain =
        matrix[prev][segStart] + matrix[segEnd][next] - matrix[prev][next];
      if (removalGain <= 1e-9) continue;

      for (let j = 0; j < n; j++) {
        // Insert between tour[j] and tour[j+1]; skip positions inside/adjacent to segment.
        if (j >= i - 1 && j <= i + segLen - 1) continue;
        const p = tour[j];
        const q = tour[(j + 1) % n];
        const insertionCost = matrix[p][segStart] + matrix[segEnd][q] - matrix[p][q];
        if (insertionCost < removalGain - 1e-9) {
          const segment = tour.splice(i, segLen);
          const insertAt = j < i ? j + 1 : j + 1 - segLen;
          tour.splice(insertAt, 0, ...segment);
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
    if (improved) break;
  }
  return improved;
}

export function solveTsp(matrix: number[][]): TspResult {
  const n = matrix.length;
  if (n <= 1) return { order: [], totalCost: 0 };
  if (n === 2) return { order: [1], totalCost: matrix[0][1] + matrix[1][0] };

  const tour = nearestNeighborTour(matrix);

  const MAX_PASSES = 200;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const improved2opt = twoOptPass(tour, matrix);
    const improvedOrOpt = orOptPass(tour, matrix);
    if (!improved2opt && !improvedOrOpt) break;
  }

  return { order: tour.slice(1), totalCost: tourCost(tour, matrix) };
}
