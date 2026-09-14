const EPSILON = 1e-9;
const FALLBACK_CORNER_ANGLE = 30;

export const DEFAULT_OPTIONS = Object.freeze({
	cornerAngleThreshold: 'auto',
	maxIterations: 4,
	preserveExtrema: true,
});

function isPoint(value) {
	return (
		value !== null &&
		typeof value === 'object' &&
		Number.isFinite(value.x) &&
		Number.isFinite(value.y)
	);
}

function clonePoint(point) {
	return { x: point.x, y: point.y };
}

function cloneSegment(segment) {
	return segment.map((value) => (value === false ? false : clonePoint(value)));
}

function add(a, b) {
	return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a, b) {
	return { x: a.x - b.x, y: a.y - b.y };
}

function scale(vector, amount) {
	return { x: vector.x * amount, y: vector.y * amount };
}

function dot(a, b) {
	return a.x * b.x + a.y * b.y;
}

function magnitude(vector) {
	return Math.hypot(vector.x, vector.y);
}

function normalize(vector) {
	const length = magnitude(vector);
	return length > EPSILON ? scale(vector, 1 / length) : null;
}

function distance(a, b) {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(a, b, amount) {
	return {
		x: a.x + (b.x - a.x) * amount,
		y: a.y + (b.y - a.y) * amount,
	};
}

function effectiveControls(segment) {
	return [
		segment[0],
		segment[1] === false ? segment[0] : segment[1],
		segment[2] === false ? segment[3] : segment[2],
		segment[3],
	];
}

function assertPath(path) {
	if (!Array.isArray(path) || path.length === 0) {
		throw new TypeError('path must be a non-empty array of Bezier segments');
	}

	for (let index = 0; index < path.length; index++) {
		const segment = path[index];
		if (!Array.isArray(segment) || segment.length !== 4) {
			throw new TypeError(`segment ${index} must contain exactly four values`);
		}
		if (!isPoint(segment[0]) || !isPoint(segment[3])) {
			throw new TypeError(
				`segment ${index} must have valid start and end points`,
			);
		}
		if (segment[1] !== false && !isPoint(segment[1])) {
			throw new TypeError(
				`segment ${index} has an invalid first control point`,
			);
		}
		if (segment[2] !== false && !isPoint(segment[2])) {
			throw new TypeError(
				`segment ${index} has an invalid second control point`,
			);
		}

		const next = path[(index + 1) % path.length];
		if (
			!Array.isArray(next) ||
			!isPoint(next[0]) ||
			distance(segment[3], next[0]) > EPSILON
		) {
			throw new TypeError(
				`path is not closed and connected at segment ${index}`,
			);
		}
	}
}

function pointLineDistance(point, start, end) {
	const chord = subtract(end, start);
	const lengthSquared = dot(chord, chord);
	if (lengthSquared === 0) {
		return distance(point, start);
	}

	const parameter = Math.max(0, Math.min(1, dot(subtract(point, start), chord) / lengthSquared));
	return distance(point, lerp(start, end, parameter));
}

function splitCubic(curve, parameter = 0.5) {
	const p01 = lerp(curve[0], curve[1], parameter);
	const p12 = lerp(curve[1], curve[2], parameter);
	const p23 = lerp(curve[2], curve[3], parameter);
	const p012 = lerp(p01, p12, parameter);
	const p123 = lerp(p12, p23, parameter);
	const midpoint = lerp(p012, p123, parameter);

	return [
		[curve[0], p01, p012, midpoint],
		[midpoint, p123, p23, curve[3]],
	];
}

function isFlatEnough(curve, flatness) {
	return (
		pointLineDistance(curve[1], curve[0], curve[3]) <= flatness &&
		pointLineDistance(curve[2], curve[0], curve[3]) <= flatness
	);
}

export function flattenSegment(segment, flatness = 0.5, maxDepth = 12) {
	if (!Array.isArray(segment) || segment.length !== 4) {
		throw new TypeError('segment must contain exactly four values');
	}
	if (!Number.isFinite(flatness) || flatness < 0) {
		throw new RangeError('flatness must be a non-negative finite number');
	}

	if (segment[1] === false && segment[2] === false) {
		return [clonePoint(segment[0]), clonePoint(segment[3])];
	}

	const points = [clonePoint(segment[0])];
	function visit(curve, depth) {
		if (depth >= maxDepth || isFlatEnough(curve, flatness)) {
			points.push(clonePoint(curve[3]));
			return;
		}

		const [left, right] = splitCubic(curve);
		visit(left, depth + 1);
		visit(right, depth + 1);
	}

	visit(effectiveControls(segment), 0);
	return points;
}

export function estimateTangent(points, index, direction = 1) {
	if (!Array.isArray(points) || points.length < 2) {
		throw new TypeError('points must contain at least two points');
	}

	const neighborIndex = Math.max(
		0,
		Math.min(points.length - 1, index + direction),
	);
	const tangent = normalize(subtract(points[neighborIndex], points[index]));
	return tangent ?? { x: 0, y: 0 };
}

function startTangent(segment) {
	const controls = effectiveControls(segment);
	return (
		normalize(subtract(controls[1], controls[0])) ??
		normalize(subtract(controls[2], controls[0])) ??
		normalize(subtract(controls[3], controls[0]))
	);
}

function endTangent(segment) {
	const controls = effectiveControls(segment);
	return (
		normalize(subtract(controls[2], controls[3])) ??
		normalize(subtract(controls[1], controls[3])) ??
		normalize(subtract(controls[0], controls[3]))
	);
}

function joinAngle(path, index) {
	const incoming = endTangent(path[(index - 1 + path.length) % path.length]);
	const outgoing = startTangent(path[index]);
	if (incoming === null || outgoing === null) return null;

	const forwardIncoming = scale(incoming, -1);
	const cosine = Math.max(-1, Math.min(1, dot(forwardIncoming, outgoing)));
	return (Math.acos(cosine) * 180) / Math.PI;
}

export function calculateCornerAngleThreshold(path) {
	assertPath(path);
	const angles = path
		.map((_, index) => joinAngle(path, index))
		.filter((angle) => angle !== null)
		.sort((first, second) => first - second);
	if (angles.length < 2) return FALLBACK_CORNER_ANGLE;

	const firstCandidate = Math.floor(angles.length * 0.1);
	const lastCandidate = Math.ceil(angles.length * 0.95);
	for (let index = firstCandidate; index < lastCandidate; index++) {
		const low = angles[index];
		const high = angles[index + 1];
		const midpoint = (low + high) / 2;
		if (high - low >= 5 && midpoint >= 10) {
			return Math.round(midpoint);
		}
	}

	return FALLBACK_CORNER_ANGLE;
}

export function detectCorners(
	path,
	cornerAngleThreshold = DEFAULT_OPTIONS.cornerAngleThreshold,
) {
	assertPath(path);
	const threshold =
		cornerAngleThreshold === 'auto'
			? calculateCornerAngleThreshold(path)
			: cornerAngleThreshold;
	if (!Number.isFinite(threshold) || threshold < 0 || threshold > 180) {
		throw new RangeError(
			"cornerAngleThreshold must be 'auto' or between 0 and 180 degrees",
		);
	}

	const corners = [];
	for (let index = 0; index < path.length; index++) {
		const angle = joinAngle(path, index);
		if (angle === null) {
			corners.push(index);
			continue;
		}

		if (angle >= threshold) {
			corners.push(index);
		}
	}

	return corners;
}

function evaluateCubic(curve, parameter) {
	const inverse = 1 - parameter;
	const b0 = inverse ** 3;
	const b1 = 3 * parameter * inverse ** 2;
	const b2 = 3 * parameter ** 2 * inverse;
	const b3 = parameter ** 3;
	return {
		x: curve[0].x * b0 + curve[1].x * b1 + curve[2].x * b2 + curve[3].x * b3,
		y: curve[0].y * b0 + curve[1].y * b1 + curve[2].y * b2 + curve[3].y * b3,
	};
}

function evaluateDerivative(curve, parameter) {
	const inverse = 1 - parameter;
	return add(
		scale(subtract(curve[1], curve[0]), 3 * inverse ** 2),
		add(
			scale(subtract(curve[2], curve[1]), 6 * inverse * parameter),
			scale(subtract(curve[3], curve[2]), 3 * parameter ** 2),
		),
	);
}

function evaluateSecondDerivative(curve, parameter) {
	return add(
		scale(
			add(subtract(curve[2], scale(curve[1], 2)), curve[0]),
			6 * (1 - parameter),
		),
		scale(add(subtract(curve[3], scale(curve[2], 2)), curve[1]), 6 * parameter),
	);
}

function chordLengthParameters(points) {
	const parameters = [0];
	for (let index = 1; index < points.length; index++) {
		parameters.push(
			parameters[index - 1] + distance(points[index], points[index - 1]),
		);
	}

	const total = parameters.at(-1);
	if (total <= EPSILON) {
		return parameters.map((_, index) => index / (parameters.length - 1));
	}
	return parameters.map((value) => value / total);
}

export function fitCubicToPoints(
	points,
	leftTangent,
	rightTangent,
	parameters = chordLengthParameters(points),
) {
	if (points.length < 2) {
		throw new TypeError('at least two points are required to fit a cubic');
	}

	const start = points[0];
	const end = points.at(-1);
	let c00 = 0;
	let c01 = 0;
	let c11 = 0;
	let x0 = 0;
	let x1 = 0;

	for (let index = 0; index < points.length; index++) {
		const parameter = parameters[index];
		const inverse = 1 - parameter;
		const b0 = inverse ** 3;
		const b1 = 3 * parameter * inverse ** 2;
		const b2 = 3 * parameter ** 2 * inverse;
		const b3 = parameter ** 3;
		const a1 = scale(leftTangent, b1);
		const a2 = scale(rightTangent, b2);
		const base = add(scale(start, b0 + b1), scale(end, b2 + b3));
		const residual = subtract(points[index], base);

		c00 += dot(a1, a1);
		c01 += dot(a1, a2);
		c11 += dot(a2, a2);
		x0 += dot(a1, residual);
		x1 += dot(a2, residual);
	}

	const determinant = c00 * c11 - c01 * c01;
	const chord = distance(start, end);
	let alphaLeft = chord / 3;
	let alphaRight = chord / 3;
	if (Math.abs(determinant) > EPSILON) {
		alphaLeft = (x0 * c11 - x1 * c01) / determinant;
		alphaRight = (c00 * x1 - c01 * x0) / determinant;
	}
	if (alphaLeft < EPSILON || alphaRight < EPSILON) {
		alphaLeft = chord / 3;
		alphaRight = chord / 3;
	}

	return [
		clonePoint(start),
		add(start, scale(leftTangent, alphaLeft)),
		add(end, scale(rightTangent, alphaRight)),
		clonePoint(end),
	];
}

export function maxError(points, curve, parameters) {
	let error = 0;
	let index = 0;
	for (let pointIndex = 1; pointIndex < points.length - 1; pointIndex++) {
		const deviation = distance(
			points[pointIndex],
			evaluateCubic(curve, parameters[pointIndex]),
		);
		if (deviation > error) {
			error = deviation;
			index = pointIndex;
		}
	}
	return { error, index };
}

export function reparameterize(points, curve, parameters) {
	const result = parameters.map((parameter, index) => {
		if (index === 0 || index === parameters.length - 1) {
			return parameter;
		}
		const difference = subtract(evaluateCubic(curve, parameter), points[index]);
		const firstDerivative = evaluateDerivative(curve, parameter);
		const denominator =
			dot(firstDerivative, firstDerivative) +
			dot(difference, evaluateSecondDerivative(curve, parameter));
		if (Math.abs(denominator) <= EPSILON) {
			return parameter;
		}
		return Math.max(
			0,
			Math.min(1, parameter - dot(difference, firstDerivative) / denominator),
		);
	});

	for (let index = 1; index < result.length; index++) {
		if (result[index] <= result[index - 1]) {
			return parameters;
		}
	}
	return result;
}

function axisExtremumType(previous, current, next, axis) {
	const maximum =
		current[axis] >= previous[axis] &&
		current[axis] >= next[axis] &&
		(current[axis] > previous[axis] || current[axis] > next[axis]);
	const minimum =
		current[axis] <= previous[axis] &&
		current[axis] <= next[axis] &&
		(current[axis] < previous[axis] || current[axis] < next[axis]);
	if (maximum) return 'maximum';
	if (minimum) return 'minimum';
	return null;
}

function interiorAxisExtrema(segment, axis) {
	const controls = effectiveControls(segment);
	const p0 = controls[0][axis];
	const p1 = controls[1][axis];
	const p2 = controls[2][axis];
	const p3 = controls[3][axis];
	const quadratic = -p0 + 3 * p1 - 3 * p2 + p3;
	const linear = 2 * (p0 - 2 * p1 + p2);
	const constant = p1 - p0;
	const roots = [];

	if (Math.abs(quadratic) <= EPSILON) {
		if (Math.abs(linear) <= EPSILON) return roots;
		const root = -constant / linear;
		if (root > EPSILON && root < 1 - EPSILON) roots.push(root);
	} else {
		const discriminant = linear * linear - 4 * quadratic * constant;
		if (discriminant <= 0) return roots;
		const rootOffset = Math.sqrt(discriminant);
		const denominator = 2 * quadratic;
		roots.push(
			(-linear + rootOffset) / denominator,
			(-linear - rootOffset) / denominator,
		);
	}

	return roots
		.filter((root) => root > EPSILON && root < 1 - EPSILON)
		.map((root) => {
			const value = evaluateCubic(controls, root)[axis];
			return {
				parameter: root,
				value,
				prominence: Math.min(Math.abs(value - p0), Math.abs(value - p3)),
			};
		});
}

function localAxisProminence(points, index, axis, type) {
	const current = points[index][axis];
	function relief(direction) {
		let opposite = current;
		for (let step = 1; step < points.length; step++) {
			const value =
				points[(index + direction * step + points.length) % points.length][
					axis
				];
			if (type === 'maximum') {
				if (value > current + EPSILON) break;
				opposite = Math.min(opposite, value);
			} else {
				if (value < current - EPSILON) break;
				opposite = Math.max(opposite, value);
			}
		}
		return Math.abs(current - opposite);
	}

	return Math.min(relief(-1), relief(1));
}

export function detectExtrema(path, tolerance = 0) {
	assertPath(path);
	if (!Number.isFinite(tolerance) || tolerance < 0) {
		throw new RangeError(
			'extrema tolerance must be a non-negative finite number',
		);
	}
	const result = new Set();
	const points = path.map((segment) => segment[0]);
	const segmentExtrema = path.map((segment) => ({
		x: interiorAxisExtrema(segment, 'x'),
		y: interiorAxisExtrema(segment, 'y'),
	}));
	const interiorX = segmentExtrema.flatMap((entry) =>
		entry.x.map((extremum) => extremum.value),
	);
	const interiorY = segmentExtrema.flatMap((entry) =>
		entry.y.map((extremum) => extremum.value),
	);
	const globalValues = {
		minX: Math.min(...points.map((point) => point.x), ...interiorX),
		maxX: Math.max(...points.map((point) => point.x), ...interiorX),
		minY: Math.min(...points.map((point) => point.y), ...interiorY),
		maxY: Math.max(...points.map((point) => point.y), ...interiorY),
	};
	const center = {
		x: (globalValues.minX + globalValues.maxX) / 2,
		y: (globalValues.minY + globalValues.maxY) / 2,
	};
	for (const [axis, value] of [
		['x', globalValues.minX],
		['x', globalValues.maxX],
		['y', globalValues.minY],
		['y', globalValues.maxY],
	]) {
		const perpendicularAxis = axis === 'x' ? 'y' : 'x';
		const candidates = points
			.map((point, index) => ({ point, index }))
			.filter(({ point }) => Math.abs(point[axis] - value) <= EPSILON)
			.sort(
				(first, second) =>
					Math.abs(first.point[perpendicularAxis] - center[perpendicularAxis]) -
					Math.abs(second.point[perpendicularAxis] - center[perpendicularAxis]),
			);
		if (candidates.length > 0) result.add(candidates[0].index);
	}

	for (let index = 0; index < path.length; index++) {
		const previous = path[(index - 1 + path.length) % path.length][0];
		const current = path[index][0];
		const next = path[(index + 1) % path.length][0];
		for (const axis of ['x', 'y']) {
			const type = axisExtremumType(previous, current, next, axis);
			if (
				type !== null &&
				localAxisProminence(points, index, axis, type) > tolerance
			) {
				result.add(index);
			}
		}

		const importantInteriorExtremum = ['x', 'y'].some((axis) =>
			segmentExtrema[index][axis].some((extremum) => {
				const globalMinimum = globalValues[axis === 'x' ? 'minX' : 'minY'];
				const globalMaximum = globalValues[axis === 'x' ? 'maxX' : 'maxY'];
				const isGlobal =
					Math.abs(extremum.value - globalMinimum) <= EPSILON ||
					Math.abs(extremum.value - globalMaximum) <= EPSILON;
				return isGlobal || extremum.prominence > tolerance;
			}),
		);
		if (importantInteriorExtremum) {
			result.add(index);
			result.add((index + 1) % path.length);
		}
	}
	return [...result].sort((first, second) => first - second);
}

function flattenForFit(curve, flatness, points, depth = 0) {
	if (isFlatEnough(curve, flatness)) {
		points.push(clonePoint(curve[3]));
		return true;
	}
	if (depth === 20) return false;
	const [left, right] = splitCubic(curve);
	return flattenForFit(left, flatness, points, depth + 1)
		&& flattenForFit(right, flatness, points, depth + 1);
}

function sampleContour(path, flatness) {
	const points = [];
	const events = [];
	for (let index = 0; index < path.length; index++) {
		const segment = path[index];
		const roots = [...new Set(['x', 'y'].flatMap((axis) =>
			interiorAxisExtrema(segment, axis).map((entry) => entry.parameter),
		))].sort((first, second) => first - second);
		let remainder = effectiveControls(segment);
		let previous = 0;
		for (const parameter of [...roots, 1]) {
			const [piece, next] = parameter === 1
				? [remainder, null]
				: splitCubic(remainder, (parameter - previous) / (1 - previous));
			if (points.length === 0) points.push(clonePoint(piece[0]));
			events.push({ index: points.length - 1, angle: previous === 0 ? joinAngle(path, index) : 0 });
			if (!flattenForFit(piece, flatness, points)) return null;
			remainder = next;
			previous = parameter;
		}
	}
	points.pop();
	const unique = [];
	const indices = [];
	for (const point of points) {
		if (!unique.length || distance(point, unique.at(-1)) > EPSILON) unique.push(point);
		indices.push(unique.length - 1);
	}
	if (unique.length > 1 && distance(unique[0], unique.at(-1)) <= EPSILON) {
		unique.pop();
		for (let index = 0; index < indices.length; index++) {
			if (indices[index] === unique.length) indices[index] = 0;
		}
	}
	return { points: unique, events: events.map((event) => ({ ...event, index: indices[event.index] })) };
}

function arcLengths(points) {
	const lengths = [0];
	for (let index = 1; index < points.length; index++) {
		lengths.push(lengths.at(-1) + distance(points[index - 1], points[index]));
	}
	return lengths;
}

function pointAlong(points, index, direction, reach, closed = false) {
	let current = points[index];
	for (let step = 1; step < points.length; step++) {
		const nextIndex = index + step * direction;
		if (!closed && (nextIndex < 0 || nextIndex >= points.length)) break;
		const next = points[(nextIndex + points.length) % points.length];
		const length = distance(current, next);
		if (length >= reach && length > 0) return lerp(current, next, reach / length);
		reach -= length;
		current = next;
	}
	return current;
}

function contourFeatures(contour, options) {
	const { points, events } = contour;
	const lengths = arcLengths([...points, points[0]]);
	const perimeter = lengths.at(-1);
	const support = Math.min(Math.max(options.tolerance * 2, perimeter / 1000), perimeter / 32);
	const threshold = options.cornerAngleThreshold;
	const anchors = new Map();
	const corners = [];
	for (const event of events) {
		if (event.angle === null || event.angle < threshold) continue;
		const incoming = normalize(subtract(points[event.index], pointAlong(points, event.index, -1, support, true)));
		const outgoing = normalize(subtract(pointAlong(points, event.index, 1, support, true), points[event.index]));
		if (!incoming || !outgoing) continue;
		const angle = Math.acos(Math.max(-1, Math.min(1, dot(incoming, outgoing)))) * 180 / Math.PI;
		if (angle + 1e-7 >= threshold) corners.push({ index: event.index, angle });
	}
	for (const corner of corners.sort((first, second) => second.angle - first.angle || first.index - second.index)) {
		const nearCorner = [...anchors.keys()].some((index) => {
			const separation = Math.abs(lengths[index] - lengths[corner.index]);
			return Math.min(separation, perimeter - separation) < support / 2;
		});
		if (!nearCorner) anchors.set(corner.index, { corner: true, axes: new Set() });
	}
	const eventIndices = [...new Set(events.map((event) => event.index))].sort((first, second) => first - second);
	const eventPoints = eventIndices.map((index) => points[index]);
	if (options.preserveExtrema) {
		for (const axis of ['x', 'y']) {
			const values = eventPoints.map((point) => point[axis]);
			const minimum = Math.min(...values);
			const maximum = Math.max(...values);
			for (let index = 0; index < eventPoints.length; index++) {
				const current = eventPoints[index];
				const previous = eventPoints[(index - 1 + eventPoints.length) % eventPoints.length];
				const next = eventPoints[(index + 1) % eventPoints.length];
				const type = axisExtremumType(previous, current, next, axis);
				const global = index === values.indexOf(minimum) || index === values.indexOf(maximum);
				const significant = type !== null && localAxisProminence(eventPoints, index, axis, type) > options.tolerance;
				if (!global && !significant) continue;
				if (!global && current[axis] === previous[axis]) continue;
				const pointIndex = eventIndices[index];
				const anchor = anchors.get(pointIndex) ?? { corner: false, axes: new Set() };
				anchor.axes.add(axis);
				anchors.set(pointIndex, anchor);
			}
		}
	}
	let seam = 0;
	for (let index = 1; index < points.length; index++) {
		if (points[index].x < points[seam].x || (points[index].x === points[seam].x && points[index].y < points[seam].y)) seam = index;
	}
	if (!anchors.size) anchors.set(seam, { corner: false, axes: new Set() });
	if (anchors.size === 1) {
		const first = [...anchors.keys()][0];
		let opposite = first;
		for (let index = 0; index < points.length; index++) {
			if (distance(points[first], points[index]) > distance(points[first], points[opposite])) opposite = index;
		}
		anchors.set(opposite, { corner: false, axes: new Set() });
	}
	return { anchors, support };
}

function nearestOnPolyline(point, polyline) {
	let squaredDistance = Infinity;
	let nearestIndex = 0;
	for (let index = 1; index < polyline.length; index++) {
		const start = polyline[index - 1];
		const end = polyline[index];
		const deltaX = end.x - start.x;
		const deltaY = end.y - start.y;
		const lengthSquared = deltaX * deltaX + deltaY * deltaY;
		const parameter = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
			((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared));
		const deltaPointX = point.x - start.x - parameter * deltaX;
		const deltaPointY = point.y - start.y - parameter * deltaY;
		const candidate = deltaPointX * deltaPointX + deltaPointY * deltaPointY;
		if (candidate < squaredDistance) {
			squaredDistance = candidate;
			nearestIndex = index;
		}
	}
	return { error: Math.sqrt(squaredDistance), index: nearestIndex };
}

function directedPolylineCheck(source, target, limit) {
	const distances = source.map((point) => nearestOnPolyline(point, target));
	let worst = 0;
	for (let index = 1; index < source.length; index++) {
		if (distances[index].error > distances[worst].error) worst = index;
	}
	if (distances[worst].error > limit) {
		return { accepted: false, index: worst, nearest: distances[worst].index };
	}
	for (let index = 1; index < source.length; index++) {
		const pending = [{ start: source[index - 1], end: source[index], left: distances[index - 1].error, right: distances[index].error, depth: 0 }];
		while (pending.length) {
			const interval = pending.pop();
			const length = distance(interval.start, interval.end);
			const upperBound = (interval.left + interval.right + length) / 2;
			if (upperBound <= limit) continue;
			const midpoint = lerp(interval.start, interval.end, 0.5);
			const nearest = nearestOnPolyline(midpoint, target);
			if (nearest.error > limit || interval.depth === 20) {
				return { accepted: false, index, nearest: nearest.index };
			}
			pending.push(
				{ start: interval.start, end: midpoint, left: interval.left, right: nearest.error, depth: interval.depth + 1 },
				{ start: midpoint, end: interval.end, left: nearest.error, right: interval.right, depth: interval.depth + 1 },
			);
		}
	}
	return { accepted: true, index: worst };
}

function curveInBounds(curve, bounds) {
	if (!bounds) return true;
	for (const axis of ['x', 'y']) {
		const values = [curve[0][axis], curve[3][axis], ...interiorAxisExtrema(curve, axis).map((entry) => entry.value)];
		if (Math.min(...values) < bounds[axis][0] - EPSILON || Math.max(...values) > bounds[axis][1] + EPSILON) return false;
	}
	return true;
}

function validateCurve(points, curve, settings) {
	if (!curve.every((point) => point === false || isPoint(point)) || !curveInBounds(curve, settings.bounds)) {
		return { accepted: false, index: Math.floor(points.length / 2) };
	}
	const candidate = [curve[0]];
	if (!flattenForFit(effectiveControls(curve), settings.flatness, candidate)) {
		return { accepted: false, index: Math.floor(points.length / 2) };
	}
	const limit = settings.tolerance - 2 * settings.flatness;
	const forward = directedPolylineCheck(points, candidate, limit);
	if (!forward.accepted) return forward;
	const reverse = directedPolylineCheck(candidate, points, limit);
	return reverse.accepted ? forward : { accepted: false, index: reverse.nearest };
}

function uniformSamples(points) {
	const lengths = arcLengths(points);
	const total = lengths.at(-1);
	const samples = [points[0]];
	let cursor = 1;
	for (let index = 1; index < 64; index++) {
		const position = total * index / 64;
		while (cursor < points.length - 1 && lengths[cursor] < position) cursor++;
		const length = lengths[cursor] - lengths[cursor - 1];
		samples.push(lerp(points[cursor - 1], points[cursor], length === 0 ? 0 : (position - lengths[cursor - 1]) / length));
	}
	samples.push(points.at(-1));
	return samples;
}

function featureTangent(points, index, direction, support, feature) {
	let vector = subtract(pointAlong(points, index, direction, support), points[index]);
	if (!feature.corner) {
		for (const axis of feature.axes) vector[axis] = 0;
	}
	return normalize(vector) ?? normalize(subtract(points[direction === 1 ? points.length - 1 : 0], points[index]));
}

function fitContourSpan(points, leftTangent, rightTangent, settings, depth = 0) {
	const line = [clonePoint(points[0]), false, false, clonePoint(points.at(-1))];
	const chord = normalize(subtract(points.at(-1), points[0]));
	if (chord && leftTangent && rightTangent
		&& dot(chord, leftTangent) >= 1 - EPSILON
		&& dot(chord, rightTangent) <= -1 + EPSILON
		&& validateCurve(points, line, settings).accepted) return [line];
	if (depth === 32 || !leftTangent || !rightTangent) return null;
	const samples = uniformSamples(points);
	let parameters = chordLengthParameters(samples);
	let splitIndex = Math.floor(points.length / 2);
	for (let iteration = 0; iteration <= settings.maxIterations; iteration++) {
		const curve = fitCubicToPoints(samples, leftTangent, rightTangent, parameters);
		const validation = validateCurve(points, curve, settings);
		if (validation.accepted) return [curve];
		splitIndex = validation.index;
		parameters = reparameterize(samples, curve, parameters);
	}
	if (points.length < 3) {
		let handleLength = Math.min(distance(points[0], points.at(-1)) / 3, settings.tolerance / 4);
		for (let attempt = 0; attempt < 16; attempt++) {
			const curve = [clonePoint(points[0]), add(points[0], scale(leftTangent, handleLength)),
				add(points.at(-1), scale(rightTangent, handleLength)), clonePoint(points.at(-1))];
			if (validateCurve(points, curve, settings).accepted) return [curve];
			handleLength /= 2;
		}
		return null;
	}
	splitIndex = Math.max(1, Math.min(points.length - 2, splitIndex));
	const backward = pointAlong(points, splitIndex, -1, settings.support);
	const forward = pointAlong(points, splitIndex, 1, settings.support);
	const direction = subtract(forward, backward);
	if (settings.bounds) {
		for (const axis of ['x', 'y']) {
			if (settings.bounds[axis].some((bound) => Math.abs(points[splitIndex][axis] - bound) <= EPSILON)) {
				direction[axis] = 0;
			}
		}
	}
	const tangent = normalize(direction);
	if (!tangent) return null;
	const left = fitContourSpan(points.slice(0, splitIndex + 1), leftTangent, scale(tangent, -1), settings, depth + 1);
	if (!left) return null;
	const right = fitContourSpan(points.slice(splitIndex), tangent, rightTangent, settings, depth + 1);
	return right ? [...left, ...right] : null;
}

export function simplifyPath(path, options) {
	assertPath(path);
	const normalizedOptions =
		typeof options === 'number' ? { tolerance: options } : options;
	if (normalizedOptions === null || typeof normalizedOptions !== 'object') {
		throw new TypeError('options with a tolerance value are required');
	}

	const settings = { ...DEFAULT_OPTIONS, ...normalizedOptions };
	if (!Number.isFinite(settings.tolerance) || settings.tolerance < 0) {
		throw new RangeError('tolerance must be a non-negative finite number');
	}
	if (!Number.isInteger(settings.maxIterations) || settings.maxIterations < 0) {
		throw new RangeError('maxIterations must be a non-negative integer');
	}

	detectCorners(path, settings.cornerAngleThreshold);
	if (settings.tolerance === 0) return path.map(cloneSegment);
	settings.cornerAngleThreshold = settings.cornerAngleThreshold === 'auto'
		? calculateCornerAngleThreshold(path) : settings.cornerAngleThreshold;
	settings.flatness = settings.tolerance / 16;
	const geometry = path.filter((segment) => effectiveControls(segment).some((point) =>
		point.x !== segment[0].x || point.y !== segment[0].y,
	));
	const contour = sampleContour(geometry, settings.flatness);
	if (!contour || contour.points.length < 3) return path.map(cloneSegment);
	const { points } = contour;
	const { anchors, support } = contourFeatures(contour, settings);
	settings.support = support;
	settings.bounds = settings.preserveExtrema ? {
		x: [Math.min(...points.map((point) => point.x)), Math.max(...points.map((point) => point.x))],
		y: [Math.min(...points.map((point) => point.y)), Math.max(...points.map((point) => point.y))],
	} : null;
	const boundaries = [...anchors.keys()].sort((first, second) => first - second);
	const result = [];
	for (let index = 0; index < boundaries.length; index++) {
		const start = boundaries[index];
		const end = boundaries[(index + 1) % boundaries.length];
		const span = start < end ? points.slice(start, end + 1)
			: [...points.slice(start), ...points.slice(0, end + 1)];
		const leftTangent = featureTangent(span, 0, 1, support, anchors.get(start));
		const rightTangent = featureTangent(span, span.length - 1, -1, support, anchors.get(end));
		const curves = fitContourSpan(span, leftTangent, rightTangent, settings);
		if (!curves) return path.map(cloneSegment);
		result.push(...curves);
	}
	return result.length < path.length ? result : path.map(cloneSegment);
}
