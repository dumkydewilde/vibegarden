import type { ClubRole } from "~/db/schema";
import type { ClubContext } from "~/lib/clubs.server";

export type ClubPermission =
  | "use_club"
  | "moderate"
  | "manage_member"
  | "manage_admin"
  | "manage_invites"
  | "manage_identity"
  | "transfer_ownership"
  | "archive";

const permissionsByRole: Record<ClubRole, readonly ClubPermission[]> = {
  member: ["use_club"],
  admin: ["use_club", "moderate", "manage_member", "manage_invites"],
  owner: [
    "use_club",
    "moderate",
    "manage_member",
    "manage_admin",
    "manage_invites",
    "manage_identity",
    "transfer_ownership",
    "archive",
  ],
};

export function requireClubPermission(
  context: ClubContext,
  permission: ClubPermission,
) {
  if (!permissionsByRole[context.effectiveRole].includes(permission)) {
    throw new Response("Not found", { status: 404 });
  }
}
