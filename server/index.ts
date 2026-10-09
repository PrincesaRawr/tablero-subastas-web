import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// En producción el servidor compilado vive en dist/server y la web en dist/client.
const staticDir = path.resolve(here, '../client');
const port = Number(process.env.PORT ?? 3001);

const server = await startServer({ port, staticDir });
console.log(`Tablero de Subastas escuchando en http://localhost:${server.port}`);
