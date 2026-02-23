#!/bin/bash
# Usage: ./scripts/update-linear-task.sh <TASK_ID> <status>
#        ./scripts/update-linear-task.sh --status <TASK_ID>
# Status values: "In Progress" | "In Review" | "Done" | "Blocked"
#
# Example: ./scripts/update-linear-task.sh S0-INFRA-001 "In Progress"
# Query:   ./scripts/update-linear-task.sh --status S0-INFRA-001

set -euo pipefail

# Detect query mode
MODE="update"
if [[ "${1:-}" == "--status" ]]; then
  MODE="query"
  TASK_ID="${2:-}"
  NEW_STATUS=""
  if [[ -z "$TASK_ID" ]]; then
    echo "Usage: $0 --status <TASK_ID>"
    exit 1
  fi
else
  TASK_ID="${1:-}"
  NEW_STATUS="${2:-}"
  if [[ -z "$TASK_ID" || -z "$NEW_STATUS" ]]; then
    echo "Usage: $0 <TASK_ID> <status>"
    echo "       $0 --status <TASK_ID>"
    echo "  Status values: 'In Progress' | 'In Review' | 'Done' | 'Blocked'"
    exit 1
  fi
fi

# Load credentials from .env.linear (project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.linear"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

LINEAR_API_KEY="${LINEAR_API_KEY:-}"
if [[ -z "$LINEAR_API_KEY" ]]; then
  echo "Error: LINEAR_API_KEY not set in .env.linear"
  exit 1
fi

LINEAR_API_KEY="$LINEAR_API_KEY" \
TASK_ID="$TASK_ID" \
NEW_STATUS="$NEW_STATUS" \
MODE="$MODE" \
python3 - << 'PYEOF'
import os, json, urllib.request, sys

api_key    = os.environ["LINEAR_API_KEY"]
task_id    = os.environ["TASK_ID"]
new_status = os.environ["NEW_STATUS"]
mode       = os.environ["MODE"]

# Validate status (only in update mode)
status_name_map = {
    "In Progress": "In Progress",
    "In Review":   "In Review",
    "Done":        "Done",
    "Blocked":     "Blocked",
}

if mode == "update":
    status_name = status_name_map.get(new_status)
    if not status_name:
        print(f"Error: Unknown status '{new_status}'. Use: 'In Progress', 'In Review', 'Done', 'Blocked'")
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

# Resolve task ID to Linear issue via API search (no static mapping file needed)
search = gql(
    "query($q: String!) { searchIssues(term: $q) { nodes { id identifier title } } }",
    {"q": task_id},
)
nodes = search["searchIssues"]["nodes"]
matching = [n for n in nodes if n["title"].upper().startswith(task_id)]
if not matching:
    print(f"Error: No Linear issue found for '{task_id}'")
    sys.exit(1)
issue_id = matching[0]["id"]

# --- Query mode: print current state and exit ---
if mode == "query":
    data = gql(
        "query($id: String!) { issue(id: $id) { state { name } } }",
        {"id": issue_id},
    )
    state_name = data["issue"]["state"]["name"]
    print(state_name)
    sys.exit(0)

# --- Update mode ---
print(f"Found: {matching[0]['identifier']} — {matching[0]['title']}")

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
