import { render, screen } from '@testing-library/react';
import HelloWorld from './HelloWorld';

test('renders HelloWorld component', () => {
  render(<HelloWorld />);
  const linkElement = screen.getByText(/hello world/i);
  expect(linkElement).toBeInTheDocument();
});