#!/usr/bin/env sh
# Block hardcoded credentials from being committed or pushed.
#
# Why (2026-10-16): this repo is PUBLIC and two shared test-account passwords
# leaked through hardcoded literals (DevQuickSignIn / seed-dev, seed-staging).
# GitGuardian caught one only AFTER it was public. This runs locally first.
#
# Scans the ADDED lines of a diff (never the whole tree) for:
#   (a) hardcoded credential assignments  e.g.  password: "<8+ char literal>"
#   (b) provider tokens                   e.g.  sk_live_, whsec_, JWTs, AWS/GitHub keys, PEM keys
#   (c) added/staged .env* files          (except .env.example and *.example)
#
# Usage:
#   sh scripts/check-secrets.sh                    # same as --staged
#   sh scripts/check-secrets.sh --staged           # added lines of `git diff --cached`
#   sh scripts/check-secrets.sh --range A..B       # added lines of `git diff A..B` (or A...B)
#
# Skipped: *.test.ts, *.test.tsx, tests/, pnpm-lock.yaml, binary files, and any
# line containing `secret-scan: allow`.
#
# Output is `file:line: <kind>` with the value MASKED (first 4 chars + "…").
# Exit 0 = clean, exit 1 = findings, exit 2 = could not run the git diff.

set -u

mode="staged"
range=""
case "${1:-}" in
  "" | --staged) mode="staged" ;;
  --range)
    mode="range"
    range="${2:-}"
    if [ -z "$range" ]; then
      echo "check-secrets: --range needs a value, e.g. --range origin/main...HEAD" >&2
      exit 2
    fi
    ;;
  --range=*)
    mode="range"
    range="${1#--range=}"
    ;;
  *)
    echo "usage: check-secrets.sh [--staged | --range A..B]" >&2
    exit 2
    ;;
esac

tmp=$(mktemp -d "${TMPDIR:-/tmp}/check-secrets.XXXXXX") || exit 2
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
: >"$tmp/meta" # one "file:line" per added line
: >"$tmp/text" # the matching added line text (same line numbers as meta)
: >"$tmp/out"  # findings

gitdiff() {
  if [ "$mode" = "staged" ]; then
    git -c core.quotepath=off diff --cached --no-color --no-ext-diff --no-textconv "$@"
  else
    git -c core.quotepath=off diff --no-color --no-ext-diff --no-textconv "$@" "$range" --
  fi
}

# Stderr is left visible on purpose: if git fails (e.g. unknown ref) we must not report "clean".
gitdiff -U0 --diff-filter=ACMR >"$tmp/diff" || {
  echo "check-secrets: git diff failed, cannot scan" >&2
  exit 2
}
gitdiff --name-only --diff-filter=ACMR >"$tmp/names" || exit 2

# Added lines -> meta/text (with path + line number, honouring skip rules).
awk -v meta="$tmp/meta" -v text="$tmp/text" '
  function skippath(p) {
    if (p ~ /\.test\.tsx?$/) return 1
    if (p ~ /(^|\/)tests\//) return 1
    if (p ~ /(^|\/)pnpm-lock\.yaml$/) return 1
    return 0
  }
  /^diff --git / { inhdr = 1; skip = 1; next }
  inhdr && /^\+\+\+ / {
    f = $0
    sub(/^\+\+\+ /, "", f)
    sub(/\t.*$/, "", f)
    if (f != "/dev/null") {
      sub(/^b\//, "", f)
      path = f
      skip = skippath(path)
    }
    next
  }
  /^@@ / {
    inhdr = 0
    s = $0
    sub(/^@@ -[0-9,]+ \+/, "", s)
    sub(/[ ,].*$/, "", s)
    ln = s + 0
    next
  }
  inhdr { next }
  /^\+/ {
    if (!skip && index($0, "secret-scan: allow") == 0) {
      print path ":" ln >> meta
      print substr($0, 2) >> text
    }
    ln++
    next
  }
' "$tmp/diff"

mask() {
  printf '%s…' "$(printf '%s' "$1" | cut -c1-4)"
}

# (a) hardcoded credential assignment -------------------------------------
# keyword, optional _SUFFIX, optional closing quote, : or =, then a quoted
# literal of 8+ non-space chars. Placeholders / env reads are dropped below.
CRED_RE='(password|passwd|pwd|secret|token|api[_-]?key)(_[A-Za-z0-9_]*)?["'\'']?[[:space:]]*[:=][[:space:]]*["'\''`][^"'\''`[:space:]]{8,}["'\''`]'

is_placeholder() {
  v=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  case "$v" in
    '$'* | *'${'* | *process.env* | '<'*'>'* | *xxx* | *changeme* | your-* | your_* | *'<'*) return 0 ;;
    *example* | *placeholder* | *redacted* | *'*****'* | *'.....'*) return 0 ;;
  esac
  return 1
}

grep -nEi -e "$CRED_RE" "$tmp/text" | cut -d: -f1 | while read -r n; do
  line=$(sed -n "${n}p" "$tmp/text")
  where=$(sed -n "${n}p" "$tmp/meta")
  printf '%s\n' "$line" | grep -oEi -e "$CRED_RE" | while read -r m; do
    value=$(printf '%s' "$m" | sed -E "s/.*[\"'\`]([^\"'\`[:space:]]*)[\"'\`]\$/\\1/")
    is_placeholder "$value" && continue
    echo "$where: hardcoded-credential (value $(mask "$value"))" >>"$tmp/out"
  done
done

# (b) provider tokens (case-sensitive) ------------------------------------
scan_token() { # label, regex
  grep -nE -e "$2" "$tmp/text" | cut -d: -f1 | while read -r n; do
    line=$(sed -n "${n}p" "$tmp/text")
    where=$(sed -n "${n}p" "$tmp/meta")
    m=$(printf '%s\n' "$line" | grep -oE -e "$2" | head -n 1)
    case "$m" in re_*) ;; *) [ "$1" = resend-key ] && m=${m#?} ;; esac # drop the boundary char
    echo "$where: $1 ($(mask "$m"))" >>"$tmp/out"
  done
}
# Live keys need a body: bare `sk_live_` appears in docs/prefix checks (startsWith('sk_live_')).
scan_token stripe-key '(sk|rk)_live_[A-Za-z0-9]{16,}|sk_test_[A-Za-z0-9]{16,}'
scan_token stripe-webhook-secret 'whsec_[A-Za-z0-9]{16,}'
scan_token linear-key 'lin_api_[A-Za-z0-9]{20,}'
scan_token resend-key '(^|[^A-Za-z0-9_])re_[A-Za-z0-9_]{20,}'
scan_token aws-access-key 'AKIA[0-9A-Z]{16}'
scan_token github-token 'ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,}'
scan_token slack-token 'xox[baprs]-[A-Za-z0-9-]*'
scan_token jwt 'eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}'
scan_token private-key '-----BEGIN [A-Z ]*PRIVATE KEY-----'

# (c) .env* files ----------------------------------------------------------
while IFS= read -r f; do
  [ -n "$f" ] || continue
  base=${f##*/}
  case "$base" in
    .env.example | *.example) ;;
    .env*) echo "$f:0: env-file (.env* must never be committed)" >>"$tmp/out" ;;
  esac
done <"$tmp/names"

if [ -s "$tmp/out" ]; then
  sort -u "$tmp/out" >&2
  cat >&2 <<'EOF'

check-secrets: possible secret(s) in the changes above (values masked).
This repo is PUBLIC: anything committed here is published when pushed.
Fix: move the value to .env.local / .env.staging (gitignored) and read it
from process.env. Rotate the credential if it was ever pushed.
Escape hatch: append `secret-scan: allow` to the line (e.g. in a comment).
Use it ONLY for non-credentials (test fixtures, public IDs), never for real secrets.
EOF
  exit 1
fi
exit 0
