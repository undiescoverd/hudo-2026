#!/bin/bash
# DEPRECATED: Task tracking has migrated to Linear. Use update-linear-task.sh instead.
#
# Usage: ./scripts/update-baserow-task.sh <TASK_ID> <status>
# Status values: "Not Started" | "In Progress" | "In Review" | "Done"
#
# Example: ./scripts/update-baserow-task.sh S0-INFRA-001 "In Progress"

set -euo pipefail

TASK_ID="${1:-}"
NEW_STATUS="${2:-}"

if [[ -z "$TASK_ID" || -z "$NEW_STATUS" ]]; then
  echo "Usage: $0 <TASK_ID> <status>"
  echo "  Status values: 'Not Started' | 'In Progress' | 'In Review' | 'Done'"
  exit 1
fi

# Load credentials from .env.baserow (project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.baserow"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

TABLE_ID="${BASEROW_TABLE_ID:-849304}"
DB_TOKEN="${BASEROW_DB_TOKEN:-}"

if [[ -z "$DB_TOKEN" ]]; then
  echo "Error: BASEROW_DB_TOKEN not set in .env.baserow"
  exit 1
fi

BASE="https://api.baserow.io/api"
AUTH_HEADER="Token $DB_TOKEN"

# Find row by Name field (Task ID)
SEARCH_RESP=$(curl -s \
  -H "Authorization: $AUTH_HEADER" \
  "$BASE/database/rows/table/$TABLE_ID/?user_field_names=true&search=$TASK_ID&size=10")

ROW_ID=$(echo "$SEARCH_RESP" | python3 -c "
import sys, json
data = json.load(sys.stdin)
rows = data.get('results', [])
task_id = '$TASK_ID'
for r in rows:
    if r.get('Name') == task_id:
        print(r['id'])
        break
")

if [[ -z "$ROW_ID" ]]; then
  echo "Error: Task '$TASK_ID' not found in Baserow"
  exit 1
fi

# Map status string to option ID
STATUS_ID=$(python3 -c "
status_map = {
  'Not Started': 5427486,
  'In Progress': 5427487,
  'In Review':   5427488,
  'Done':        5427489,
}
val = status_map.get('$NEW_STATUS')
if val:
    print(val)
else:
    print('')
")

if [[ -z "$STATUS_ID" ]]; then
  echo "Error: Unknown status '$NEW_STATUS'. Use: 'Not Started', 'In Progress', 'In Review', 'Done'"
  exit 1
fi

# Update the row
UPDATE_RESP=$(curl -s -X PATCH \
  -H "Authorization: $AUTH_HEADER" \
  -H "Content-Type: application/json" \
  "$BASE/database/rows/table/$TABLE_ID/$ROW_ID/?user_field_names=true" \
  -d "{\"Status\": $STATUS_ID}")

UPDATED_STATUS=$(echo "$UPDATE_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
s = d.get('Status', {})
if isinstance(s, dict):
    print(s.get('value', ''))
else:
    print(s or 'error')
")

echo "✓ $TASK_ID → $UPDATED_STATUS (row $ROW_ID)"
