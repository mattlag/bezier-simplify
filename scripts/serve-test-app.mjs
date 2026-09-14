import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const contentTypes = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
};

createServer(async (request, response) => {
	const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
	const requestedPath =
		url.pathname === '/' ? '/test/index.html' : url.pathname;
	const filePath = path.resolve(root, `.${requestedPath}`);

	if (!filePath.startsWith(root)) {
		response.writeHead(403).end('Forbidden');
		return;
	}

	try {
		const fileStat = await stat(filePath);
		if (!fileStat.isFile()) {
			throw new Error('Not a file');
		}
		response.writeHead(200, {
			'Content-Type':
				contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
			'Cache-Control': 'no-store',
		});
		createReadStream(filePath).pipe(response);
	} catch {
		response.writeHead(404).end('Not found');
	}
}).listen(port, '127.0.0.1', () => {
	console.log(`Bezier Simplify test app: http://127.0.0.1:${port}`);
});
