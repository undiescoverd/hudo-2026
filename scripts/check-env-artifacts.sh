#!/usr/bin/env sh
# Detect newline-taint artifacts in dotenv files.
#
# Root cause (2026-07-05): values piped into `vercel env add` with `echo`
# carry a trailing newline, which Vercel stores INSIDE the value. Every
# `vercel env pull` then serializes it as a literal \n in the dotenv file
# (KEY="value\n"), breaking Supabase auth, R2 signing, etc. locally.
#
# Rule: pipe with `printf '%s' "$VALUE" | vercel env add KEY <env>` — never echo.
# Run this after any `vercel env add` or `vercel env pull`:
#   sh scripts/check-env-artifacts.sh [files...]   (default: .env .env.local .env.staging)
#
# Exit 0 = clean, exit 1 = artifacts found.

set -u
files="${*:-".env .env.local .env.staging"}"
status=0

for f in $files; do
  [ -f "$f" ] || continue
  # literal backslash-n inside a value, e.g. KEY="value\n"
  tainted=$(grep -nE '\\n"?$' "$f" | sed -E 's/=.*//' || true)
  # double-wrapped quotes, e.g. KEY=""value"..." (value was stored with quotes)
  doubled=$(grep -nE '^[A-Za-z_]+=""[^"]' "$f" | sed -E 's/=.*//' || true)
  if [ -n "$tainted" ] || [ -n "$doubled" ]; then
    echo "TAINTED: $f"
    [ -n "$tainted" ] && echo "$tainted" | sed 's/^/  \\n artifact @ line /'
    [ -n "$doubled" ] && echo "$doubled" | sed 's/^/  double-quoted @ line /'
    status=1
  else
    echo "clean:   $f"
  fi
done

if [ "$status" -ne 0 ]; then
  echo ""
  echo "Fix: re-add the tainted values in Vercel with: printf '%s' \"\$VALUE\" | vercel env add KEY <env> --force"
  echo "Then re-pull: vercel env pull <file> --environment=<env> --yes"
fi
exit $status
