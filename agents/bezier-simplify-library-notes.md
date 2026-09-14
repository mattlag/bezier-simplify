# Bezier Curve Simplification — Standalone Library Notes

> Scope note: these notes are for bootstrapping a **new, standalone, zero-dependency
> library**. It is NOT part of Font Flux JS and must not assume any font-specific
> data model. Input/output is generic cubic Bezier curve data only.

## Problem statement

Given a path made of cubic Bezier segments (each segment `[p0, p1, p2, p3]`,
where `p0`/`p3` are on-curve endpoints and `p1`/`p2` are off-curve control
points), reduce the number of on-curve points while keeping the resulting
path as visually close as possible to the original, within a caller-supplied
error tolerance.

- Adding points to a Bezier path and keeping it pixel-identical is trivial
  (subdivision / degree elevation — exact).
- Removing points is the reverse direction and is **lossy** in the general
  case. It's a **least-squares curve-fitting** problem, not an exact inverse,
  except in the narrow case where the extra point was introduced by prior
  subdivision of a strictly simpler curve (hard to detect reliably, not worth
  special-casing for v1).

## Prior art / references

- Philip J. Schneider, "An Algorithm for Automatically Fitting Digitized
  Curves," *Graphics Gems* (1990). The canonical algorithm — recursive
  least-squares Bezier fit + Newton-Raphson reparameterization + split at
  max error.
- Potrace (bitmap tracing) — uses a similar fit/split loop.
- FontForge's "Simplify" command — practical reference for tolerance
  handling, corner detection, and collapsing near-collinear segments.
- npm `fit-curve` — JS port of Schneider's algorithm, good reference
  implementation for the core math (not to be depended on, but useful to
  read for the least-squares derivation and reparameterization step).

## Data model (generic, no font dependency)

```ts
type Point = { x: number; y: number };
type CubicSegment = [Point, Point, Point, Point]; // p0, p1, p2, p3
type Path = CubicSegment[]; // p3 of segment i === p0 of segment i+1 (closed or open)
```

Design the public API around this shape only. Do not import or assume
glyph/contour/font concepts. If quadratic support is needed later, convert
quadratic → cubic at the boundary (exact, degree elevation) and convert back
down after fitting if the caller wants quadratic output.

## High-level algorithm

1. **Sample to points**: Flatten each input segment into a dense polyline
   (e.g. adaptive flattening or fixed N samples per segment) — this is the
   "digitized curve" data the fit will be measured against. Keep original
   on-curve points too, since corner detection uses them.

2. **Corner detection (fixed / non-removable points)**: At every original
   on-curve point, compare incoming vs outgoing tangent direction. If the
   angle exceeds a threshold (configurable, e.g. 30–45°), mark it as a hard
   corner. Corners are never removed — smoothing across them destroys shape
   intent. This includes the first/last point of an open path.

3. **Split into runs**: Break the path into runs of points between
   consecutive corners. Each run is independently simplified.

4. **Fit each run to one cubic Bezier**:
   - Chord-length parameterize the sampled points in the run (`t` in [0,1]).
   - Fix endpoints at the run's first/last on-curve points.
   - Solve the closed-form linear least-squares system for the two interior
     control points, constrained to lie along the fixed tangent directions
     at the endpoints (reduces unknowns to two scalar distances instead of
     4 free coordinates — this is the standard Schneider approach and keeps
     tangent continuity with neighboring runs).
   - Compute max perpendicular error between the fitted curve and the
     sampled points.

5. **Accept or subdivide**:
   - If max error ≤ tolerance: replace the whole run with the single fitted
     cubic segment. This is the actual point-count reduction.
   - Else: try Newton-Raphson reparameterization (re-project each sample's
     `t` onto the current fitted curve and re-fit) a few iterations to see
     if error drops under tolerance without splitting.
   - If still over tolerance: split the run at the point of max error (or
     max curvature) into two sub-runs and recurse on each half
     independently, each inheriting a fixed shared point (with tangent
     continuity handled naturally since both halves fit against the same
     sample data around the split).

6. **Reassemble**: Concatenate the fitted segments run-by-run, corners
   passed through unchanged.

## Practical parameters to expose in the API

- `tolerance` (required) — max allowed deviation, in the same units as
  input coordinates. Caller decides what "close enough" means (e.g. font
  units, px, whatever their coordinate space is).
- `cornerAngleThreshold` (optional, default ~30°) — below this angle
  difference, a point is considered smooth and eligible for removal.
- `maxIterations` for Newton-Raphson reparameterization per run (default
  ~4, matches Schneider's original).
- Optional `preserveExtrema: boolean` — if true, never remove points that
  are local x/y minima/maxima of the path (useful for downstream consumers
  like font renderers/hinters that care about extrema, but this is a
  generic geometry nicety, not font-specific logic — frame it as "preserve
  axis-aligned tangent points").

## Edge cases to handle

- Very short runs (2–3 points) — just return them unchanged, not worth
  fitting.
- Closed paths — corner detection and run-splitting must wrap around the
  seam.
- Degenerate segments (zero-length, coincident control points).
- Runs where least-squares produces a curve with a cusp/loop not present
  in the original (can happen with bad tangent estimates) — validate fitted
  control points don't produce self-intersections beyond tolerance, or fall
  back to splitting.
- Numerical stability of the tangent-constrained least-squares solve when
  points are nearly collinear (denominator near zero) — fall back to
  simple linear (straight line) fit in that case.

## Suggested module shape for the new repo

- Single entry point, framework-agnostic, no build-time deps.
- Core pure functions: `flattenSegment`, `estimateTangent`, `detectCorners`,
  `fitCubicToPoints`, `maxError`, `reparameterize`, `simplifyPath`.
- Keep everything in plain arrays/objects (`Point`, `CubicSegment`) so any
  graphics tool (canvas, SVG, font tooling, etc.) can adapt input/output
  without adapter code beyond simple mapping.
- Ship both an ESM build and types (`.d.ts`), mirroring the
  zero-dependency, single-file distribution style used by Font Flux JS if
  consistency across your libraries is desired (not required).

## Testing strategy notes

- Round-trip tests: take a hand-fit simple shape (circle approximated by 4
  cubic beziers, a rounded rect, an "S" curve), over-subdivide it heavily
  (add many extra on-curve points via exact subdivision), then simplify and
  assert point count drops and max deviation stays under tolerance.
- Corner-preservation tests: verify sharp corners (e.g. a square) are never
  smoothed away regardless of tolerance.
- Idempotency: simplifying an already-simplified path at the same
  tolerance should be a no-op (or very close).
