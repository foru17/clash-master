#!/bin/sh
# Test: docker-start.sh correctly passes API_URL to the web frontend process
# This validates the fix for https://github.com/foru17/clash-master/issues/11

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_START="$SCRIPT_DIR/../docker-start.sh"

echo "=== Test: API_URL is passed to web frontend ==="

# Verify docker-start.sh contains API_URL in the web frontend startup block
if sed -n '/Start web frontend/,/WEB_PID/p' "$DOCKER_START" | grep -q 'API_URL='; then
  echo "✅ PASS: API_URL is set when starting the web frontend"
else
  echo "❌ FAIL: API_URL is missing from web frontend startup"
  exit 1
fi

# Verify API_URL references API_PORT variable (dynamic, not hardcoded)
if sed -n '/Start web frontend/,/WEB_PID/p' "$DOCKER_START" | grep 'API_URL=' | grep -q 'API_PORT'; then
  echo "✅ PASS: API_URL correctly references \$API_PORT"
else
  echo "❌ FAIL: API_URL does not reference \$API_PORT"
  exit 1
fi

# Verify the default API_PORT is still set at the top of the script
if grep -q 'API_PORT=.*3001' "$DOCKER_START"; then
  echo "✅ PASS: Default API_PORT (3001) is preserved"
else
  echo "❌ FAIL: Default API_PORT is missing"
  exit 1
fi

# Verify API_PORT is exported
if grep -q 'export API_PORT' "$DOCKER_START"; then
  echo "✅ PASS: API_PORT is exported"
else
  echo "❌ FAIL: API_PORT is not exported"
  exit 1
fi

echo ""
echo "All tests passed! ✅"
