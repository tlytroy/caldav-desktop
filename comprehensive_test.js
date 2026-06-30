#!/usr/bin/env node

const axios = require('axios');

// 配置
const BASE_URL = 'http://localhost:3001';
const API_BASE = `${BASE_URL}/api/calendar`;

// 创建 axios 实例
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
});

// 颜色定义
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m'
};

// 测试计数器
let passCount = 0;
let failCount = 0;
let totalCount = 0;

// 测试函数
async function test(name, fn) {
  totalCount++;
  try {
    console.log(`${colors.blue}测试 ${totalCount}: ${name}${colors.reset}`);
    await fn();
    console.log(`${colors.green}✓ PASS${colors.reset}\n`);
    passCount++;
  } catch (error) {
    console.log(`${colors.red}✗ FAIL${colors.reset} - ${error.message}\n`);
    failCount++;
  }
}

// 获取日历列表
async function getCalendars() {
  const response = await api.get('/api/calendar/calendars');
  return response.data;
}

// 创建事件
async function createEvent(calendarUrl, eventData) {
  const response = await api.post('/api/calendar/events', {
    ...eventData,
    calendarUrl
  });
  return response.data;
}

// 获取事件
async function getEvents(calendarUrl, start, end) {
  const response = await api.get('/api/calendar/events', {
    params: {
      calendarUrl,
      start: start.toISOString(),
      end: end.toISOString()
    }
  });
  return response.data;
}

// 更新事件
async function updateEvent(eventId, calendarUrl, eventData) {
  const response = await api.put(`/api/calendar/events/${eventId}`, {
    ...eventData,
    calendarUrl
  });
  return response.data;
}

// 删除事件
async function deleteEvent(eventId, calendarUrl) {
  const response = await api.delete(`/api/calendar/events/${eventId}`, {
    params: { calendarUrl }
  });
  return response.data;
}

// 测试配置功能
async function testConfig() {
  // 获取当前配置
  const configResponse = await api.get('/api/calendar/config');
  console.log('当前配置:', configResponse.data);

  // 测试连接
  const testResponse = await api.post('/api/calendar/config/test', {
    url: configResponse.data.url,
    username: configResponse.data.username,
    password: process.env.CALDAV_PASS
  });
  console.log('连接测试结果:', testResponse.data);
}

// 主测试函数
async function runTests() {
  console.log(`${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.cyan}Radicale Desktop Calendar 综合功能测试${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}\n`);

  try {
    // 1. 测试配置功能
    await test('配置管理功能', async () => {
      await testConfig();
    });

    // 2. 获取日历列表
    let calendarUrl;
    await test('获取日历列表', async () => {
      const calendars = await getCalendars();
      if (!Array.isArray(calendars) || calendars.length === 0) {
        throw new Error('未能获取到日历列表');
      }
      calendarUrl = calendars[0].url;
      console.log(`使用日历URL: ${calendarUrl}`);
    });

    if (!calendarUrl) {
      throw new Error('无法获取日历URL，终止测试');
    }

    // 3. 测试基本事件CRUD操作
    let eventId;
    await test('创建基础事件', async () => {
      const eventData = {
        title: '测试事件 - 基础功能测试',
        start: new Date(Date.now() + 3600000).toISOString(), // 1小时后
        end: new Date(Date.now() + 7200000).toISOString(),   // 2小时后
        allDay: false,
        description: '这是一个用于测试的基础事件'
      };

      const result = await createEvent(calendarUrl, eventData);
      if (!result.uid) {
        throw new Error('创建事件失败，未返回事件ID');
      }
      eventId = result.uid;
      console.log(`创建的事件ID: ${eventId}`);
    });

    await test('获取事件列表', async () => {
      const start = new Date();
      const end = new Date(Date.now() + 7 * 24 * 3600000); // 7天后
      const events = await getEvents(calendarUrl, start, end);
      console.log(`找到 ${events.length} 个事件`);

      // 检查刚刚创建的事件是否存在
      const createdEvent = events.find(e => e.uid === eventId);
      if (!createdEvent) {
        throw new Error('未能在事件列表中找到刚创建的事件');
      }
    });

    await test('更新事件', async () => {
      if (!eventId) {
        throw new Error('没有事件ID可用于更新');
      }

      const updatedEventData = {
        title: '更新后的测试事件',
        start: new Date(Date.now() + 3600000).toISOString(),
        end: new Date(Date.now() + 7200000).toISOString(),
        allDay: false,
        description: '这是一个更新后的测试事件'
      };

      const result = await updateEvent(eventId, calendarUrl, updatedEventData);
      console.log('事件更新成功');
    });

    // 4. 测试分类功能
    await test('创建带分类的事件', async () => {
      const eventData = {
        title: '工作事件 - 分类测试',
        start: new Date(Date.now() + 10800000).toISOString(), // 3小时后
        end: new Date(Date.now() + 14400000).toISOString(),   // 4小时后
        allDay: false,
        description: '这是一个带分类的测试事件',
        category: {
          id: 'work',
          name: 'Work',
          color: '#3b82f6'
        }
      };

      const result = await createEvent(calendarUrl, eventData);
      console.log(`创建带分类的事件ID: ${result.uid}`);
    });

    // 5. 测试标签功能
    await test('创建带标签的事件', async () => {
      const eventData = {
        title: '重要事件 - 标签测试',
        start: new Date(Date.now() + 18000000).toISOString(), // 5小时后
        end: new Date(Date.now() + 21600000).toISOString(),   // 6小时后
        allDay: false,
        description: '这是一个带标签的测试事件',
        tags: [
          {
            id: 'important',
            name: 'Important',
            color: '#ef4444'
          },
          {
            id: 'urgent',
            name: 'Urgent',
            color: '#f97316'
          }
        ]
      };

      const result = await createEvent(calendarUrl, eventData);
      console.log(`创建带标签的事件ID: ${result.uid}`);
    });

    // 6. 测试重复事件功能
    await test('创建重复事件', async () => {
      const eventData = {
        title: '每日会议 - 重复事件测试',
        start: new Date(Date.now() + 25200000).toISOString(), // 7小时后
        end: new Date(Date.now() + 28800000).toISOString(),   // 8小时后
        allDay: false,
        description: '这是一个重复事件测试',
        recurrence: {
          frequency: 'daily',
          interval: 1
        }
      };

      const result = await createEvent(calendarUrl, eventData);
      console.log(`创建重复事件ID: ${result.uid}`);
    });

    // 7. 测试全天事件功能
    await test('创建全天事件', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const endOfDay = new Date(tomorrow);
      endOfDay.setHours(23, 59, 59, 999);

      const eventData = {
        title: '全天会议 - 全天事件测试',
        start: tomorrow.toISOString(),
        end: endOfDay.toISOString(),
        allDay: true,
        description: '这是一个全天事件测试'
      };

      const result = await createEvent(calendarUrl, eventData);
      console.log(`创建全天事件ID: ${result.uid}`);
    });

    // 8. 测试复杂事件（包含分类、标签和重复规则）
    await test('创建复杂事件', async () => {
      const eventData = {
        title: '复杂事件 - 综合测试',
        start: new Date(Date.now() + 86400000).toISOString(), // 24小时后
        end: new Date(Date.now() + 90000000).toISOString(),   // 25小时后
        allDay: false,
        description: '这是一个复杂的事件，包含分类、标签和重复规则',
        category: {
          id: 'personal',
          name: 'Personal',
          color: '#10b981'
        },
        tags: [
          {
            id: 'important',
            name: 'Important',
            color: '#ef4444'
          }
        ],
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          endDate: new Date(Date.now() + 30 * 86400000).toISOString() // 30天后结束
        }
      };

      const result = await createEvent(calendarUrl, eventData);
      console.log(`创建复杂事件ID: ${result.uid}`);
    });

    // 9. 测试事件删除功能
    await test('删除事件', async () => {
      if (!eventId) {
        throw new Error('没有事件ID可用于删除');
      }

      const result = await deleteEvent(eventId, calendarUrl);
      console.log('事件删除成功');
    });

  } catch (error) {
    console.error(`${colors.red}测试过程中发生错误:${colors.reset}`, error.message);
    failCount++;
  }

  // 输出测试总结
  console.log(`${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.cyan}测试总结${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}`);
  console.log(`总测试数: ${totalCount}`);
  console.log(`${colors.green}通过: ${passCount}${colors.reset}`);
  console.log(`${colors.red}失败: ${failCount}${colors.reset}`);

  if (failCount === 0) {
    console.log(`${colors.green}✓ 所有测试均已通过！${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`${colors.red}✗ 有 ${failCount} 个测试失败${colors.reset}`);
    process.exit(1);
  }
}

// 运行测试
runTests().catch(error => {
  console.error(`${colors.red}测试执行失败:${colors.reset}`, error);
  process.exit(1);
});