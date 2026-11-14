import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ALLOWED_MOBILE_SURFACES, App } from './App';

describe('@hermes/mobile strict scope contract', () => {
  it('exposes strictly ROUTINES, TODOS, COMPANION, and UPLINK_CONFIG surfaces', () => {
    expect(ALLOWED_MOBILE_SURFACES).toEqual([
      'ROUTINES',
      'TODOS',
      'COMPANION',
      'UPLINK_CONFIG',
    ]);
    render(<App />);
    expect(screen.getByTestId('hermes-mobile-shell')).toHaveTextContent('HERMES COMPANION // ROUTINES');
  });
});
