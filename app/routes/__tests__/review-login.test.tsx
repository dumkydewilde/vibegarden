import { describe, expect, it, vi } from "vitest";

const createSessionCookie = vi.hoisted(() => vi.fn());
const upsertUser = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth.server", () => ({ createSessionCookie }));
vi.mock("~/lib/otp.server", () => ({ normalizeEmail: (email: string) => email.trim().toLowerCase(), upsertUser }));

import { action, loader } from "../review.login";

function args(request: Request, env: Env) {
  return { request, context: { get: () => ({ env, ctx: {} }) } } as never;
}

describe("MCP reviewer login", () => {
  const env = {
    MCP_REVIEW_EMAIL: "review@example.test",
    MCP_REVIEW_PASSWORD: "correct",
    MCP_GENERAL_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  } as unknown as Env;

  it("renders a form on GET without authenticating", async () => {
    expect(await loader(args(new Request("https://garden.test/review/login"), env))).toEqual({});
    expect(upsertUser).not.toHaveBeenCalled();
  });

  it("uses POST credentials only and creates a normal user session", async () => {
    upsertUser.mockResolvedValue({ id: "reviewer-id", role: "user" });
    createSessionCookie.mockResolvedValue("vg_session=signed");
    const form = new FormData();
    form.set("email", "Review@Example.Test");
    form.set("password", "correct");

    const response = await action(args(new Request("https://garden.test/review/login", {
      method: "POST",
      body: form,
    }), env));

    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("Location")).not.toContain("correct");
    expect(response.headers.get("Set-Cookie")).toBe("vg_session=signed");
    expect(upsertUser).toHaveBeenCalledWith(env, "review@example.test", "user");
  });

  it("gives missing configuration and wrong credentials the same error", async () => {
    const wrong = new FormData();
    wrong.set("email", "wrong@example.test");
    wrong.set("password", "wrong");
    const configured = await action(args(new Request("https://garden.test/review/login", {
      method: "POST", body: wrong,
    }), env));
    const missing = await action(args(new Request("https://garden.test/review/login", {
      method: "POST", body: wrong,
    }), {} as Env));

    expect(configured).toEqual({ error: "Invalid reviewer credentials" });
    expect(missing).toEqual({ error: "Invalid reviewer credentials" });
  });
});
