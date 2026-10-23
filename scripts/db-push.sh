#!/usr/bin/env bash
# Apply repo migrations (supabase/migrations/*.sql) to a live Hudo Supabase project.
#
# Why this wrapper exists:
#   - MCP `apply_migration` records TIMESTAMP versions in schema_migrations, while the
#     repo uses 0001...00NN, so tracking drifted. `supabase db push` records the repo
#     versions, so it is the standard way to apply migrations.
#   - The direct DB host (db.<ref>.supabase.co) is IPv6-only; most networks need the
#     IPv4 session pooler, so we rewrite the URL to aws-1-eu-west-2.pooler.supabase.com
#     (override with POOLER_HOST; `aws-0-...` returns "tenant not found").
#   - Passwords may contain any character (@ # ? & $ * + / : %), so the pooler URL is
#     built by node with every byte outside [A-Za-z0-9._~-] percent-encoded.
#   - Hard guard: each env may only target its own project ref, so hudo-prod
#     (ljesrugaovuoyqhitlsj) can never be pushed to from here.
#
# Usage (run from the repo root; sh or bash both work, it re-execs under bash):
#   sh scripts/db-push.sh <local|staging> [--list] [extra supabase db push args...]
#   sh scripts/db-push.sh staging --dry-run
#   sh scripts/db-push.sh local --list      # supabase migration list
#
#   local   -> ./.env.local    must be hudo-dev     (xyeqnjboqimvhdwnyqbt)
#   staging -> ./.env.staging  must be hudo-staging (egabjtxrrcuzooyclwgw)
#
# Reads the first SUPABASE_DB_URL= line of the env file. The script never prints the
# URL or password itself; supabase's output is passed through a best-effort mask
# (`://…@` userinfo), which won't catch a bare password the CLI might echo elsewhere.
# The URL does sit on supabase's argv (the CLI only takes --db-url) for the run.
# Exit: supabase's own exit code; 2 = usage error; 1 = refused / bad env file.

if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

usage() {
  echo "usage: db-push.sh <local|staging> [--list] [extra supabase db push args...]" >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
target="$1"
shift

case "$target" in
  local)
    env_file=".env.local"
    allowed_ref="xyeqnjboqimvhdwnyqbt"
    ;;
  staging)
    env_file=".env.staging"
    allowed_ref="egabjtxrrcuzooyclwgw"
    ;;
  *)
    echo "db-push: unknown target '$target' (allowed: local, staging; prod is never allowed)" >&2
    usage
    ;;
esac

if [ ! -f "$env_file" ]; then
  echo "db-push: $env_file not found (run from the repo root)" >&2
  exit 1
fi

raw=$(grep -m1 '^SUPABASE_DB_URL=' "$env_file" | cut -d= -f2- || true)
if [ -z "$raw" ]; then
  echo "db-push: SUPABASE_DB_URL is missing from $env_file" >&2
  exit 1
fi

# Parse + guard + encode in node. The raw URL travels via the environment, not argv.
URL=$(
  DB_URL_RAW="$raw" ALLOWED_REF="$allowed_ref" TARGET="$target" \
    POOLER_HOST="${POOLER_HOST:-aws-1-eu-west-2.pooler.supabase.com}" \
    node -e '
const fail = (m) => { process.stderr.write("db-push: " + m + "\n"); process.exit(1) }
let v = (process.env.DB_URL_RAW || "").replace(/[\r\n]+$/, "").trim()
if (v.length >= 2 && v.startsWith("\"") && v.endsWith("\"")) v = v.slice(1, -1)
const m = /^postgres(?:ql)?:\/\/([^:@\/]+):(.*)@db\.([a-z0-9]+)\.supabase\.co:5432\/([^?#\s]+)$/.exec(v)
if (!m) fail("SUPABASE_DB_URL has an unexpected shape (expected postgresql://<user>:<password>@db.<ref>.supabase.co:5432/<db>)")
const [, user, password, ref, db] = m
if (!/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(process.env.POOLER_HOST || "")) fail("POOLER_HOST must be a *.pooler.supabase.com host")
if (ref !== process.env.ALLOWED_REF) {
  fail("refusing: " + process.env.TARGET + " may only target project " + process.env.ALLOWED_REF + ", but the env file points at " + ref + (ref === "ljesrugaovuoyqhitlsj" ? " (hudo-prod, which must never be targeted from here)" : "") + ". Never push to prod from this script.")
}
const enc = (s) => Buffer.from(s, "utf8").reduce((a, b) => {
  const c = String.fromCharCode(b)
  return a + (/[A-Za-z0-9._~-]/.test(c) ? c : "%" + b.toString(16).toUpperCase().padStart(2, "0"))
}, "")
process.stdout.write("postgresql://" + user + "." + ref + ":" + enc(password) + "@" + process.env.POOLER_HOST + ":5432/" + db)
'
)

if [ "${1:-}" = "--list" ]; then
  shift
  [ "$#" -eq 0 ] || { echo "db-push: --list takes no other arguments" >&2; exit 2; }
  cmd=(migration list --db-url "$URL")
else
  # Allowlist: anything else (a second --db-url, --linked, --project-ref…) could
  # retarget the push and sidestep the ref guard above.
  for arg in "$@"; do
    case "$arg" in
      --dry-run | --include-all | --include-seed | --include-roles) ;;
      *)
        echo "db-push: unsupported argument '$arg' (allowed: --list, --dry-run, --include-all, --include-seed, --include-roles)" >&2
        exit 2
        ;;
    esac
  done
  cmd=(db push --db-url "$URL" "$@")
fi

set +e
supabase "${cmd[@]}" 2>&1 \
  | sed -E 's#://[^@]*@#://***@#g' \
  | { grep -viE 'new version of Supabase CLI|recommend updating' || true; }
rc=${PIPESTATUS[0]}
set -e
exit "$rc"
