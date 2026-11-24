#!/bin/sh
# Post one message to a topic in this project's Zulip channel.
#
#   scripts/zulip-notify.sh <topic> <message>
#
# Env (GitHub Actions secrets): ZULIP_SITE, ZULIP_BOT_EMAIL, ZULIP_BOT_API_KEY
# Optional: ZULIP_CHANNEL (default "hudo")
#
# - Skips quietly (exit 0) when the secrets are absent, e.g. PRs from forks.
# - The API key goes to curl on stdin, never argv, so it cannot show in `ps`.
# - Message text goes through --data-urlencode, so quotes/newlines are safe.
# See docs/ops/zulip-notifications.md.
set -eu

topic=${1:?usage: zulip-notify.sh <topic> <message>}
message=${2:?usage: zulip-notify.sh <topic> <message>}

if [ -z "${ZULIP_SITE:-}" ] || [ -z "${ZULIP_BOT_EMAIL:-}" ] || [ -z "${ZULIP_BOT_API_KEY:-}" ]; then
  echo "Zulip secrets not set; skipping notification"
  exit 0
fi

case "$ZULIP_SITE" in
  https://*) ;;
  *) echo "ZULIP_SITE must start with https://" >&2; exit 1 ;;
esac

# Zulip topics max out at 60 characters.
topic=$(printf '%.60s' "$topic")

printf 'user = "%s:%s"\n' "$ZULIP_BOT_EMAIL" "$ZULIP_BOT_API_KEY" |
  curl -sS --fail-with-body --max-time 20 --config - \
    -X POST "${ZULIP_SITE%/}/api/v1/messages" \
    --data-urlencode "type=channel" \
    --data-urlencode "to=${ZULIP_CHANNEL:-hudo}" \
    --data-urlencode "topic=$topic" \
    --data-urlencode "content=$message"
echo
