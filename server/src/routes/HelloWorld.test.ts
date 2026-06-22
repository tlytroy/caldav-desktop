import { describe, it, expect } from 'vitest';

describe('HelloWorld Route', () => {
    it('should respond with a 200 status', async () => {
        const response = await fetch('/api/helloworld');
        expect(response.status).toBe(200);
    });

    it('should return the correct message', async () => {
        const response = await fetch('/api/helloworld');
        const data = await response.json();
        expect(data.message).toBe('Hello, World!');
    });
});