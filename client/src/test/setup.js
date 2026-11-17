import '@testing-library/jest-dom/vitest';

/**
 * jsdom does not implement matchMedia, which Monaco's standalone services use
 * for high-contrast detection. Without it, `monaco.languages.register()` throws
 * inside a jsdom test while working in the browser/Electron — so the real
 * monaco-editor package can only be exercised in tests with this polyfill.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
