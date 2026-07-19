import { describe, expect, it, vi } from "vitest";
import { assertWebsiteWriteOrigin } from "~/lib/request-security.server";

const routeHandler = vi.hoisted(() => vi.fn());

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    createRequestHandler: vi.fn(() => routeHandler),
  };
});

vi.mock("virtual:react-router/server-build", () => ({}));

const { handleReactRouterRequest } = await import("../../../workers/react-router");

const env = {
  WEB_ALLOWED_ORIGINS: "https://vibegarden.club, http://localhost:5173",
} as Env;

function request(method: string, origin?: string | null) {
  const headers = new Headers();
  if (origin !== undefined) headers.set("Origin", origin ?? "null");
  return new Request("https://vibegarden.club/api/chat", { method, headers });
}

describe("assertWebsiteWriteOrigin", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "allows %s from every explicitly configured website origin",
    (method) => {
      expect(() => assertWebsiteWriteOrigin(request(method, "https://vibegarden.club"), env)).not.toThrow();
      expect(() => assertWebsiteWriteOrigin(request(method, "http://localhost:5173"), env)).not.toThrow();
    },
  );

  it.each([undefined, null, "https://usercontent.vibegarden.club", "https://evil.example"])(
    "rejects unsafe writes with origin %s",
    (origin) => {
      try {
        assertWebsiteWriteOrigin(request("POST", origin), env);
        throw new Error("Expected a forbidden response");
      } catch (error) {
        expect(error).toBeInstanceOf(Response);
        expect((error as Response).status).toBe(403);
      }
    },
  );

  it.each(["GET", "HEAD", "OPTIONS"])(
    "leaves %s requests unchanged without an Origin header",
    (method) => {
      expect(() => assertWebsiteWriteOrigin(request(method), env)).not.toThrow();
    },
  );

  it("matches origins exactly rather than accepting a prefix or wildcard", () => {
    expect(() => assertWebsiteWriteOrigin(request("POST", "https://vibegarden.club.evil.example"), env)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });

  it("does not treat a wildcard configuration entry as a trusted origin", () => {
    expect(() => assertWebsiteWriteOrigin(request("POST", "*"), {
      WEB_ALLOWED_ORIGINS: "*",
    } as Env)).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe("handleReactRouterRequest", () => {
  it.each([undefined, null, "https://usercontent.vibegarden.club", "https://evil.example"])(
    "returns 403 before invoking the route handler for unsafe origin %s",
    async (origin) => {
      routeHandler.mockReset();

      const response = await handleReactRouterRequest(request("POST", origin), env, {} as ExecutionContext);

      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Forbidden");
      expect(routeHandler).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "HEAD", "OPTIONS"])("dispatches safe %s requests normally", async (method) => {
    routeHandler.mockReset();
    routeHandler.mockResolvedValue(new Response("route response"));

    const response = await handleReactRouterRequest(request(method), env, {} as ExecutionContext);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("route response");
    expect(routeHandler).toHaveBeenCalledOnce();
  });

  it("dispatches unsafe writes from an allowed origin normally", async () => {
    routeHandler.mockReset();
    routeHandler.mockResolvedValue(new Response("route response"));

    const response = await handleReactRouterRequest(
      request("POST", "https://vibegarden.club"),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("route response");
    expect(routeHandler).toHaveBeenCalledOnce();
  });
});
