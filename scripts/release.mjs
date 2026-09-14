import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const packageJson = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const tag = `v${packageJson.version}`;
const arguments_ = [
	'release',
	'create',
	tag,
	'--title',
	tag,
	'--generate-notes',
];

if (process.argv.includes('--dry-run')) {
	console.log(`gh ${arguments_.join(' ')}`);
	process.exit(0);
}

const result = spawnSync('gh', arguments_, { stdio: 'inherit', shell: true });

if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 1);