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
test_api() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    local expected_status=$5

    TOTAL=$((TOTAL + 1))

    echo -e "${BLUE}测试 $TOTAL: $name${NC}"

    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" -X GET "http://localhost:3001$endpoint")
    elif [ "$method" = "POST" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:3001$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    elif [ "$method" = "PUT" ]; then
        response=$(curl -s -w "\n%{http_code}" -X PUT "http://localhost:3001$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    elif [ "$method" = "DELETE" ]; then
        response=$(curl -s -w "\n%{http_code}" -X DELETE "http://localhost:3001$endpoint")
    fi

    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$status_code" = "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC} - Status: $status_code"
        PASS=$((PASS + 1))
        # 返回响应体以供后续测试使用
        echo "$body"
    else
        echo -e "${RED}✗ FAIL${NC} - Expected: $expected_status, Got: $status_code"
        echo "Response: $body"
        FAIL=$((FAIL + 1))
    fi
    echo ""
}

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Radicale Desktop Calendar 功能测试${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 1. 测试日历列表
echo -e "${YELLOW}--- 1. 日历相关测试 ---${NC}"
test_api "获取日历列表" "GET" "/api/calendar/calendars" "" "200"

# 获取第一个日历的URL
calendar_url=$(curl -s http://localhost:3001/api/calendar/calendars | grep -oP '"url":"[^"]*' | head -1 | cut -d'"' -f4)
echo "使用日历URL: $calendar_url"
echo ""

# 2. 测试事件CRUD操作
echo -e "${YELLOW}--- 2. 事件CRUD操作测试 ---${NC}"

# 创建事件
echo "创建基础事件..."
create_event=$(cat <<EOF
{
  "title": "测试事件",
  "start": "2026-06-22T10:00:00.000Z",
  "end": "2026-06-22T11:00:00.000Z",
  "allDay": false,
  "description": "这是一个测试事件"
}
EOF
)

event_response=$(test_api "创建事件" "POST" "/api/calendar/events?calendarUrl=$(echo $calendar_url | sed 's|/|%2F|g')" "$create_event" "201")

# 从响应中提取事件ID
event_id=$(echo "$event_response" | grep -oP '"uid":"[^"]*' | head -1 | cut -d'"' -f4)
echo "创建的事件ID: $event_id"
echo ""

# 获取事件列表
echo "获取事件列表..."
test_api "获取事件列表" "GET" "/api/calendar/events?start=2026-06-22T00:00:00.000Z&end=2026-06-23T00:00:00.000Z&calendarUrl=$(echo $calendar_url | sed 's|/|%2F|g')" "" "200"
echo ""

# 3. 测试分类功能
echo -e "${YELLOW}--- 3. 分类功能测试 ---${NC}"

create_event_with_category=$(cat <<EOF
{
  "title": "工作事件",
  "start": "2026-06-22T14:00:00.000Z",
  "end": "2026-06-22T15:00:00.000Z",
  "allDay": false,
  "category": {
    "id": "work",
    "name": "Work",
    "color": "#3b82f6"
  }
}
EOF
)

test_api "创建带分类的事件" "POST" "/api/calendar/events?calendarUrl=$(echo $calendar_url | sed 's|/|%2F|g')" "$create_event_with_category" "201"
echo ""

# 4. 测试标签功能
echo -e "${YELLOW}--- 4. 标签功能测试 ---${NC}"

create_event_with_tags=$(cat <<EOF
{
  "title": "重要事件",
  "start": "2026-06-22T16:00:00.000Z",
  "end": "2026-06-22T17:00:00.000Z",
  "allDay": false,
  "tags": [
    {
      "id": "important",
      "name": "Important",
      "color": "#ef4444"
    },
    {
      "id": "urgent",
      "name": "Urgent",
      "color": "#f97316"
    }
  ]
}
EOF
)

test_api "创建带标签的事件" "POST" "/api/calendar/events?calendarUrl=$(echo $calendar_url | sed 's|/|%2F|g')" "$create_event_with_tags" "201"
echo ""

# 5. 测试重复事件
echo -e "${YELLOW}--- 5. 重复事件功能测试 ---${NC}"

create_recurring_event=$(cat <<EOF
{
  "title": "每日会议",
  "start": "2026-06-22T09:00:00.000Z",
  "end": "2026-06-22T10:00:00.000Z",
  "allDay": false,
  "recurrence": {
    "frequency": "daily",
    "interval": 1
  }
}
EOF
)

test_api "创建重复事件" "POST" "/api/calendar/events?calendarUrl=$(echo $calendar_url | sed 's|/|%2F|g')" "$create_recurring_event" "201"
echo ""

# 6. 测试全天事件
echo -e "${YELLOW}--- 6. 全天事件功能测试 ---${NC}"

create_allday_event=$(cat <<EOF
{
  "title": "全天会议",
  "start": "2026-06-22T00:00:00.000Z",
  "end": "2026-06-22T23:59:59.000Z",
  "allDay": true,
  "description": "全天事件测试"
}
EOF
)

test_api "创建全天事件" "POST" "/api/calendar/events?calendarUrl=$(echo $calendar_url | sed 's|/|%2F|g')" "$create_allday_event" "201"
echo ""

# 7. 测试事件更新
echo -e "${YELLOW}--- 7. 事件更新功能测试 ---${NC}"

if [ -n "$event_id" ]; then
    update_event=$(cat <<EOF
{
  "title": "更新的测试事件",
  "start": "2026-06-22T10:30:00.000Z",
  "end": "2026-06-22T11:30:00.000Z",
  "allDay": false,
  "description": "这是一个更新的测试事件"
}
EOF
)

    test_api "更新事件" "PUT" "/api/calendar/events/$event_id?calendarUrl=$(echo $calendar_url | sed 's|/|%2F|g')" "$update_event" "200"
fi
echo ""

# 8. 测试事件删除
echo -e "${YELLOW}--- 8. 事件删除功能测试 ---${NC}"

if [ -n "$event_id" ]; then
    test_api "删除事件" "DELETE" "/api/calendar/events/$event_id?calendarUrl=$(echo $calendar_url | sed 's|/|%2F|g')" "" "200"
fi
echo ""

# 9. 测试复杂场景
echo -e "${YELLOW}--- 9. 复杂场景测试 ---${NC}"

complex_event=$(cat <<EOF
{
  "title": "复杂事件",
  "start": "2026-06-23T10:00:00.000Z",
  "end": "2026-06-23T12:00:00.000Z",
  "allDay": false,
  "description": "这是一个复杂的事件，包含分类、标签和重复规则",
  "category": {
    "id": "personal",
    "name": "Personal",
    "color": "#10b981"
  },
  "tags": [
    {
      "id": "important",
      "name": "Important",
      "color": "#ef4444"
    }
  ],
  "recurrence": {
    "frequency": "weekly",
    "interval": 1,
    "endDate": "2026-07-30"
  }
}
EOF
)

test_api "创建复杂事件" "POST" "/api/calendar/events?calendarUrl=$(echo $calendar_url | sed 's|/|%2F|g')" "$complex_event" "201"
echo ""

# 测试摘要
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
