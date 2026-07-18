import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, test } from "vitest";
import {
  chatThreads,
  clubInvitations,
  comments,
  projects,
  questionnaireResponses,
  siteFeedback,
} from "~/db/schema";

const expandedLegacyClubTables = [
  ["projects", projects],
  ["chat_threads", chatThreads],
  ["questionnaire_responses", questionnaireResponses],
  ["comments", comments],
  ["site_feedback", siteFeedback],
  ["club_invitations", clubInvitations],
] as const;

describe("multi-club migration contract", () => {
  test.each(expandedLegacyClubTables)(
    "%s declares a club_id index in Drizzle metadata",
    (_name, table) => {
      const indexNames = getTableConfig(table).indexes.map(
        (index) => index.config.name,
      );
      expect(indexNames).toContain(`${getTableConfig(table).name}_club_id_idx`);
    },
  );

  test("keeps the WOTF SQL synchronized with Wrangler ADMIN_EMAIL", async () => {
    const [
      wranglerConfig,
      backfillSql,
      expandVerificationSql,
      contractVerificationSql,
    ] = await Promise.all([
      readFile("wrangler.jsonc", "utf8"),
      readFile("scripts/backfill-wotf.sql", "utf8"),
      readFile("scripts/verify-multi-club-migration.sql", "utf8"),
      readFile("scripts/verify-multi-club-contract.sql", "utf8"),
    ]);
    const adminEmail = wranglerConfig.match(
      /"ADMIN_EMAIL"\s*:\s*"([^\"]+)"/,
    )?.[1];

    expect(adminEmail).toBeDefined();
    expect(backfillSql).toContain(`lower(email) = '${adminEmail}'`);
    for (const verificationSql of [
      expandVerificationSql,
      contractVerificationSql,
    ]) {
      expect(verificationSql).toContain(`lower(users.email) = '${adminEmail}'`);
      expect(verificationSql).toContain(
        "violation:bootstrap_admin_not_wotf_sole_owner",
      );
    }
  });
});
