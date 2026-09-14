# Overview
The goal of this project is to create a generic library that takes a set of well-connected bezier segments that represent a curve, some sort of value representing amount, and output a simplified set of well-connected bezier segments.

# Project deliverables
Two main things this workspace will produce:

## Simplification library

Probably just a single .js file that exports certain functions. This library will also be publish-able to NPM

## Test environment

A easy to use local .html file that has a basic UI that shows many different test cases visually, basic controls for controlling simplification amount, and the outcome of the algorithm. This test environment will not be 'shipped' with the final library or NPM library.

# Data Structure

A **BezierLoop** is an array of **BezierCurve** segments that form a closed path. The end point of each curve must equal the start point of the next, and the last curve must connect back to the first.

A **BezierCurve** is a 4-element array: `[p1, cp1, cp2, p2]`

- `p1` — start point `{ x, y }`
- `cp1` — first control point `{ x, y }`, or `false` for a line
- `cp2` — second control point `{ x, y }`, or `false` for a line
- `p2` — end point `{ x, y }`

When both control points are `false`, the segment is a straight line.
