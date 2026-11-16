// Empaqueta y corre las pruebas de medición con Node (sin dependencias nuevas: usa el
// esbuild que ya trae Vite). Uso: npm run prueba
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pruebas = ['medicion', 'capasZona', 'areaGeo', 'dockLayout', 'bonoCercania', 'valorSitio'];

for (const nombre of pruebas) {
  const salida = path.join(raiz, 'node_modules', '.cache', 'pruebas', `${nombre}.mjs`);

  await build({
    entryPoints: [path.join(raiz, 'pruebas', `${nombre}.prueba.ts`)],
    outfile: salida,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    external: ['cesium'],
    define: {
      'import.meta.env.BASE_URL': '"/"',
      'import.meta.env.VITE_CESIUM_ION_TOKEN': '""',
    },
    logLevel: 'warning',
  });

  const r = spawnSync(process.execPath, [salida], { stdio: 'inherit', cwd: raiz });
  if ((r.status ?? 1) !== 0) {
    process.exit(r.status ?? 1);
  }
}

process.exit(0);
