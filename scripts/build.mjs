import { copyFile, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await Promise.all([
	copyFile('src/index.js', 'dist/bezier-simplify.js'),
	copyFile('src/index.d.ts', 'dist/index.d.ts'),
]);

console.log('Built dist/bezier-simplify.js and dist/index.d.ts');
