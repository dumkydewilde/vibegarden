import { describe, expect, it, vi } from "vitest";
import routes from "../../routes";
import * as home from "../home";
import { action as threadAction } from "../api.thread";
import { loader as legacyLoader } from "../legacy.$section.$";
import { listUserClubs } from "~/lib/clubs.server";
import { requireUser } from "~/lib/auth.server";

vi.mock("~/lib/auth.server", () => ({ requireUser: vi.fn() }));
vi.mock("~/lib/clubs.server", () => ({
  listUserClubs: vi.fn(),
  requireClubContext: vi.fn(),
}));

const mockedRequireUser = vi.mocked(requireUser);
const mockedListUserClubs = vi.mocked(listUserClubs);

function loaderArgs() {
  return {
    request: new Request("https://example.com/"),
    context: { get: () => ({ env: {} as Env }) },
    params: {},
  } as never;
}

async function redirectFrom(loader: (args: never) => Promise<unknown>) {
  try {
    await loader(loaderArgs());
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
  throw new Error("Expected loader to redirect");
}

describe("canonical club routing", () => {
  it("places every workspace page and resource route below a club slug", () => {
    const tree = JSON.stringify(routes);

    expect(tree).toContain("clubs/:clubSlug");
    expect(tree).toContain("clubs/:clubSlug/welcome");
    expect(tree).toContain("clubs/:clubSlug/api/chat");
    expect(tree).toContain("clubs/:clubSlug/api/thread");
    expect(tree).toContain("clubs/:clubSlug/api/feedback");
    for (const path of [
      "garden",
      "garden/conversations/:id",
      "garden/projects/:id",
      "garden/modules/:slug",
      "learning",
      "learning/:slug",
      "artifacts",
      "gallery",
      "inspiration",
      "admin",
      "admin/conversations/:id",
    ]) {
      expect(tree).toContain(path);
    }
  });

  it("sends the user to their last accessible club", async () => {
    mockedRequireUser.mockResolvedValue({ lastClubId: "club-second" } as never);
    mockedListUserClubs.mockResolvedValue([
      { club: { id: "club-first", slug: "first", status: "active" } },
      { club: { id: "club-second", slug: "second", status: "active" } },
    ] as never);
    const loader = (home as { loader?: (args: never) => Promise<unknown> }).loader;

    expect(loader).toBeTypeOf("function");
    const response = await redirectFrom(loader!);
    expect(response.headers.get("location")).toBe("/clubs/second");
  });

  it("falls back to an accessible club when the saved club is stale", async () => {
    mockedRequireUser.mockResolvedValue({ lastClubId: "club-gone" } as never);
    mockedListUserClubs.mockResolvedValue([
      { club: { id: "club-first", slug: "first", status: "active" } },
      { club: { id: "club-second", slug: "second", status: "active" } },
    ] as never);
    const loader = (home as { loader?: (args: never) => Promise<unknown> }).loader;

    expect(loader).toBeTypeOf("function");
    const response = await redirectFrom(loader!);
    expect(response.headers.get("location")).toBe("/clubs/first");
  });

  it("does not send the user to an archived saved club", async () => {
    mockedRequireUser.mockResolvedValue({ lastClubId: "club-archived" } as never);
    mockedListUserClubs.mockResolvedValue([
      { club: { id: "club-first", slug: "first", status: "active" } },
      { club: { id: "club-archived", slug: "archived", status: "archived" } },
    ] as never);
    const loader = (home as { loader?: (args: never) => Promise<unknown> }).loader;

    expect(loader).toBeTypeOf("function");
    const response = await redirectFrom(loader!);
    expect(response.headers.get("location")).toBe("/clubs/first");
  });

  it("returns a structured 401 instead of a login redirect from club APIs", async () => {
    mockedRequireUser.mockRejectedValue(
      new Response(null, { status: 302, headers: { Location: "/login" } }),
    );

    const response = await threadAction({
      request: new Request("https://example.com/clubs/private/api/thread", {
        method: "POST",
      }),
      context: { get: () => ({ env: {} as Env }) },
      params: { clubSlug: "private" },
    } as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Authentication required." },
    });
  });

  it("redirects only supported legacy workspace paths to WOTF", async () => {
    let response: Response | undefined;
    try {
      await legacyLoader({
        request: new Request("https://example.com/garden/projects/p-1?view=all#notes"),
        context: { get: () => ({ env: {} as Env }) },
        params: { section: "garden", "*": "projects/p-1" },
      } as never);
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      response = error as Response;
    }

    expect(response?.headers.get("location")).toBe(
      "/clubs/wotf/garden/projects/p-1?view=all#notes",
    );
  });
});
