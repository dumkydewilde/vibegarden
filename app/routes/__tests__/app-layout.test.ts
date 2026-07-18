import { describe, expect, it, vi } from "vitest";
import { loader } from "../app-layout";
import {
  listActiveClubs,
  listUserClubs,
  requireClubContext,
} from "~/lib/clubs.server";
import { requireUser } from "~/lib/auth.server";
import { activeThread, parseContext } from "~/lib/threads.server";

vi.mock("~/lib/auth.server", () => ({ requireUser: vi.fn() }));
vi.mock("~/lib/clubs.server", () => ({
  listActiveClubs: vi.fn(),
  listUserClubs: vi.fn(),
  requireClubContext: vi.fn(),
}));
vi.mock("~/lib/threads.server", () => ({
  activeThread: vi.fn(),
  parseContext: vi.fn(),
}));

describe("app layout club data", () => {
  it("lists every active club for a super admin while preserving explicit roles", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      id: "user-1",
      platformRole: "super_admin",
    } as never);
    vi.mocked(requireClubContext).mockResolvedValue({
      club: { id: "club-current", name: "Current", slug: "current", modelPolicy: "all_models" },
      membership: { userId: "user-1", role: "owner", onboardingStage: "exploring" },
      effectiveRole: "owner",
      isSuperAdmin: true,
    } as never);
    vi.mocked(listUserClubs).mockResolvedValue([
      {
        club: { id: "club-current", name: "Current", slug: "current", status: "active" },
        membership: { userId: "user-1", role: "owner" },
      },
    ] as never);
    vi.mocked(listActiveClubs).mockResolvedValue([
      { id: "club-current", name: "Current", slug: "current", status: "active" },
      { id: "club-other", name: "Other", slug: "other", status: "active" },
    ] as never);
    vi.mocked(activeThread).mockResolvedValue({ threadId: null, messages: [] } as never);
    vi.mocked(parseContext).mockReturnValue([]);

    const run = vi.fn().mockResolvedValue({});
    const data = await loader({
      request: new Request("https://example.com/clubs/current"),
      context: {
        get: () => ({ env: { DB: { prepare: () => ({ bind: () => ({ run }) }) } } as unknown as Env }),
      },
      params: { clubSlug: "current" },
    } as never);

    expect(data.clubs).toEqual([
      { name: "Current", slug: "current", role: "owner" },
      { name: "Other", slug: "other", role: "admin" },
    ]);
    expect(vi.mocked(listActiveClubs)).toHaveBeenCalledOnce();
  });
});
