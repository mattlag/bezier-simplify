import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	calculateCornerAngleThreshold,
	detectCorners,
	detectExtrema,
	flattenSegment,
	simplifyPath,
} from '../src/index.js';

const sampleDirectory = new URL('./sample-curves/', import.meta.url);

async function loadSample(fileName) {
	return JSON.parse(await readFile(new URL(fileName, sampleDirectory), 'utf8'));
}

function splitSegment(segment) {
	const controls = [
		segment[0],
		segment[1] === false ? segment[0] : segment[1],
		segment[2] === false ? segment[3] : segment[2],
		segment[3],
	];
	const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
	const p01 = midpoint(controls[0], controls[1]);
	const p12 = midpoint(controls[1], controls[2]);
	const p23 = midpoint(controls[2], controls[3]);
	const p012 = midpoint(p01, p12);
	const p123 = midpoint(p12, p23);
	const p0123 = midpoint(p012, p123);
	return [
		[controls[0], p01, p012, p0123],
		[p0123, p123, p23, controls[3]],
	];
}

function assertClosed(loop) {
	for (let index = 0; index < loop.length; index++) {
		assert.deepEqual(loop[index][3], loop[(index + 1) % loop.length][0]);
	}
}

function evaluateSegment(segment, parameter) {
	const start = segment[0];
	const end = segment[3];
	if (segment[1] === false && segment[2] === false) {
		return {
			x: start.x + (end.x - start.x) * parameter,
			y: start.y + (end.y - start.y) * parameter,
		};
	}
	const controls = [start, segment[1] || start, segment[2] || end, end];
	const weights = [
		(1 - parameter) ** 3,
		3 * parameter * (1 - parameter) ** 2,
		3 * parameter ** 2 * (1 - parameter),
		parameter ** 3,
	];
	return Object.fromEntries(
		['x', 'y'].map((axis) => [
			axis,
			controls.reduce(
				(sum, point, index) => sum + point[axis] * weights[index],
				0,
			),
		]),
	);
}

function exactBounds(loop) {
	const values = { x: [], y: [] };
	for (const segment of loop) {
		const controls = [
			segment[0],
			segment[1] || segment[0],
			segment[2] || segment[3],
			segment[3],
		];
		for (const axis of ['x', 'y']) {
			const coordinates = controls.map((point) => point[axis]);
			const quadratic =
				3 *
				(-coordinates[0] +
					3 * coordinates[1] -
					3 * coordinates[2] +
					coordinates[3]);
			const linear = 6 * (coordinates[0] - 2 * coordinates[1] + coordinates[2]);
			const constant = 3 * (coordinates[1] - coordinates[0]);
			const discriminant = linear ** 2 - 4 * quadratic * constant;
			const roots =
				Math.abs(quadratic) < 1e-12
					? linear === 0
						? []
						: [-constant / linear]
					: discriminant < 0
						? []
						: [
								(-linear - Math.sqrt(discriminant)) / (2 * quadratic),
								(-linear + Math.sqrt(discriminant)) / (2 * quadratic),
							];
			values[axis].push(segment[0][axis], segment[3][axis]);
			for (const root of roots) {
				if (root > 0 && root < 1)
					values[axis].push(evaluateSegment(segment, root)[axis]);
			}
		}
	}
	return {
		x: [Math.min(...values.x), Math.max(...values.x)],
		y: [Math.min(...values.y), Math.max(...values.y)],
	};
}

function sampledDistance(source, target, samplesPerSegment = 16) {
	const polyline = target.flatMap((segment) =>
		flattenSegment(segment, 0.01).slice(0, -1),
	);
	polyline.push(polyline[0]);
	let maximum = 0;
	for (const segment of source) {
		for (let sample = 0; sample <= samplesPerSegment; sample++) {
			const point = evaluateSegment(segment, sample / samplesPerSegment);
			let minimumSquared = Infinity;
			for (let index = 1; index < polyline.length; index++) {
				const start = polyline[index - 1];
				const end = polyline[index];
				const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
				const parameter =
					lengthSquared === 0
						? 0
						: Math.max(
								0,
								Math.min(
									1,
									((point.x - start.x) * (end.x - start.x) +
										(point.y - start.y) * (end.y - start.y)) /
										lengthSquared,
								),
							);
				minimumSquared = Math.min(
					minimumSquared,
					(point.x - start.x - parameter * (end.x - start.x)) ** 2 +
						(point.y - start.y - parameter * (end.y - start.y)) ** 2,
				);
			}
			maximum = Math.max(maximum, Math.sqrt(minimumSquared));
		}
	}
	return maximum;
}

test('detectCorners identifies every square corner', async () => {
	const square = await loadSample('01-square.json');
	assert.deepEqual(detectCorners(square), [0, 1, 2, 3]);
});

test('corner angle defaults adapt to the shape', async () => {
	const square = await loadSample('01-square.json');
	const circle = await loadSample('05-circle.json');
	const wavyShape = await loadSample('07-wavy-shape.json');
	assert.equal(calculateCornerAngleThreshold(square), 30);
	assert.equal(calculateCornerAngleThreshold(circle), 30);
	assert.ok(calculateCornerAngleThreshold(wavyShape) > 20);
	assert.ok(calculateCornerAngleThreshold(wavyShape) < 30);
});

test('global and prominent local extrema are preserved by default', async () => {
	const wavyShape = await loadSample('07-wavy-shape.json');
	const tolerance = 5;
	const simplified = simplifyPath(wavyShape, { tolerance });
	const before = exactBounds(wavyShape);
	const after = exactBounds(simplified);
	for (const axis of ['x', 'y']) {
		for (const index of [0, 1]) {
			assert.ok(Math.abs(before[axis][index] - after[axis][index]) < 1e-7);
		}
	}
});

test('interior extrema become exact anchors without freezing their original segments', () => {
	const loop = [
		[
			{ x: 0, y: 0 },
			{ x: 0, y: 10 },
			{ x: 10, y: 10 },
			{ x: 10, y: 0 },
		],
		[{ x: 10, y: 0 }, false, false, { x: 20, y: 20 }],
		[{ x: 20, y: 20 }, false, false, { x: 30, y: -20 }],
		[{ x: 30, y: -20 }, false, false, { x: -10, y: -20 }],
		[{ x: -10, y: -20 }, false, false, { x: 0, y: 0 }],
	];
	assert.ok(detectExtrema(loop, 5).includes(1));
	assert.ok(!detectExtrema(loop, 10).includes(1));
	const subdivided = loop.flatMap(splitSegment).flatMap(splitSegment);
	const simplified = simplifyPath(subdivided, {
		tolerance: 5,
		cornerAngleThreshold: 180,
	});
	assert.ok(simplified.length < subdivided.length);
	assert.ok(
		simplified.some(
			(segment) =>
				Math.abs(segment[0].x - 5) < 1e-7 &&
				Math.abs(segment[0].y - 7.5) < 1e-7,
		),
	);
	assertClosed(simplified);
});

test('local extrema become less strict as tolerance increases', async () => {
	const points = [
		{ x: 0, y: 0 },
		{ x: 10, y: 5 },
		{ x: 20, y: 0 },
		{ x: 30, y: 20 },
		{ x: 40, y: 0 },
		{ x: 50, y: 40 },
		{ x: 60, y: -30 },
	];
	const loop = points.map((point, index) => [
		point,
		false,
		false,
		points[(index + 1) % points.length],
	]);
	const strict = detectExtrema(loop, 1);
	const moderate = detectExtrema(loop, 10);
	const loose = detectExtrema(loop, 30);
	assert.ok(strict.length > moderate.length);
	assert.ok(moderate.length > loose.length);

	for (const axis of ['x', 'y']) {
		const values = points.map((point) => point[axis]);
		for (const value of [Math.min(...values), Math.max(...values)]) {
			assert.ok(loose.some((index) => points[index][axis] === value));
		}
	}
});

test('sharp polygons remain unchanged at a large tolerance', async () => {
	const square = await loadSample('01-square.json');
	const simplified = simplifyPath(square, { tolerance: 1000 });
	assert.deepEqual(simplified, square);
	assert.notStrictEqual(simplified, square);
});

test('an exactly subdivided smooth loop can be reduced', async () => {
	const circle = await loadSample('05-circle.json');
	const subdivided = circle.flatMap(splitSegment);
	const simplified = simplifyPath(subdivided, { tolerance: 0.1 });
	assert.ok(simplified.length < subdivided.length);
	assertClosed(simplified);
});

test('line segments flatten to their two endpoints', async () => {
	const square = await loadSample('01-square.json');
	assert.deepEqual(flattenSegment(square[0]), [square[0][0], square[0][3]]);
});

test('flattening retains collinear backtracking beyond the endpoint chord', () => {
	const curve = [
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		{ x: 100, y: 0 },
		{ x: 10, y: 0 },
	];
	const points = flattenSegment(curve, 0.01);
	assert.ok(Math.max(...points.map((point) => point.x)) > 70);
	assert.deepEqual(points[0], curve[0]);
	assert.deepEqual(points.at(-1), curve[3]);
});

test('all sample loops stay connected and never gain segments', async () => {
	const fileNames = (await readdir(sampleDirectory)).filter((name) =>
		name.endsWith('.json'),
	);
	for (const fileName of fileNames) {
		const loop = await loadSample(fileName);
		const snapshot = structuredClone(loop);
		const simplified = simplifyPath(loop, { tolerance: 5 });
		assert.ok(simplified.length <= loop.length, fileName);
		assertClosed(simplified);
		assert.deepEqual(loop, snapshot, `${fileName} was mutated`);
	}
});

test('invalid tolerances and disconnected paths are rejected', async () => {
	const square = await loadSample('01-square.json');
	assert.throws(() => simplifyPath(square, { tolerance: -1 }), /tolerance/);
	const disconnected = structuredClone(square);
	disconnected[0][3].x += 1;
	assert.throws(
		() => simplifyPath(disconnected, { tolerance: 1 }),
		/not closed and connected/,
	);
});

test('zero tolerance returns an unchanged deep copy, including degenerate segments', async () => {
	const loop = await loadSample('16-glyph-x-stress.json');
	const result = simplifyPath(loop, 0);
	assert.deepEqual(result, loop);
	assert.notStrictEqual(result[0][0], loop[0][0]);
});

test('stress glyph reconstruction stays within tolerance in both directions', async () => {
	for (const file of [
		'15-glyph-s-stress.json',
		'16-glyph-x-stress.json',
		'17-glyph-2-stress.json',
	]) {
		const loop = await loadSample(file);
		let previousCount = loop.length;
		for (const tolerance of [1, 5, 10, 25, 50]) {
			const result = simplifyPath(loop, {
				tolerance,
				cornerAngleThreshold: 180,
			});
			assert.ok(
				result.length <= previousCount,
				`${file}: count increased at tolerance ${tolerance}`,
			);
			previousCount = result.length;
			assertClosed(result);
			const forward = sampledDistance(loop, result, 8);
			const reverse = sampledDistance(result, loop, 64);
			assert.ok(
				forward <= tolerance + 0.02,
				`${file}: original-to-result error ${forward} > ${tolerance}`,
			);
			assert.ok(
				reverse <= tolerance + 0.02,
				`${file}: result-to-original error ${reverse} > ${tolerance}`,
			);
			const before = exactBounds(loop);
			const after = exactBounds(result);
			for (const axis of ['x', 'y']) {
				for (const index of [0, 1])
					assert.ok(Math.abs(before[axis][index] - after[axis][index]) < 1e-7);
			}
		}
		assert.ok(
			previousCount < 25,
			`${file}: failed to reconstruct the overall shape`,
		);
	}
});

test('smooth reconstruction is stable under subdivision and moving the loop start', async () => {
	const circle = await loadSample('05-circle.json');
	const dense = circle
		.flatMap(splitSegment)
		.flatMap(splitSegment)
		.flatMap(splitSegment);
	const uneven = [
		...circle.slice(0, 1).flatMap(splitSegment).flatMap(splitSegment),
		...circle.slice(1),
	];
	const rotated = [...dense.slice(7), ...dense.slice(0, 7)];
	for (const loop of [dense, uneven, rotated]) {
		const result = simplifyPath(loop, { tolerance: 1 });
		assert.equal(result.length, 4);
		assertClosed(result);
		assert.ok(sampledDistance(circle, result, 64) <= 1.02);
		assert.ok(sampledDistance(result, circle, 64) <= 1.02);
	}
});

test('large tolerances do not replace smooth extrema with angular line joins', async () => {
	const circle = await loadSample('05-circle.json');
	const dense = circle.flatMap(splitSegment).flatMap(splitSegment);
	const result = simplifyPath(dense, {
		tolerance: 50,
		cornerAngleThreshold: 180,
	});
	assert.equal(result.length, 4);
	for (let index = 0; index < result.length; index++) {
		const curve = result[index];
		const next = result[(index + 1) % result.length];
		assert.notEqual(curve[1], false);
		assert.notEqual(curve[2], false);
		const incoming = { x: curve[3].x - curve[2].x, y: curve[3].y - curve[2].y };
		const outgoing = { x: next[1].x - next[0].x, y: next[1].y - next[0].y };
		assert.ok(
			Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x) < 1e-7,
		);
		assert.ok(incoming.x * outgoing.x + incoming.y * outgoing.y > 0);
	}
});

test('duplicate zero-length joins do not become artificial corners', () => {
	const points = [
		{ x: 0, y: 0 },
		{ x: 50, y: 0 },
		{ x: 100, y: 0 },
		{ x: 100, y: 100 },
		{ x: 0, y: 100 },
	];
	const loop = points.map((point, index) => [
		point,
		false,
		false,
		points[(index + 1) % points.length],
	]);
	const duplicated = loop.flatMap((segment) => [
		[segment[0], false, false, segment[0]],
		segment,
	]);
	const options = { tolerance: 30, preserveExtrema: false };
	const normal = simplifyPath(loop, options);
	const result = simplifyPath(duplicated, options);
	assert.equal(result.length, normal.length);
	for (const point of [points[0], points[2], points[3], points[4]]) {
		assert.ok(
			result.some(
				(segment) => segment[0].x === point.x && segment[0].y === point.y,
			),
		);
	}
});
