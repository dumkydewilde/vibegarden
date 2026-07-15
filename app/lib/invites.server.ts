import { isValidEmail, normalizeEmail } from "./otp.server";

export type RejectedInvite = {
  value: string;
  reason: "Invalid email address";
};

export type BulkInviteParseResult = {
  accepted: string[];
  duplicates: string[];
  rejected: RejectedInvite[];
};

function unquote(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

export function parseBulkInviteInput(
  sources: string[],
): BulkInviteParseResult {
  const accepted: string[] = [];
  const duplicates: string[] = [];
  const rejected: RejectedInvite[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const rawValue of source.split(/[\r\n,;]+/)) {
      const value = unquote(rawValue);
      if (!value || value.toLowerCase() === "email") continue;

      const email = normalizeEmail(value);
      if (seen.has(email)) {
        duplicates.push(email);
        continue;
      }
      seen.add(email);

      if (!isValidEmail(email)) {
        rejected.push({ value, reason: "Invalid email address" });
        continue;
      }
      accepted.push(email);
    }
  }

  return { accepted, duplicates, rejected };
}

const UPSERT_INVITE_SQL = `
  INSERT INTO invites (email, invited_by, status, created_at)
  VALUES (?, ?, 'pending', ?)
  ON CONFLICT(email) DO UPDATE SET
    invited_by = CASE
      WHEN invites.status = 'joined' THEN invites.invited_by
      ELSE excluded.invited_by
    END,
    status = CASE
      WHEN invites.status = 'joined' THEN 'joined'
      ELSE 'pending'
    END
`;

export async function saveBulkInvites(
  db: D1Database,
  emails: string[],
  invitedBy: string,
  now = Date.now(),
) {
  if (emails.length === 0) return;

  const statements = emails.map((email) =>
    db.prepare(UPSERT_INVITE_SQL).bind(email, invitedBy, now),
  );
  await db.batch(statements);
}

export type BulkInviteImportResult = BulkInviteParseResult & {
  imported: number;
};

export async function importBulkInvites(
  db: D1Database,
  form: FormData,
  invitedBy: string,
  now = Date.now(),
): Promise<BulkInviteImportResult> {
  const sources = [String(form.get("emails") ?? "")];
  const file = form.get("inviteFile");
  if (file && typeof file !== "string" && file.size > 0) {
    sources.push(await file.text());
  }

  const parsed = parseBulkInviteInput(sources);
  await saveBulkInvites(db, parsed.accepted, invitedBy, now);
  return { ...parsed, imported: parsed.accepted.length };
}
