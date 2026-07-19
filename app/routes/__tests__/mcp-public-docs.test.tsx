import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Connect from "../connect";
import Privacy from "../privacy.mcp";

describe("MCP public documentation", () => {
  it("publishes connection setup without a session", () => {
    const page = renderToStaticMarkup(<Connect />);
    expect(page).toContain("https://vibegarden.club/mcp");
    expect(page).toContain("Claude");
    expect(page).toContain("ChatGPT");
    expect(page).toContain("projects:read");
    expect(page).toContain("content:read");
    expect(page).toContain("/settings/connections");
  });

  it("publishes data-use and revocation disclosures", () => {
    const page = renderToStaticMarkup(<Privacy />);
    expect(page).toContain("id, title, one_liner, status, building_blocks, updated_at, and url");
    expect(page).toContain("conversation id, title, updated_at, message_count, url, message role, content, user-authored context label and source, and created_at");
    expect(page).toContain("Articles return kind, slug, title, description, category, level, url, and body");
    expect(page).toContain("Modules return kind, slug, title, description, category, url, and body");
    expect(page).toContain("Fresh reads return title, summary, content_type, source_url, and optional key_insight");
    expect(page).toContain("tool name, outcome, latency");
    expect(page).toContain("does not receive your surrounding Claude or ChatGPT conversation");
    expect(page).toContain("Revoke access");
    expect(page).toContain("Cloudflare");
    expect(page).toContain("MotherDuck");
  });
});
