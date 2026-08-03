import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Unmounted between tests. Testing Library renders into a shared document, so
// without this a query for "Duyệt" finds the button left behind by the
// previous test and the assertion passes for the wrong reason.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// jsdom has no layout, so it implements nothing that scrolls. Stubbed here
// rather than guarded in the component: the call is right in every real
// browser, and an `?.()` in shipped code to satisfy a test environment is
// scaffolding left where users run.
Element.prototype.scrollIntoView = vi.fn();
