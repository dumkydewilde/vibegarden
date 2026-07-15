#!/usr/bin/env bash
# Copy tables from the dumky_share_public share (us-east-1) into the
# vibegarden MotherDuck account (eu-central-1). Shares are region-scoped,
# so the app account keeps a copy instead of attaching the share. Rerun
# whenever the feed should be refreshed; add tables to TABLES as needed.
#
# Usage:
#   MOTHERDUCK_SOURCE_TOKEN=<any us-east-1 account token> \
#   MOTHERDUCK_TOKEN=<vibegarden account token> \
#     scripts/sync-fresh-reads.sh
set -euo pipefail

SHARE_URL="md:_share/dumky_share_public/f1e480aa-1edc-494f-b9bb-e190339fd518"
TABLES=("raw.rss_feed_summaries") # "schema.table" entries within the share

: "${MOTHERDUCK_SOURCE_TOKEN:?set to a token from a us-east-1 account}"
: "${MOTHERDUCK_TOKEN:?set to the vibegarden (app) account token}"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

for t in "${TABLES[@]}"; do
  file="$TMP_DIR/${t//./_}.parquet"
  schema="${t%%.*}"

  motherduck_token="$MOTHERDUCK_SOURCE_TOKEN" duckdb "md:" -c "
    ATTACH IF NOT EXISTS '$SHARE_URL' AS src;
    COPY (FROM src.$t) TO '$file' (FORMAT PARQUET);
    DETACH src;
  "

  motherduck_token="$MOTHERDUCK_TOKEN" duckdb "md:" -c "
    CREATE DATABASE IF NOT EXISTS dumky_share;
    CREATE SCHEMA IF NOT EXISTS dumky_share.$schema;
    CREATE OR REPLACE TABLE dumky_share.$t AS FROM '$file';
    SELECT '$t' AS synced, count(*) AS rows FROM dumky_share.$t;
  "
done
