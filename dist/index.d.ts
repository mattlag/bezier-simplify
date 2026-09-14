export interface Point {
	x: number;
	y: number;
}

export type BezierControlPoint = Point | false;
export type BezierCurve = [
	Point,
	BezierControlPoint,
	BezierControlPoint,
	Point,
];
export type BezierLoop = BezierCurve[];

export interface SimplifyOptions {
	tolerance: number;
	cornerAngleThreshold?: number | 'auto';
	maxIterations?: number;
	preserveExtrema?: boolean;
}

export interface ErrorResult {
	error: number;
	index: number;
}

export const DEFAULT_OPTIONS: Readonly<
	Required<Omit<SimplifyOptions, 'tolerance'>>
>;

export function flattenSegment(
	segment: BezierCurve,
	flatness?: number,
	maxDepth?: number,
): Point[];
export function estimateTangent(
	points: Point[],
	index: number,
	direction?: number,
): Point;
export function detectCorners(
	path: BezierLoop,
	cornerAngleThreshold?: number | 'auto',
): number[];
export function calculateCornerAngleThreshold(path: BezierLoop): number;
export function detectExtrema(path: BezierLoop, tolerance?: number): number[];
export function fitCubicToPoints(
	points: Point[],
	leftTangent: Point,
	rightTangent: Point,
	parameters?: number[],
): [Point, Point, Point, Point];
export function maxError(
	points: Point[],
	curve: BezierCurve,
	parameters: number[],
): ErrorResult;
export function reparameterize(
	points: Point[],
	curve: BezierCurve,
	parameters: number[],
): number[];
export function simplifyPath(
	path: BezierLoop,
	options: SimplifyOptions | number,
): BezierLoop;
