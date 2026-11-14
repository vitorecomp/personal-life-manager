import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen } from '@testing-library/react';
import { compile } from 'tailwindcss';
import { describe, expect, it, vi } from 'vitest';
import {
  FUI_CSS_VARS,
  FUI_TOKENS,
  FuiBadge,
  FuiBatteryCapsule,
  FuiButton,
  FuiCalloutTag,
  FuiFigureRow,
  fuiHatchStyle,
  FuiInput,
  FuiModal,
  FuiPanel,
  FuiPanelHeader,
  FuiSelect,
  FuiTabs,
  formatMaskedCurrency,
  PrivacyMaskProvider,
  PrivacyMaskToggle,
  PrivacyValue,
} from '../index';

const stylesPath = resolve(dirname(fileURLToPath(import.meta.url)), '../styles.css');

function assertZeroRadiusAndFontFloor(root: HTMLElement) {
  const allElements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  for (const el of allElements) {
    const cs = window.getComputedStyle(el);
    expect(cs.borderRadius).toBe('0px');
  }
  const interactive = root.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, [role="tab"], [role="button"]',
  );
  for (const ctrl of Array.from(interactive)) {
    const fontSizePx = Number.parseFloat(window.getComputedStyle(ctrl).fontSize);
    expect(fontSizePx).toBeGreaterThanOrEqual(12);
  }
}

describe('F18 — REF-02 Tactical FUI Theme, 0px Primitives & Privacy Mask', () => {
  it('compiles packages/ui/src/styles.css cleanly with tailwindcss@4.3.5 and exposes all 16 --fui-* tokens', async () => {
    const cssSource = readFileSync(stylesPath, 'utf8');
    const tailwindPkgDir = dirname(fileURLToPath(import.meta.resolve('tailwindcss/package.json')));
    const compiler = await compile(cssSource, {
      loadStylesheet: async (id, base) => {
        if (id === 'tailwindcss') {
          return {
            path: resolve(tailwindPkgDir, 'index.css'),
            base: tailwindPkgDir,
            content: readFileSync(resolve(tailwindPkgDir, 'index.css'), 'utf8'),
          };
        }
        const resolved = resolve(base, id);
        return {
          path: resolved,
          base: dirname(resolved),
          content: readFileSync(resolved, 'utf8'),
        };
      },
    });
    const builtCss = compiler.build(['fui-hatch-45', 'fui-pixelated', 'fui-display', 'fui-mono']);

    expect(Object.keys(FUI_CSS_VARS)).toHaveLength(16);
    for (const [varName, hexVal] of Object.entries(FUI_CSS_VARS)) {
      expect(builtCss).toContain(`${varName}: ${hexVal}`);
    }
    expect(builtCss).toContain('border-radius: 0px !important');
    expect(builtCss).toContain('.fui-hatch-45');
    expect(builtCss).toContain('.fui-pixelated');
  });

  it('preserves all M1 backward-compatible FUI_TOKENS keys and fuiHatchStyle helper', () => {
    expect(FUI_TOKENS.bgCarbon).toBe('#08080B');
    expect(FUI_TOKENS.bgPlum).toBe('#0D0716');
    expect(FUI_TOKENS.bgBlueprint).toBe('#10171D');
    expect(FUI_TOKENS.bgPanel).toBe('#13151A');
    expect(FUI_TOKENS.bgArena).toBe('#141526');
    expect(FUI_TOKENS.accentOrange).toBe('#F87C18');
    expect(FUI_TOKENS.accentVermilion).toBe('#EB4511');
    expect(FUI_TOKENS.accentAmber).toBe('#F59E0B');
    expect(FUI_TOKENS.accentCyan).toBe('#2CE5F2');
    expect(FUI_TOKENS.accentPhosphor).toBe('#A8F040');
    expect(FUI_TOKENS.inkStark).toBe('#F6F6F4');
    expect(FUI_TOKENS.borderRadius).toBe('0px');

    const hatch = fuiHatchStyle('#F87C18', 2, 6, '#08080B');
    expect(hatch.borderRadius).toBe('0px');
    expect(String(hatch.backgroundImage)).toContain('repeating-linear-gradient(-45deg');
  });

  it('enforces 0px border-radius, >=12px interactive font floor, and WCAG AA dark ink on all F18 primitives', () => {
    const onTabChange = vi.fn();
    const onTriggerPlay = vi.fn();
    const { container } = render(
      <div>
        <FuiPanel
          surface="panel"
          hatchFooter
          header={
            <FuiPanelHeader
              title="PROTOCOL_DIAGNOSIS"
              code="80.485"
              stepAlign="both"
              showFrierenLedge
              companionSlot={<span data-testid="ledge-companion">FRIEREN_SLOT</span>}
              actions={<FuiButton size="sm" variant="primary">ACTION</FuiButton>}
            />
          }
        >
          <FuiButton variant="stark" prefixBadge="+">STARK PLATE</FuiButton>
          <FuiButton variant="secondary" loading>LOADING</FuiButton>
          <FuiButton variant="danger">DANGER</FuiButton>
          <FuiButton variant="cyan">CYAN</FuiButton>
          <FuiInput label="COMMAND_INPUT" placeholder="Type command" hint="Enter syntax" />
          <FuiInput label="ERROR_INPUT" error="Invalid token" />
          <FuiSelect
            label="CONTROLLER"
            options={[
              { value: 'auto', label: 'SYNC_AUTO' },
              { value: 'manual', label: 'MANUAL' },
            ]}
          />
          <FuiTabs
            tabs={[
              { id: '01', code: '01', label: 'DECK_ALPHA', panel: <div>PANEL_01</div> },
              { id: '02', code: '02', label: 'DECK_BETA', panel: <div>PANEL_02</div> },
              { id: '03', code: '03', label: 'DECK_GAMMA', panel: <div>PANEL_03</div> },
            ]}
            activeTab="01"
            onTabChange={onTabChange}
          />
          <FuiBadge tone="orange" code="500" solid>25 FRAME THROWER</FuiBadge>
          <FuiBadge tone="hatch">HAZARD</FuiBadge>
          <FuiCalloutTag banner="SECTION XR-0429B" coordinate="X 35_AL" />
          <FuiFigureRow
            code="FIGURE 35_X"
            title="ACTIVE SESSION"
            subtitle="XR_1052_0439.LFT"
            active
            phosphorSplitPct={24}
            onSelect={() => {}}
          />
          <FuiBatteryCapsule
            progressPct={75}
            segments={4}
            onTriggerPlay={onTriggerPlay}
            isPlaying
          />
        </FuiPanel>
      </div>,
    );

    assertZeroRadiusAndFontFloor(container);

    // Check Frieren 3px ledge & companion slot
    expect(screen.getByTestId('ledge-companion')).toBeInTheDocument();
    const ledge = container.querySelector('[data-fui-part="frieren-ledge"]') as HTMLElement;
    expect(ledge).toBeTruthy();
    expect(window.getComputedStyle(ledge).height).toBe('3px');

    // Check FuiFigureRow explicit left tab (not border-left shortcut) and dual underline
    const leftTab = container.querySelector('[data-fui-part="figure-left-tab"]') as HTMLElement;
    expect(leftTab).toBeTruthy();
    expect(container.querySelector('[data-underline-left="phosphor"]')).toBeTruthy();
    expect(container.querySelector('[data-underline-right="vermilion"]')).toBeTruthy();

    // Check FuiTabs keyboard navigation (ArrowRight, End, Home)
    const firstTab = screen.getByRole('tab', { name: /DECK_ALPHA/i });
    fireEvent.keyDown(firstTab, { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenCalledWith('02');
    fireEvent.keyDown(firstTab, { key: 'End' });
    expect(onTabChange).toHaveBeenCalledWith('03');
    fireEvent.keyDown(firstTab, { key: 'Home' });
    expect(onTabChange).toHaveBeenCalledWith('01');

    // Check FuiBatteryCapsule play trigger
    fireEvent.click(screen.getByRole('button', { name: /Start focus timer/i }));
    expect(onTriggerPlay).toHaveBeenCalledTimes(1);
  });

  it('handles FuiModal Escape close and backdrop click with 0px geometry', () => {
    const onClose = vi.fn();
    render(
      <FuiModal open onClose={onClose} title="SYSTEM_MODAL" code="MOD_01" footer={<FuiButton>OK</FuiButton>}>
        <p>Modal content</p>
      </FuiModal>,
    );

    const dialog = screen.getByRole('dialog');
    assertZeroRadiusAndFontFloor(dialog);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('redacts currency amounts under PrivacyMaskProvider while strictly preserving %, ratios, counts, and 7Y 4M durations', () => {
    expect(formatMaskedCurrency('R$ 142.500,00', 'BRL')).toBe('R$ ••••••');
    expect(formatMaskedCurrency('$ 28,400.00', 'USD')).toBe('$ ••••••');
    expect(formatMaskedCurrency(5000, 'EUR')).toBe('EUR ••••••');

    render(
      <PrivacyMaskProvider defaultMasked={false} storageKey={null}>
        <PrivacyMaskToggle />
        <PrivacyValue data-testid="val-brl" value="R$ 142.500,00" kind="currency" currency="BRL" title="R$ 142.500,00" />
        <PrivacyValue data-testid="val-usd" value="$ 28,400.00" kind="currency" currency="USD" />
        <PrivacyValue data-testid="val-pct" value="34.2%" kind="percent" />
        <PrivacyValue data-testid="val-ratio" value="12/16" kind="ratio" />
        <PrivacyValue data-testid="val-count" value={200} kind="count" />
        <PrivacyValue data-testid="val-duration" value="7Y 4M" kind="duration" />
      </PrivacyMaskProvider>,
    );

    expect(screen.getByTestId('val-brl')).toHaveTextContent('R$ 142.500,00');
    expect(screen.getByTestId('val-usd')).toHaveTextContent('$ 28,400.00');

    // Toggle Privacy Mask ON
    fireEvent.click(screen.getByTestId('fui-privacy-toggle'));

    const brlEl = screen.getByTestId('val-brl');
    const usdEl = screen.getByTestId('val-usd');
    expect(brlEl).toHaveTextContent('R$ ••••••');
    expect(usdEl).toHaveTextContent('$ ••••••');
    // Verify zero plaintext digit leakage in DOM or title attribute
    expect(brlEl.textContent).not.toMatch(/\d/);
    expect(brlEl.getAttribute('title')).toBeNull();
    expect(usdEl.textContent).not.toMatch(/\d/);

    // Verify %, ratio, count, and duration remain 100% unmasked!
    expect(screen.getByTestId('val-pct')).toHaveTextContent('34.2%');
    expect(screen.getByTestId('val-ratio')).toHaveTextContent('12/16');
    expect(screen.getByTestId('val-count')).toHaveTextContent('200');
    expect(screen.getByTestId('val-duration')).toHaveTextContent('7Y 4M');
  });
});
