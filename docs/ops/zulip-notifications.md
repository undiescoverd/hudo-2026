# Zulip notifications

All CI / PR / sync notifications go to the Resolve Labs Zulip org
(`https://resolvelabs.zulipchat.com`), channel **`hudo`**. Replaced Slack 2026-11-25.

## What posts where

| Topic | Source | Posts |
|---|---|---|
| `PR #N` (one per PR) | `zulip-notify.yml` | opened, DeepSeek review posted, merged |
| `CI` | `ci.yml` | failures always; passes only on `main` |
| `E2E` | `playwright.yml` | failures always; passes only on `main` |
| `Linear sync` | `linear-sync-check.yml` | drift auto-fixed, sync failed |

Topics are created by the first message sent to them, so adding one needs no Zulip setup.
Notification steps are `continue-on-error`: a Zulip outage never fails CI.

## How it works

Every sender calls `scripts/zulip-notify.sh <topic> <message>`. It reads three GitHub
**Actions secrets**: `ZULIP_SITE`, `ZULIP_BOT_EMAIL`, `ZULIP_BOT_API_KEY`
(optional `ZULIP_CHANNEL`, default `hudo`). The bot key is passed to `curl` on stdin, so it
never appears in a URL, argv or log. If the secrets are absent (PRs from forks) the script skips.

The bot is an **incoming-webhook** bot ("Hudo Notifier"): it can only send messages.
Do not use Zulip's built-in GitHub webhook for this: its URL carries the bot key in the query string.

## Adding another project (one channel + one bot each)

Prereq: a `~/.zuliprc` (mode 600) with your admin email, API key and `site=`. Never paste the key into chat or a repo.

```sh
zcurl() { curl -sS --config <(awk -F= '/^email/{e=$2} /^key/{k=$2} END{printf "user = \"%s:%s\"\n", e, k}' ~/.zuliprc) "$@"; }
S=https://resolvelabs.zulipchat.com/api/v1
zcurl -X POST $S/users/me/subscriptions --data-urlencode 'subscriptions=[{"name":"<project>","description":"<what it is>"}]'
RESP=$(zcurl -X POST $S/bots -d short_name=<project>-notifier -d 'full_name=<Project> Notifier' -d bot_type=2 -d default_sending_stream=<project>)
BOT_ID=$(echo "$RESP" | python3 -I -c "import sys,json; print(json.load(sys.stdin)['user_id'])")
# run these inside the new repo (gh targets the current repo); key is piped, never printed:
echo "$RESP" | python3 -I -c "import sys,json; sys.stdout.write(json.load(sys.stdin)['api_key'])" | gh secret set ZULIP_BOT_API_KEY
zcurl $S/users/$BOT_ID | python3 -I -c "import sys,json; sys.stdout.write(json.load(sys.stdin)['user']['email'])" | gh secret set ZULIP_BOT_EMAIL
printf '%s' https://resolvelabs.zulipchat.com | gh secret set ZULIP_SITE
```

Then copy `scripts/zulip-notify.sh` into the new repo, set `ZULIP_CHANNEL` (or edit the default) and call it from the workflows.

## Rotating / revoking

Zulip → Personal settings → Bots → "Hudo Notifier" → regenerate key, then re-run the `ZULIP_BOT_API_KEY` line above.
