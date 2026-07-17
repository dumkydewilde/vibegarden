import { describe, expect, it, vi } from "vitest";
import { createSessionCookie } from "~/lib/auth.server";
import { upsertUser } from "~/lib/otp.server";

vi.mock("~/lib/auth.server", () => ({
  createSessionCookie: vi.fn(),
}));

vi.mock("~/lib/otp.server", () => ({
  upsertUser: vi.fn(),
}));

import { loader } from "../dev.login";

const mockedCreateSessionCookie = vi.mocked(createSessionCookie);
const mockedUpsertUser = vi.mocked(upsertUser);

const env = {
  ADMIN_EMAIL: "admin@example.com",
  DEV_LOGIN_TOKEN: "test-dev-token",
} as Env;

function args(url: string, routeEnv: Env = env) {
  return {
    request: new Request(url),
    context: { get: () => ({ env: routeEnv }) },
  } as Parameters<typeof loader>[0];
}

async function responseFrom(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
  throw new Error("Expected loader to throw a response");
}

describe("dev login", () => {
  it("fails closed when DEV_LOGIN_TOKEN is not configured", async () => {
    await expect(
      loader(args("https://example.com/dev/login?token=test-dev-token", {} as Env)),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects an invalid token", async () => {
    await expect(
      loader(args("https://example.com/dev/login?token=wrong-token")),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("creates a normal admin session and removes credentials from the URL", async () => {
    mockedUpsertUser.mockResolvedValue({
      id: "admin-id",
      email: "admin@example.com",
      name: null,
      role: "admin",
      stage: "invited",
      modelPref: null,
      createdAt: 0,
    });
    mockedCreateSessionCookie.mockResolvedValue("vg_session=signed-session");

    const response = await responseFrom(
      loader(
        args(
          "https://example.com/dev/login?token=test-dev-token&next=%2Fgarden%3Fview%3Dall",
        ),
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/garden?view=all");
    expect(response.headers.get("set-cookie")).toBe("vg_session=signed-session");
    expect(mockedUpsertUser).toHaveBeenCalledWith(env, "admin@example.com");
  });

  it("does not redirect to another origin", async () => {
    mockedUpsertUser.mockResolvedValue({
      id: "admin-id",
      email: "admin@example.com",
      name: null,
      role: "admin",
      stage: "invited",
      modelPref: null,
      createdAt: 0,
    });
    mockedCreateSessionCookie.mockResolvedValue("vg_session=signed-session");

    const response = await responseFrom(
      loader(
        args(
          "https://example.com/dev/login?token=test-dev-token&next=%2F%2Fevil.example",
        ),
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });
});
