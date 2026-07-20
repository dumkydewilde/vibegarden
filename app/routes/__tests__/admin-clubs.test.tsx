import { act, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminClubs, { action, loader } from "../admin.clubs";
import { requireSuperAdmin } from "~/lib/auth.server";
import {
  listPlatformClubs,
  setClubModelPolicy,
  setClubSpendingLimit,
} from "~/lib/clubs.server";
import { recordAuditEvent, restoreClub } from "~/lib/memberships.server";
import {
  rotateClubCredential,
  setClubCredentialDisabled,
  syncClubPolicy,
} from "~/lib/club-ai.server";

vi.mock("~/lib/auth.server", () => ({ requireSuperAdmin: vi.fn() }));
vi.mock("~/lib/clubs.server", () => ({
  listPlatformClubs: vi.fn(),
  setClubModelPolicy: vi.fn(),
  setClubSpendingLimit: vi.fn(),
}));
vi.mock("~/lib/memberships.server", () => ({
  recordAuditEvent: vi.fn(),
  restoreClub: vi.fn(),
}));
vi.mock("~/lib/club-ai.server", () => ({
  rotateClubCredential: vi.fn(),
  setClubCredentialDisabled: vi.fn(),
  syncClubPolicy: vi.fn(),
}));

const admin = { id: "super-admin", platformRole: "super_admin" };
const clubs = [
  {
    id: "active-club",
    name: "Active Club",
    slug: "active-club",
    status: "active",
    owner: { id: "owner", name: "Ada", email: "ada@example.com" },
    memberCount: 3,
    modelPolicy: "all_models",
    spendingLimitUsd: 50,
    credentialState: "ready",
    syncedPolicy: "free_only",
    hasSyncDrift: true,
  },
  {
    id: "archived-club",
    name: "Archived Club",
    slug: "archived-club",
    status: "archived",
    owner: null,
    memberCount: 1,
    modelPolicy: "free_only",
    spendingLimitUsd: null,
    credentialState: "disabled",
    syncedPolicy: null,
    hasSyncDrift: false,
  },
];

afterEach(() => {
  vi.useRealTimers();
});

function actionArgs(intent: string, values: Record<string, string> = {}) {
  const form = new FormData();
  form.set("intent", intent);
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  const waitUntil = vi.fn();
  return {
    args: {
      request: new Request("https://example.com/admin/clubs", { method: "POST", body: form }),
      context: {
        get: () => ({
          env: {
            DB: {
              prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) })) })),
              batch: vi.fn().mockResolvedValue([]),
            },
          } as unknown as Env,
          ctx: { waitUntil },
        }),
      },
      params: {},
    } as never,
    waitUntil,
  };
}

describe("platform clubs dashboard", () => {
  it("returns 404 for a normal user before listing clubs", async () => {
    vi.mocked(requireSuperAdmin).mockRejectedValue(new Response("Not found", { status: 404 }));
    await expect(loader({
      request: new Request("https://example.com/admin/clubs"),
      context: { get: () => ({ env: {} as Env }) },
    } as never)).rejects.toMatchObject({ status: 404 });
    expect(listPlatformClubs).not.toHaveBeenCalled();
  });

  it("shows full club summaries and only allows opening active clubs", async () => {
    const Stub = createRoutesStub([{ path: "/admin/clubs", Component: AdminClubs, loader: () => ({ clubs }) }]);
    render(<Stub initialEntries={["/admin/clubs"]} />);

    expect(await screen.findByText("Platform clubs")).toBeInTheDocument();
    expect(screen.getByText(/Ada/)).toBeInTheDocument();
    expect(screen.getByText(/3 members/)).toBeInTheDocument();
    expect(screen.getByText(/drift: free only/)).toBeInTheDocument();
    expect(screen.getByText(/\$50 cap/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open club" })).toHaveAttribute("href", "/clubs/active-club");
    expect(screen.queryByRole("link", { name: "Open Archived Club" })).not.toBeInTheDocument();
  });

  it("revalidates a pending credential after two seconds", async () => {
    vi.useFakeTimers();
    const loader = vi.fn(() => ({
      clubs: [{ ...clubs[0], credentialState: "pending", syncedPolicy: null, hasSyncDrift: true }],
    }));
    const Stub = createRoutesStub([{ path: "/admin/clubs", Component: AdminClubs, loader }]);
    render(<Stub initialEntries={["/admin/clubs"]} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("pending")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["policy", { clubId: "active-club", policy: "all_models" }, setClubModelPolicy],
    ["spending", { clubId: "active-club", spendingLimitUsd: "75" }, setClubSpendingLimit],
    ["retry", { clubId: "active-club" }, recordAuditEvent],
    ["rotate", { clubId: "active-club" }, recordAuditEvent],
    ["disable", { clubId: "active-club" }, recordAuditEvent],
    ["restore", { clubId: "archived-club" }, restoreClub],
  ] as const)("authorizes and audits the %s platform action", async (intent, values, expected) => {
    vi.mocked(requireSuperAdmin).mockResolvedValue(admin as never);
    vi.mocked(setClubModelPolicy).mockResolvedValue(undefined);
    vi.mocked(setClubSpendingLimit).mockResolvedValue(undefined);
    vi.mocked(recordAuditEvent).mockReturnValue({} as never);
    vi.mocked(restoreClub).mockResolvedValue(undefined);
    vi.mocked(setClubCredentialDisabled).mockResolvedValue(undefined);
    vi.mocked(syncClubPolicy).mockResolvedValue(undefined);
    vi.mocked(rotateClubCredential).mockResolvedValue(undefined);
    const { args, waitUntil } = actionArgs(intent, values);

    await expect(action(args)).resolves.toEqual({ ok: true, intent });
    expect(expected).toHaveBeenCalled();
    if (["retry", "rotate", "disable"].includes(intent)) expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorUserId: admin.id, clubId: values.clubId, action: expect.any(String) }),
    );
    if (["policy", "spending", "retry", "rotate", "disable", "restore"].includes(intent)) {
      expect(waitUntil).toHaveBeenCalled();
    }
  });
});
