import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesiumStatic';

function probePuente(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/salud`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.setTimeout(700, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

/**
 * Arranca herramientas/motor-puente/servidor.mjs en 127.0.0.1:5174 siempre que
 * se inicia la web (vite dev o vite preview), salvo que ya esté escuchando.
 */
function motorPuentePlugin(): Plugin {
  const attach = (
    httpServer:
      | { once: (event: 'listening' | 'close', listener: () => void) => unknown; listening?: boolean }
      | null
      | undefined
  ) => {
    if (!httpServer) return;
    const bridgeScript = path.resolve(__dirname, '../herramientas/motor-puente/servidor.mjs');
    if (!fs.existsSync(bridgeScript)) return;

    const startBridge = async () => {
      if (await probePuente(5174)) return;
      const child = spawn(process.execPath, [bridgeScript], {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
        windowsHide: true,
      });
      child.on('error', (err) => {
        console.warn('[motor-puente] No se pudo iniciar automáticamente:', err.message);
      });
      const stopChild = () => {
        if (!child.killed && child.exitCode === null) {
          child.kill();
        }
      };
      httpServer.once('close', stopChild);
      process.once('exit', stopChild);
    };

    if (httpServer.listening) {
      void startBridge();
    } else {
      httpServer.once('listening', () => {
        void startBridge();
      });
    }
  };

  return {
    name: 'motor-puente-autostart',
    configureServer(server) {
      attach(server.httpServer);
    },
    configurePreviewServer(server) {
      attach(server.httpServer);
    },
  };
}

/**
 * Terreno local (I-40): las teselas `.terrain` de quantized-mesh vienen comprimidas con gzip.
 * El servidor de desarrollo de Vite no avisa eso al navegador; este plugin agrega
 * `Content-Encoding: gzip` cuando el archivo empieza con la firma de gzip.
 */
function terrainGzipHeaders(): Plugin {
  return {
    name: 'terrain-gzip-headers',
    configureServer(server) {
      const publicDir = path.resolve(server.config.root, 'public');
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.endsWith('.terrain')) return next();
        const filePath = path.resolve(publicDir, '.' + decodeURIComponent(url));
        if (!filePath.startsWith(publicDir + path.sep)) return next();
        fs.readFile(filePath, (err, content) => {
          if (err) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader('Content-Type', 'application/vnd.quantized-mesh');
          if (content.length > 2 && content[0] === 0x1f && content[1] === 0x8b) {
            res.setHeader('Content-Encoding', 'gzip');
          }
          res.end(content);
        });
      });
    },
  };
}

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  server: {
    port: 5173, // 5174 es del puente del motor (herramientas/motor-puente/servidor.mjs), que solo acepta el origen localhost:5173
    strictPort: true,
    proxy: {
      '/proxy/power': {
        target: 'https://power.larc.nasa.gov',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/power/, ''),
      },
      '/proxy/soilgrids-wms': {
        target: 'https://maps.isric.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/soilgrids-wms/, ''),
      },
      '/proxy/macrostrat': {
        target: 'https://macrostrat.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/macrostrat/, ''),
      },
      '/proxy/overpass': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/overpass/, ''),
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Workers`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Assets`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Widgets`, dest: cesiumBaseUrl },
      ],
    }),
    terrainGzipHeaders(),
    motorPuentePlugin(),
  ],
  build: {
    // Cesium ocupa varios MB: va en su propio chunk (R7) para que el navegador lo guarde
    // aparte del código de la app y no lo vuelva a bajar cuando cambia la app.
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/cesium') || id.includes('node_modules/@cesium')) {
            return 'cesium';
          }
          return undefined;
        },
      },
      onwarn(warning, warn) {
        if (warning.code === 'EVAL' && warning.id?.includes('protobuf')) {
          return;
        }
        warn(warning);
      },
    },
  },
});
