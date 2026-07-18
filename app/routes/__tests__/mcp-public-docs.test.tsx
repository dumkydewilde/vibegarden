import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Connect from "../connect";
import Privacy from "../privacy.mcp";

describe("MCP public documentation", () => {
  it("publishes connection setup without a session", () => {
    const page = renderToStaticMarkup(<Connect />);
    expect(page).toContain("https://vibegarden.dumky.net/mcp");
    expect(page).toContain("Claude");
    expect(page).toContain("ChatGPT");
    expect(page).toContain("projects:read");
    expect(page).toContain("content:read");
    expect(page).toContain("/settings/connections");
  });

  it("publishes data-use and revocation disclosures", () => {
    const page = renderToStaticMarkup(<Privacy />);
    expect(page).toContain("projects and conversations");
    expect(page).toContain("tool name, outcome, latency");
    expect(page).toContain("does not receive your surrounding Claude or ChatGPT conversation");
    expect(page).toContain("Revoke access");
    expect(page).toContain("Cloudflare");
    expect(page).toContain("MotherDuck");
  });
});
