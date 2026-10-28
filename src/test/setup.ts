import "@testing-library/jest-dom/vitest";
import { createMockIndexedDB, harnessControls } from "./indexeddb-test-harness";

const mockIdb = createMockIndexedDB();
Object.defineProperty(window, "indexedDB", {
  writable: true,
  value: mockIdb,
});
Object.defineProperty(globalThis, "indexedDB", {
  writable: true,
  value: mockIdb,
});

beforeEach(() => {
  harnessControls.resetAll();
});

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
