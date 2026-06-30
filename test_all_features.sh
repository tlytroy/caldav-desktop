#!/bin/bash

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 计数器
PASS=0
FAIL=0
TOTAL=0

# 测试函数
test_feature() {
    local name=$1
    local command=$2
    local expected_status=$3

    TOTAL=$((TOTAL + 1))
    echo -e "${BLUE}测试 $TOTAL: $name${NC}"

    # 执行命令并获取HTTP状态码
    local response=$(eval $command 2>/dev/null)
    local status_code=$(echo "$response" | tail -n1 | grep -oE '^[0-9]+' || echo "0")

    # 如果没有获取到状态码，尝试另一种方式
    if [ "$status_code" = "0" ]; then
        status_code=$(curl -s -o /dev/null -w "%{http_code}" $command 2>/dev/null)
    fi

    if [ "$status_code" = "$expected_status" ] || [ "$expected_status" = "ANY" ]; then
        echo -e "${GREEN}✓ PASS${NC} - Status: $status_code"
        PASS=$((PASS + 1))
        # 显示响应内容（如果有的话）
        local body=$(echo "$response" | sed '$d' | grep -v "^$")
        if [ -n "$body" ] && [ "$body" != "{}" ]; then
            echo "Response: $body"
        fi
    else
        echo -e "${RED}✗ FAIL${NC} - Expected: $expected_status, Got: $status_code"
        FAIL=$((FAIL + 1))
    fi
    echo ""
}

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Radicale Desktop Calendar 功能测试${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 1. 健康检查
test_feature "健康检查" "curl -s -w '\n%{http_code}' http://localhost:3001/health" "200"

# 2. 获取日历列表
echo -e "${YELLOW}--- 日历功能测试 ---${NC}"
test_feature "获取日历列表" "curl -s -w '\n%{http_code}' http://localhost:3001/api/calendar/calendars" "200"

# 获取第一个日历URL用于后续测试
CALENDAR_URL=$(curl -s http://localhost:3001/api/calendar/calendars | grep -o '"url":"[^"]*' | head -1 | cut -d'"' -f4)
ENCODED_CALENDAR_URL=$(echo $CALENDAR_URL | sed 's|/|%2F|g')
echo "使用日历URL: $CALENDAR_URL"
echo ""

# 3. 配置管理测试
echo -e "${YELLOW}--- 配置管理测试 ---${NC}"
test_feature "获取当前配置" "curl -s -w '\n%{http_code}' http://localhost:3001/api/calendar/config" "200"
test_feature "测试连接配置" "curl -s -w '\n%{http_code}' -X POST http://localhost:3001/api/calendar/config/test -H 'Content-Type: application/json' -d '{\"url\":\"$CALENDAR_URL\",\"username\":\"root\",\"password\":\"tianleiyu\"}'" "200"
echo ""

# 4. 事件CRUD测试
echo -e "${YELLOW}--- 事件CRUD测试 ---${NC}"

# 创建基础事件
CREATE_EVENT_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST http://localhost:3001/api/calendar/events \
  -H "Content-Type: application/json" \
  -d '{
    "title": "测试事件 - 基础功能",
    "start": "2026-06-26T18:00:00.000Z",
    "end": "2026-06-26T19:00:00.000Z",
    "allDay": false,
    "description": "基础功能测试事件",
    "calendarUrl": "'$CALENDAR_URL'"
  }')

CREATE_STATUS=$(echo "$CREATE_EVENT_RESPONSE" | tail -n1)
EVENT_BODY=$(echo "$CREATE_EVENT_RESPONSE" | sed '$d')
EVENT_ID=$(echo "$EVENT_BODY" | grep -o '"uid":"[^"]*' | cut -d'"' -f4)

TOTAL=$((TOTAL + 1))
echo -e "${BLUE}测试 $TOTAL: 创建基础事件${NC}"
if [ "$CREATE_STATUS" = "201" ] || [ "$CREATE_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Status: $CREATE_STATUS"
    echo "创建的事件ID: $EVENT_ID"
    PASS=$((PASS + 1))
else
    echo -e "${RED}✗ FAIL${NC} - Expected: 201, Got: $CREATE_STATUS"
    FAIL=$((FAIL + 1))
fi
echo ""

# 如果事件创建成功，继续其他测试
if [ -n "$EVENT_ID" ]; then
    # 获取事件列表
    test_feature "获取事件列表" "curl -s -w '\n%{http_code}' \"http://localhost:3001/api/calendar/events?start=2026-06-26T00:00:00.000Z&end=2026-06-27T00:00:00.000Z&calendarUrl=$ENCODED_CALENDAR_URL\"" "200"

    # 更新事件
    test_feature "更新事件" "curl -s -w '\n%{http_code}' -X PUT http://localhost:3001/api/calendar/events/$EVENT_ID -H 'Content-Type: application/json' -d '{\"title\":\"更新后的测试事件\",\"start\":\"2026-06-26T19:00:00.000Z\",\"end\":\"2026-06-26T20:00:00.000Z\",\"allDay\":false,\"description\":\"更新后的测试事件\",\"calendarUrl\":\"'$CALENDAR_URL'\"}'" "200"

    # 删除事件
    test_feature "删除事件" "curl -s -w '\n%{http_code}' -X DELETE \"http://localhost:3001/api/calendar/events/$EVENT_ID?calendarUrl=$ENCODED_CALENDAR_URL\"" "200"
fi
echo ""

# 5. 复杂事件测试
echo -e "${YELLOW}--- 复杂事件测试 ---${NC}"

# 创建带分类和标签的事件
COMPLEX_CREATE_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST http://localhost:3001/api/calendar/events \
  -H "Content-Type: application/json" \
  -d '{
    "title": "复杂事件测试",
    "start": "2026-06-26T20:00:00.000Z",
    "end": "2026-06-26T21:00:00.000Z",
    "allDay": false,
    "description": "带分类和标签的复杂事件",
    "category": {
      "id": "work",
      "name": "Work",
      "color": "#3b82f6"
    },
    "tags": [
      {
        "id": "important",
        "name": "Important",
        "color": "#ef4444"
      }
    ],
    "calendarUrl": "'$CALENDAR_URL'"
  }')

COMPLEX_CREATE_STATUS=$(echo "$COMPLEX_CREATE_RESPONSE" | tail -n1)
COMPLEX_EVENT_BODY=$(echo "$COMPLEX_CREATE_RESPONSE" | sed '$d')
COMPLEX_EVENT_ID=$(echo "$COMPLEX_EVENT_BODY" | grep -o '"uid":"[^"]*' | cut -d'"' -f4)

TOTAL=$((TOTAL + 1))
echo -e "${BLUE}测试 $TOTAL: 创建复杂事件${NC}"
if [ "$COMPLEX_CREATE_STATUS" = "201" ] || [ "$COMPLEX_CREATE_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Status: $COMPLEX_CREATE_STATUS"
    echo "创建的复杂事件ID: $COMPLEX_EVENT_ID"
    PASS=$((PASS + 1))
else
    echo -e "${RED}✗ FAIL${NC} - Expected: 201, Got: $COMPLEX_CREATE_STATUS"
    FAIL=$((FAIL + 1))
fi
echo ""

# 清理复杂事件
if [ -n "$COMPLEX_EVENT_ID" ]; then
    test_feature "删除复杂事件" "curl -s -w '\n%{http_code}' -X DELETE \"http://localhost:3001/api/calendar/events/$COMPLEX_EVENT_ID?calendarUrl=$ENCODED_CALENDAR_URL\"" "200"
fi
echo ""

# 6. 全天事件测试
echo -e "${YELLOW}--- 全天事件测试 ---${NC}"

# 创建全天事件
ALLDAY_CREATE_RESPONSE=$(curl -s -w '\n%{http_code}' -X POST http://localhost:3001/api/calendar/events \
  -H "Content-Type: application/json" \
  -d '{
    "title": "全天事件测试",
    "start": "2026-06-26T00:00:00.000Z",
    "end": "2026-06-26T23:59:59.000Z",
    "allDay": true,
    "description": "全天事件测试",
    "calendarUrl": "'$CALENDAR_URL'"
  }')

ALLDAY_CREATE_STATUS=$(echo "$ALLDAY_CREATE_RESPONSE" | tail -n1)
ALLDAY_EVENT_BODY=$(echo "$ALLDAY_CREATE_RESPONSE" | sed '$d')
ALLDAY_EVENT_ID=$(echo "$ALLDAY_EVENT_BODY" | grep -o '"uid":"[^"]*' | cut -d'"' -f4)

TOTAL=$((TOTAL + 1))
echo -e "${BLUE}测试 $TOTAL: 创建全天事件${NC}"
if [ "$ALLDAY_CREATE_STATUS" = "201" ] || [ "$ALLDAY_CREATE_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Status: $ALLDAY_CREATE_STATUS"
    echo "创建的全天事件ID: $ALLDAY_EVENT_ID"
    PASS=$((PASS + 1))
else
    echo -e "${RED}✗ FAIL${NC} - Expected: 201, Got: $ALLDAY_CREATE_STATUS"
    FAIL=$((FAIL + 1))
fi
echo ""

# 清理全天事件
if [ -n "$ALLDAY_EVENT_ID" ]; then
    test_feature "删除全天事件" "curl -s -w '\n%{http_code}' -X DELETE \"http://localhost:3001/api/calendar/events/$ALLDAY_EVENT_ID?calendarUrl=$ENCODED_CALENDAR_URL\"" "200"
fi
echo ""

# 测试总结
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}测试总结${NC}"
echo -e "${BLUE}========================================${NC}"
echo "总测试数: $TOTAL"
echo -e "${GREEN}通过: $PASS${NC}"
echo -e "${RED}失败: $FAIL${NC}"

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ 所有测试均已通过！${NC}"
    exit 0
else
    echo -e "${RED}✗ 有 $FAIL 个测试失败${NC}"
    exit 1
fi