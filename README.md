# bezier-simplify

A zero-dependency JavaScript library for reducing the number of segments in a
closed cubic Bezier path while keeping the result within a geometric tolerance.
Fine tuned with typographic Bezier curves in mind, but generally useful for 
lots of use cases.

## Install

```sh
npm install bezier-simplify
```

## Usage

```js
import { simplifyPath } from 'bezier-simplify';

const simplified = simplifyPath(loop, {
	tolerance: 2,
	preserveExtrema: true,
});
```

A loop is an array of connected segments. Each segment has the shape
`[p0, p1, p2, p3]`, where points are `{ x, y }`. `p0` and `p3` are
start / end points, and `p1` and `p2` are control points. Use `false`
for an absent control; two `false` controls represent a straight line.

```js
const loop = [
	[
		{ x: 50, y: 0 },
		{ x: 80, y: 0 },
		{ x: 120, y: 20 },
		{ x: 120, y: 50 },
	],
	[
		{ x: 120, y: 50 },
		{ x: 120, y: 80 },
		{ x: 70, y: 110 },
		{ x: 40, y: 110 },
	],
	[
		{ x: 40, y: 110 },
		{ x: 10, y: 110 },
		{ x: 0, y: 70 },
		{ x: 0, y: 40 },
	],
	[
		{ x: 0, y: 40 },
		{ x: 0, y: 10 },
		{ x: 20, y: 0 },
		{ x: 50, y: 0 },
	],
];
```

## Options

```js
/**
 * Configuration for closed-path simplification.
 *
 * @typedef {Object} SimplifyOptions
 * @property {number} tolerance - Required, finite, non-negative geometric error
 *   budget in input coordinate units, checked in both directions. A value of
 *   zero returns an unchanged deep copy.
 * @property {number|'auto'} [cornerAngleThreshold='auto'] - Corner angle
 *   threshold in degrees, from 0 to 180. Automatic mode separates smooth joins
 *   from structural turns using the shape's join-angle distribution.
 *   Reconstruction confirms corners over an arc-length neighborhood scaled
 *   to tolerance; minor handle-direction changes are not mandatory corners.
 * @property {number} [maxIterations=4] - Maximum number of reparameterization
 *   passes per candidate fit. Must be a non-negative integer.
 * @property {boolean} [preserveExtrema=true] - Retain global left/right/top/bottom
 *   points and significant local x/y reversals as exact fitting anchors.
 *   Local extrema with prominence within tolerance may be removed. Interior
 *   cubic extrema become anchors at their actual coordinates without locking
 *   the surrounding original segments. Candidate curves must remain inside
 *   the original global bounds. When false, global extrema may move within
 *   tolerance. Flat extrema do not require retaining every duplicate point.
 */
```

Passing a number as the second argument is shorthand for `{ tolerance: number }`.
The input loop is validated and never mutated.

Use `calculateCornerAngleThreshold(loop)` to inspect the angle selected by auto
mode. Uniform shapes without distinct smooth/corner groups use a conservative
`30` degree fallback.

`detectCorners(loop, angle)` and `detectExtrema(loop, tolerance)` remain
original-segment diagnostics. The latter reports the original boundaries around
interior extrema for compatibility. They do not enumerate the reconstruction's
anchors, which may lie inside an original segment.

## Reconstruction

1. Flatten the whole contour adaptively, inserting exact cubic x/y extrema and
   ignoring geometrically empty segments. Reserve part of the tolerance for
   this approximation; collinear backtracking is retained.
2. Identify meaningful corners and prominent extrema. Use neighboring geometry
   to estimate fitting directions instead of copying tiny original handles.
3. Fit each entire span between anchors using uniformly spaced arc-length
   samples, tangent-constrained least squares, and Newton-Raphson refinement.
4. Validate both original-to-fit and fit-to-original distances using adaptive
   polyline checks. Finite-chord flattening bounds and distance upper bounds
   between samples share the same error budget.
5. If a fit fails, split near its worst geometric deviation and fit both parts
   recursively, sharing a tangent at the split. The closed loop wraps through
   its original starting point rather than making that point mandatory.

The result never has more segments than the input: an unchanged copy is returned
if fitting cannot safely finish or would not reduce the count. Inputs are never
mutated. The library still has no runtime or build dependencies.

This is a geometric reconstruction, not a globally optimal minimum-segment
solver. Segment counts need not decrease at every individual slider step, and
changing feature thresholds can change the segmentation. Distance checks and
extremum coordinates are subject to floating-point precision. The error bound
does not guarantee topology, area, winding, or stroke-width preservation; large
tolerances can remove narrow features or introduce crossings.

## Development

```sh
npm test
npm run build
npm run test:app
```

The test app is served at `http://127.0.0.1:4173`. The publishable ESM module
and its type declarations are generated in `dist/`.
