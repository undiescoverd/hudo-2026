#!/bin/bash
# Usage: ./scripts/update-linear-task.sh <TASK_ID> <status>
# Status values: "In Progress" | "In Review" | "Done"
#
# Example: ./scripts/update-linear-task.sh S0-INFRA-001 "In Progress"

set -euo pipefail

TASK_ID="${1:-}"
NEW_STATUS="${2:-}"

if [[ -z "$TASK_ID" || -z "$NEW_STATUS" ]]; then
  echo "Usage: $0 <TASK_ID> <status>"
  echo "  Status values: 'In Progress' | 'In Review' | 'Done'"
  exit 1
fi

# Load credentials from .env.baserow (project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.baserow"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

LINEAR_API_KEY="${LINEAR_API_KEY:-}"
if [[ -z "$LINEAR_API_KEY" ]]; then
  echo "Error: LINEAR_API_KEY not set in .env.baserow"
  exit 1
fi

ID_MAP="$SCRIPT_DIR/linear-id-map.json"
if [[ ! -f "$ID_MAP" ]]; then
  echo "Error: linear-id-map.json not found at $ID_MAP"
  exit 1
fi

LINEAR_API_KEY="$LINEAR_API_KEY" \
TASK_ID="$TASK_ID" \
NEW_STATUS="$NEW_STATUS" \
ID_MAP="$ID_MAP" \
python3 - << 'PYEOF'
import os, json, urllib.request, sys

api_key    = os.environ["LINEAR_API_KEY"]
task_id    = os.environ["TASK_ID"]
new_status = os.environ["NEW_STATUS"]
id_map_path = os.environ["ID_MAP"]

# Validate status
status_name_map = {
    "In Progress": "In Progress",
    "In Review":   "In Review",
    "Done":        "Done",
}
status_name = status_name_map.get(new_status)
if not status_name:
    print(f"Error: Unknown status '{new_status}'. Use: 'In Progress', 'In Review', 'Done'")
    sys.exit(1)

# Look up Linear UUID
with open(id_map_path) as f:
    id_map = json.load(f)

issue_id = id_map.get(task_id)
if not issue_id:
    print(f"Error: Task '{task_id}' not found in linear-id-map.json")
    sys.exit(1)

headers = {
    "Authorization": api_key,
    "Content-Type": "application/json",
}

def gql(query, variables=None):
    payload = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        "https://api.linear.app/graphql",
        data=payload,
        headers=headers,
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    if data.get("errors"):
        raise RuntimeError(f"GraphQL error: {data['errors']}")
    return data["data"]

# Get team ID from the issue
data = gql(
    "query($id: String!) { issue(id: $id) { id title team { id } } }",
    {"id": issue_id},
)
team_id = data["issue"]["team"]["id"]

# Get workflow states for this team
data = gql(
    """query($teamId: ID!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }) {
        nodes { id name }
      }
    }""",
    {"teamId": team_id},
)
states = data["workflowStates"]["nodes"]

target = next((s for s in states if s["name"].lower() == status_name.lower()), None)
if not target:
    available = [s["name"] for s in states]
    print(f"Error: State '{status_name}' not found in Linear. Available: {available}", file=sys.stderr)
    sys.exit(1)

# Update the issue
data = gql(
    """mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success
        issue { id identifier state { name } }
      }
    }""",
    {"id": issue_id, "stateId": target["id"]},
)

issue = data["issueUpdate"]["issue"]
print(f"✓ {task_id} ({issue['identifier']}) → {issue['state']['name']}")
PYEOF
