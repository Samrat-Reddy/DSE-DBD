/**
 * Shared test harness.
 *
 * Tests run on Node's built-in test runner (`node --test`) with no extra
 * dependencies. Application modules are loaded through Vite's SSR loader, so
 * they are transformed exactly as in the app (JSX, CSS imports,
 * `import.meta.env`). React rendering uses `react-dom/server`.
 *
 * Effects do not run during server rendering, so data-loading pages render
 * their loading state. Loaded states are tested by rendering components with
 * the data the real service returns.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'

export const FRONTEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

const require = createRequire(path.join(FRONTEND_ROOT, 'package.json'))

// React and the router are external dependencies. Importing them natively
// gives the same module instances the SSR-loaded app code uses.
export const React = require('react')
export const { renderToString } = require('react-dom/server')
const router = await import(pathToFileURL(require.resolve('react-router-dom')).href)
export const { MemoryRouter, Routes, Route, Outlet } = router

export const h = React.createElement

/**
 * Start a Vite SSR server. Each call has its own module cache, so creating a
 * second harness simulates a fresh page load against the same storage.
 */
export const createHarness = async () => {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, 'vite.config.js'),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
  })

  return {
    load: (modulePath) => server.ssrLoadModule(modulePath),
    close: () => server.close(),
  }
}

/**
 * In-memory stand-in for `window.sessionStorage`, so persistence can be
 * tested in Node. Only install it in files that test persistence.
 */
export const installFakeSessionStorage = () => {
  const store = new Map()
  const sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  }
  globalThis.window = { sessionStorage }
  return sessionStorage
}

/**
 * Run a render and fail if React logs any warning or error (duplicate keys,
 * invalid DOM nesting, bad props) — the same messages a browser console shows.
 */
export const renderStrict = (renderFn) => {
  const messages = []
  const originalError = console.error
  const originalWarn = console.warn
  console.error = (...args) => messages.push(args.join(' '))
  console.warn = (...args) => messages.push(args.join(' '))

  try {
    // React inserts <!-- --> between adjacent text nodes as hydration hints.
    // They are not content, so strip them before asserting on text.
    const html = renderFn().replaceAll('<!-- -->', '')
    if (messages.length) {
      throw new Error(`React reported ${messages.length} console message(s):\n${messages.join('\n')}`)
    }
    return html
  } finally {
    console.error = originalError
    console.warn = originalWarn
  }
}

/** Render an element inside a MemoryRouter at `path`. */
export const renderInRouter = (element, pathname = '/') =>
  renderStrict(() =>
    renderToString(h(MemoryRouter, { initialEntries: [pathname] }, element)),
  )

/**
 * Render a page under a layout route that supplies the demo role through the
 * outlet context, as `MainLayout` does.
 */
export const renderPageWithRole = ({ page, role, routePath, pathname }) =>
  renderStrict(() =>
    renderToString(
      h(
        MemoryRouter,
        { initialEntries: [pathname] },
        h(
          Routes,
          null,
          h(
            Route,
            { element: h(Outlet, { context: { role, setRole: () => {} } }) },
            h(Route, { path: routePath, element: h(page, null) }),
          ),
        ),
      ),
    ),
  )

/** Count non-overlapping occurrences of a substring. */
export const countOccurrences = (haystack, needle) => haystack.split(needle).length - 1
