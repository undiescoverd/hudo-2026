#!/usr/bin/env bash
# Manual curl tests for video upload API. Close PR when all pass.
#
# Optional env for authenticated tests: TEST_EMAIL, TEST_PASSWORD, TEST_AGENCY_ID
# For 403 test also set WRONG_AGENCY_ID (an agency the user is not a member of).
set -e
BASE_URL="${BASE_URL:-http://localhost:3000}"
COOKIE_JAR="${COOKIE_JAR:-/tmp/hudo-upload-test-cookies.txt}"
BODY_PRESIGN_VALID='{"agencyId":"00000000-0000-0000-0000-000000000001","fileName":"test.mp4","contentType":"video/mp4","fileSizeBytes":1024}'

echo "=== 1. Unauthenticated → 401 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/videos/upload/presign" \
  -H "Content-Type: application/json" \
  -d "$BODY_PRESIGN_VALID")
if [ "$STATUS" = "401" ]; then echo "PASS: got 401"; else echo "FAIL: expected 401, got $STATUS"; exit 1; fi

echo ""
echo "=== 2. Bad content type → 400 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/videos/upload/presign" \
  -H "Content-Type: application/json" \
  -d '{"agencyId":"00000000-0000-0000-0000-000000000001","fileName":"test.mp4","contentType":"application/octet-stream","fileSizeBytes":1024}')
if [ "$STATUS" = "400" ]; then echo "PASS: got 400"; else echo "FAIL: expected 400, got $STATUS"; exit 1; fi

echo ""
echo "=== 3. POST /api/videos/upload/presign → returns presigned URL (auth required) ==="
if [ -z "$TEST_EMAIL" ] || [ -z "$TEST_PASSWORD" ] || [ -z "$TEST_AGENCY_ID" ]; then
  echo "SKIP: set TEST_EMAIL, TEST_PASSWORD, TEST_AGENCY_ID to run authenticated tests"
else
  rm -f "$COOKIE_JAR"
  curl -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/signin" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" | head -c 200
  echo ""
  BODY=$(curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "$BASE_URL/api/videos/upload/presign" \
    -H "Content-Type: application/json" \
    -d "{\"agencyId\":\"$TEST_AGENCY_ID\",\"fileName\":\"test.mp4\",\"contentType\":\"video/mp4\",\"fileSizeBytes\":1024}")
  if echo "$BODY" | grep -q '"uploadUrl"'; then
    echo "PASS: presign returned uploadUrl"
    EVAL=$(echo "$BODY" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log((d.uploadUrl||'').replace(/\s/g,''), d.videoId||'', d.r2Key||'')")
    UPLOAD_URL=$(echo "$EVAL" | awk '{print $1}')
    VIDEO_ID=$(echo "$EVAL" | awk '{print $2}')
    R2_KEY=$(echo "$EVAL" | awk '{print $3}')
  else
    echo "FAIL: presign response: $BODY"
    exit 1
  fi

  echo ""
  echo "=== 4. PUT file to presigned URL → 200 from R2 ==="
  # Presign was for 1024 bytes and video/mp4 — request must match exactly
  DD_BODY=$(mktemp)
  dd if=/dev/zero of="$DD_BODY" bs=1024 count=1 2>/dev/null
  PUT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$UPLOAD_URL" \
    -H "Content-Type: video/mp4" \
    -H "Content-Length: 1024" \
    --data-binary "@$DD_BODY")
  rm -f "$DD_BODY"
  if [ "$PUT_STATUS" = "200" ]; then echo "PASS: PUT returned 200"; else echo "FAIL: expected 200, got $PUT_STATUS"; exit 1; fi

  echo ""
  echo "=== 5. POST /api/videos/upload/complete → returns version record ==="
  COMPLETE_BODY=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/videos/upload/complete" \
    -H "Content-Type: application/json" \
    -d "{\"videoId\":\"$VIDEO_ID\",\"agencyId\":\"$TEST_AGENCY_ID\",\"r2Key\":\"$R2_KEY\",\"fileSizeBytes\":1024,\"multipart\":false}")
  if echo "$COMPLETE_BODY" | grep -q '"version"'; then
    echo "PASS: complete returned version"
  else
    echo "FAIL: complete response: $COMPLETE_BODY"
    exit 1
  fi
fi

echo ""
echo "=== 6. Wrong agency → 403 (optional: set WRONG_AGENCY_ID + credentials) ==="
if [ -n "$TEST_EMAIL" ] && [ -n "$TEST_PASSWORD" ] && [ -n "$WRONG_AGENCY_ID" ]; then
  rm -f "$COOKIE_JAR"
  curl -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/signin" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" > /dev/null
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/videos/upload/presign" \
    -H "Content-Type: application/json" \
    -d "{\"agencyId\":\"$WRONG_AGENCY_ID\",\"fileName\":\"test.mp4\",\"contentType\":\"video/mp4\",\"fileSizeBytes\":1024}")
  if [ "$STATUS" = "403" ]; then echo "PASS: got 403"; else echo "FAIL: expected 403, got $STATUS"; exit 1; fi
else
  echo "SKIP: set WRONG_AGENCY_ID (and credentials) to run 403 test"
fi

echo ""
echo "=== 7. Over quota → 402 ==="
echo "SKIP: manual test — set agency storage_limit_bytes low and storage_usage_bytes near limit, then presign"

echo ""
echo "All runnable checks passed."
