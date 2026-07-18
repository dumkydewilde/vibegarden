import { describe, expect, it } from "vitest";
import type { ClubContext } from "~/lib/clubs.server";
import {
  requireClubPermission,
  type ClubPermission,
} from "~/lib/club-permissions";

function context(role: ClubContext["effectiveRole"]): ClubContext {
  return {
    club: {} as ClubContext["club"],
    membership: null,
    effectiveRole: role,
    isSuperAdmin: false,
  };
}

function expectAllowed(
  role: ClubContext["effectiveRole"],
  permission: ClubPermission,
) {
  expect(() => requireClubPermission(context(role), permission)).not.toThrow();
}

function expectDenied(
  role: ClubContext["effectiveRole"],
  permission: ClubPermission,
) {
  try {
    requireClubPermission(context(role), permission);
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(404);
    return;
  }
  throw new Error(`${role} should not have ${permission}`);
}

describe("requireClubPermission", () => {
  it("allows members to use their club only", () => {
    expectAllowed("member", "use_club");
    expectDenied("member", "moderate");
  });

  it("allows admins to moderate, manage members, and manage invitations", () => {
    for (const permission of [
      "use_club",
      "moderate",
      "manage_member",
      "manage_invites",
    ] as const) {
      expectAllowed("admin", permission);
    }
    for (const permission of [
      "manage_admin",
      "manage_identity",
      "transfer_ownership",
      "archive",
    ] as const) {
      expectDenied("admin", permission);
    }
  });

  it("allows owners every club permission", () => {
    const permissions: ClubPermission[] = [
      "use_club",
      "moderate",
      "manage_member",
      "manage_admin",
      "manage_invites",
      "manage_identity",
      "transfer_ownership",
      "archive",
    ];
    for (const permission of permissions) {
      expectAllowed("owner", permission);
    }
  });
});
