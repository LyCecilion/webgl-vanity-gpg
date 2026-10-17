import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import vue from '@vitejs/plugin-vue';
import { defineConfig, Plugin, TransformResult } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

// The production build is a self-contained localhost application. The CSP below
// is injected only into the built HTML: the development server needs websockets
// and inline eval for HMR, which the shipped page must never allow.
const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self' data:",
    "connect-src 'none'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
].join('; ');

const shaderMinifier = (): Plugin | undefined => {
    // Download shader_minifier executable from:
    // https://github.com/laurentlb/shader-minifier
    if (process.env.NODE_ENV !== 'production') return undefined;
    if (childProcess.spawnSync('shader_minifier', ['--help']).error) {
        console.warn('Shader minifier is not available.');
        return undefined;
    }
    return {
        name: 'minify-shader',
        async transform(code, id) {
            if (!id.endsWith('.glsl?raw')) return undefined;
            const temp = path.join(os.tmpdir(), Math.random().toString(36).substring(2, 10));
            const result: TransformResult = { code: '', map: null };
            try {
                await new Promise<void>((resolve, reject) => {
                    const child = childProcess.spawn('shader_minifier', [
                        '-o', temp,
                        '--format', 'text',
                        '--aggressive-inlining',
                        '--preserve-externals',
                        id.replace(/\?raw$/g, ''),
                    ]);
                    child.on('close', () => resolve());
                    child.on('error', reject);
                });
                result.code = `export default ${JSON.stringify(await fs.promises.readFile(temp, { encoding: 'utf-8' }))}`;
            } finally {
                await fs.promises.unlink(temp).catch(() => {});
            }
            return result;
        },
    } as Plugin;
};

const injectContentSecurityPolicy = (): Plugin => ({
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
        return {
            html,
            tags: [{
                tag: 'meta',
                attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy },
                injectTo: 'head-prepend',
            }],
        };
    },
});

// https://vitejs.dev/config/
export default defineConfig({
    base: '',
    server: { host: '127.0.0.1' },
    preview: { host: '127.0.0.1' },
    plugins: [
        vue(),
        shaderMinifier(),
        injectContentSecurityPolicy(),
        visualizer({
            gzipSize: true,
            brotliSize: true,
        }),
    ],
    build: {
        chunkSizeWarningLimit: Infinity,
        target: 'esnext',
    },
});
