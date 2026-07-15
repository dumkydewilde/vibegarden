import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Globals are off, so RTL's auto-cleanup never registers. Unmount between
// tests so rendered DOM does not accumulate across a file.
afterEach(cleanup);
