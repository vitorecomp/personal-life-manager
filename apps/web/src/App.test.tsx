import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('@hermes/web CSR shell', () => {
  it('renders HERMES // OS command deck placeholder', () => {
    render(<App />);
    expect(screen.getByTestId('hermes-web-shell')).toHaveTextContent('HERMES // OS');
  });
});
