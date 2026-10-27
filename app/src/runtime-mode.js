// A plain browser in the Vite development server is the fixture. A native
// WebView and every production build retain the real Tauri boundary.
export function isBrowserFixture(development, hasNativeBridge) {
  return development === true && !hasNativeBridge;
}
