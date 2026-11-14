import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FUI_TOKENS } from './index';

describe('@hermes/ui foundation tokens', () => {
  it('enforces REF-02 Tactical FUI hex palette and 0px corner law', () => {
    expect(FUI_TOKENS.bgCarbon).toBe('#08080B');
    expect(FUI_TOKENS.accentOrange).toBe('#F87C18');
    expect(FUI_TOKENS.inkStark).toBe('#F6F6F4');
    expect(FUI_TOKENS.borderRadius).toBe('0px');

    render(<div data-testid="fui-probe">HERMES // UI</div>);
    expect(screen.getByTestId('fui-probe')).toHaveTextContent('HERMES // UI');
  });
});
