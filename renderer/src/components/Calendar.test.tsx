import { describe, it, expect } from 'vitest';
import Calendar from './Calendar';

describe('Calendar Component', () => {
	it('renders correctly', () => {
		const { container } = render(<Calendar />);
		expect(container).toBeInTheDocument();
	});
});