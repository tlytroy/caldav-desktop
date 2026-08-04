#!/bin/bash
# Master Test Orchestrator
# Runs all test suites for the Radicale Desktop project

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Radicale Desktop - Test Suite Runner${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

START_TIME=$(date +%s)
ALL_PASSED=true

run_test_suite() {
    local name=$1
    local command=$2
    local dir=$3

    echo -e "${YELLOW}[$name]${NC} Running tests..."
    echo ""

    if [ -n "$dir" ]; then
        cd "$dir"
    fi

    if eval "$command"; then
        echo ""
        echo -e "${GREEN}✓ [$name] All tests passed${NC}"
    else
        echo ""
        echo -e "${RED}✗ [$name] Some tests failed${NC}"
        ALL_PASSED=false
    fi

    if [ -n "$dir" ]; then
        cd - > /dev/null
    fi
    echo ""
}

# 1. Server Unit Tests (vitest)
echo -e "${BLUE}--- Server Unit Tests ---${NC}"
run_test_suite "Server" "npx vitest run --reporter verbose 2>&1" "apps/server"

# 2. Renderer Unit Tests (vitest)
echo -e "${BLUE}--- Renderer Unit Tests ---${NC}"
run_test_suite "Renderer" "npx vitest run --reporter verbose 2>&1" "apps/renderer"

# 3. API Integration Tests (curl-based, requires server)
echo -e "${BLUE}--- API Integration Tests ---${NC}"
echo -e "${YELLOW}[API Integration]${NC} Checking if server is running..."
if curl -s --connect-timeout 3 -o /dev/null -w "%{http_code}" "http://localhost:3002/api/calendars" 2>/dev/null | grep -qE "^(200|401|500)$"; then
    run_test_suite "API Integration" "bash scripts/test-api-integration.sh 2>&1" "."
else
    echo -e "${YELLOW}[API Integration]${NC} ${RED}Server is not running. Skipping API integration tests.${NC}"
    echo -e "  Start the server with: cd apps/server && npm run dev"
    echo ""
fi

# Summary
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo -e "${BLUE}============================================${NC}"
if [ "$ALL_PASSED" = true ]; then
    echo -e "${GREEN}  All test suites passed!${NC}"
else
    echo -e "${RED}  Some test suites failed!${NC}"
fi
echo -e "${BLUE}  Duration: ${DURATION}s${NC}"
echo -e "${BLUE}============================================${NC}"

if [ "$ALL_PASSED" = false ]; then
    exit 1
fi
exit 0