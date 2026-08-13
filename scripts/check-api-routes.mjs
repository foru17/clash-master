#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const FRONTEND_API_FILE = path.join(ROOT, 'apps/web/lib/api.ts');
const BACKEND_SOURCES = [
  { file: 'apps/collector/src/modules/app/app.ts', prefix: '' },
  { file: 'apps/collector/src/modules/stats/stats.controller.ts', prefix: '/api/stats' },
  { file: 'apps/collector/src/modules/backend/backend.controller.ts', prefix: '/api/backends' },
  { file: 'apps/collector/src/modules/config/config.controller.ts', prefix: '/api/db' },
  { file: 'apps/collector/src/modules/auth/auth.controller.ts', prefix: '/api/auth' },
  { file: 'apps/collector/src/modules/vendor/vendor.controller.ts', prefix: '/api/vendors' },
  { file: 'apps/collector/src/modules/monitor/monitor.controller.ts', prefix: '/api/monitors' },
];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function normalizeRoute(route) {
  return route
    .replace(/\?.*$/, '')
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/\/:[^/]+/g, '/:param')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function extractFrontendRoutes(code) {
  const routes = new Set();
  const routePattern = /\$\{API_BASE\}\/([^`]+)/g;

  for (const match of code.matchAll(routePattern)) {
    const raw = `/api/${match[1]}`;
    routes.add(normalizeRoute(raw));
  }

  return routes;
}

function extractBackendRoutes(code, prefix) {
  const routes = new Set();
  const routePattern = /(?:app|fastify)\.(?:get|post|put|delete)(?:<[^>\n\r]*>)?\(\s*['"]([^'"]+)['"]/g;

  for (const match of code.matchAll(routePattern)) {
    const raw = `${prefix}${match[1]}`;
    const normalized = normalizeRoute(raw);
    if (normalized.startsWith('/api/')) {
      routes.add(normalized);
    }
  }

  return routes;
}

function main() {
  const frontendCode = fs.readFileSync(FRONTEND_API_FILE, 'utf8');
  const frontendRoutes = extractFrontendRoutes(frontendCode);

  const backendRoutes = new Set();
  for (const source of BACKEND_SOURCES) {
    const code = read(source.file);
    const routes = extractBackendRoutes(code, source.prefix);
    for (const route of routes) {
      backendRoutes.add(route);
    }
  }

  const missing = [...frontendRoutes].filter((route) => !backendRoutes.has(route)).sort();
  const extra = [...backendRoutes].filter((route) => !frontendRoutes.has(route)).sort();

  console.log(`[api-routes] frontend routes: ${frontendRoutes.size}`);
  console.log(`[api-routes] backend routes: ${backendRoutes.size}`);

  if (missing.length > 0) {
    console.error(`[api-routes] missing backend routes: ${missing.length}`);
    for (const route of missing) {
      console.error(`  - ${route}`);
    }
    process.exit(1);
  }

  console.log('[api-routes] missing backend routes: 0');
  console.log(`[api-routes] backend-only routes: ${extra.length}`);
}

main();
