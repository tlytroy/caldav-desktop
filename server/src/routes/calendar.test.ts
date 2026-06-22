import { describe, it, expect } from 'vitest';

describe('日历相关路由测试', () => {
    it('应该返回正确的日历数据', async () => {
        const response = await fetch('/api/calendar');
        const data = await response.json();
        expect(response.status).toBe(200);
        expect(data).toHaveProperty('events');
    });
});