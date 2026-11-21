import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  BOOT_STAGE_LABELS,
  buildGeodesicIcosphere,
  GeodesicThinkingOrb,
  HUD_RING_GLYPH_VARIANTS,
  HudRingGlyph,
  MICRO_ANIM_ICON_VARIANTS,
  MicroAnimIcon,
  MODULAR_HUD_LOADER_VARIANTS,
  ModularHudLoader,
  OrbitalBootScreen,
  SystemApertureLogo,
} from '../index';

describe('F19 & F20 — REF-10 System Aperture Logo, REF-09 Boot Astrolabe, REF-08 Thinking Orb & REF-11/12 Loaders', () => {
  it('renders <SystemApertureLogo /> with all 5 concentric layers, 24 turbine fins, 36 gear teeth, 8 shutter blades, and status iris', () => {
    const { container, rerender } = render(
      <SystemApertureLogo status="online" isThinking={false} />,
    );

    const svg = container.querySelector('[data-fui="system-aperture-logo"]') as SVGSVGElement;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 200');

    // All 5 layers present
    expect(container.querySelector('g[data-layer="1"][data-layer-name="outer-reticle"]')).toBeTruthy();
    expect(container.querySelector('g[data-layer="2"][data-layer-name="turbine-ring"]')).toBeTruthy();
    expect(container.querySelector('g[data-layer="3"][data-layer-name="gear-collar"]')).toBeTruthy();
    expect(container.querySelector('g[data-layer="4"][data-layer-name="shutter-blades"]')).toBeTruthy();
    expect(container.querySelector('g[data-layer="5"][data-layer-name="status-iris"]')).toBeTruthy();

    // Exact element counts
    expect(container.querySelectorAll('[data-turbine-fin]')).toHaveLength(24);
    expect(container.querySelectorAll('[data-gear-tooth]')).toHaveLength(36);
    expect(container.querySelectorAll('[data-shutter-blade]')).toHaveLength(8);

    // Online iris is phosphor #A8F040, resting aperture radius is 24.5
    const irisOnline = container.querySelector('[data-layer="5"]')!;
    expect(irisOnline.getAttribute('data-iris-color')).toBe('#A8F040');
    const shutterRest = container.querySelector('[data-layer="4"]')!;
    expect(shutterRest.getAttribute('data-aperture-radius')).toBe('24.5');

    // Rerender offline + thinking -> amber #F59E0B iris & dilated 29 radius
    rerender(<SystemApertureLogo status="offline" isThinking />);
    expect(container.querySelector('[data-layer="5"]')?.getAttribute('data-iris-color')).toBe('#F59E0B');
    expect(container.querySelector('[data-layer="4"]')?.getAttribute('data-aperture-radius')).toBe('29');

    // Verify prefers-reduced-motion preserves dilated state while disabling spin class
    const origMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    const { container: rmContainer } = render(<SystemApertureLogo status="syncing" isThinking />);
    const rmSvg = rmContainer.querySelector('[data-fui="system-aperture-logo"]')!;
    expect(rmSvg.getAttribute('data-reduced-motion')).toBe('true');
    const rmShutter = rmContainer.querySelector('[data-layer="4"]')!;
    expect(rmShutter.getAttribute('data-aperture-radius')).toBe('29');
    expect(rmShutter.classList.contains('fui-motion-spin')).toBe(false);

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: origMatchMedia,
    });
  });

  it('renders all 8 <HudRingGlyph /> variants from the REF-10 ring atlas', () => {
    const { container } = render(
      <div>
        {HUD_RING_GLYPH_VARIANTS.map((v) => (
          <HudRingGlyph key={v} variant={v} spinning />
        ))}
      </div>,
    );
    expect(container.querySelectorAll('[data-fui="hud-ring-glyph"]')).toHaveLength(8);
  });

  it('renders <OrbitalBootScreen /> across stages 1..3 with Morse ring, swept arcs, ◆◆ diamonds, and stage labels', () => {
    const { container, rerender } = render(<OrbitalBootScreen stage={1} fullScreen={false} />);
    expect(screen.getByTestId('boot-stage-label')).toHaveTextContent(BOOT_STAGE_LABELS[1]);
    expect(container.querySelector('[data-astrolabe-part="morse-ring"]')).toBeTruthy();
    expect(container.querySelector('[data-astrolabe-part="double-diamond"]')).toBeTruthy();
    expect(container.querySelector('[data-astrolabe-part="bracket-reticle"]')).toBeTruthy();

    rerender(<OrbitalBootScreen stage={2} gatewayMode="offline_mock" fullScreen={false} />);
    expect(screen.getByTestId('boot-stage-label')).toHaveTextContent('[2 // HERMES_GATEWAY]');
    expect(screen.getByTestId('boot-sublabel')).toHaveTextContent('OFFLINE_MOCK');

    rerender(<OrbitalBootScreen stage={3} fullScreen={false} />);
    expect(screen.getByTestId('boot-stage-label')).toHaveTextContent('[3 // READY]');
    expect(container.querySelector('[data-boot-stage-numeral="3"]')).toHaveTextContent('3');
  });

  it('builds exact 1f (12V) and 2f (42V, 120E, 80F) geodesic icosphere and illuminates active query vertices in <GeodesicThinkingOrb />', () => {
    const mesh1 = buildGeodesicIcosphere(1);
    expect(mesh1.vertices).toHaveLength(12);
    expect(mesh1.edges).toHaveLength(30);
    expect(mesh1.faces).toHaveLength(20);

    const mesh2 = buildGeodesicIcosphere(2);
    expect(mesh2.vertices).toHaveLength(42);
    expect(mesh2.edges).toHaveLength(120);
    expect(mesh2.faces).toHaveLength(80);

    const { container, rerender } = render(
      <GeodesicThinkingOrb
        subdivisions={2}
        rotationRad={0.5}
        reasoningState="thinking"
        activeQueries={[
          { id: 'q-vault', source: 'vault', vertexIndex: 3 },
          { id: 'q-mcp', source: 'mcp', vertexIndex: 17 },
        ]}
      />,
    );

    expect(container.querySelectorAll('[data-orb-vertex]')).toHaveLength(42);
    expect(container.querySelectorAll('[data-orb-edge]')).toHaveLength(120);
    expect(container.querySelectorAll('[data-orb-vertex][data-illuminated="true"]')).toHaveLength(2);
    expect(
      container.querySelector('[data-orb-vertex="3"]')?.getAttribute('data-query-source'),
    ).toBe('vault');
    expect(
      container.querySelector('[data-orb-vertex="17"]')?.getAttribute('data-query-source'),
    ).toBe('mcp');
    expect(container.querySelector('[data-orb-ring="2"]')?.getAttribute('data-ring-locked')).toBe('false');

    rerender(<GeodesicThinkingOrb subdivisions={2} rotationRad={0.5} reasoningState="complete" />);
    expect(container.querySelector('[data-orb-ring="2"]')?.getAttribute('data-ring-locked')).toBe('true');
  });

  it('renders all 4 <ModularHudLoader /> variants and all 7 <MicroAnimIcon /> variants with strict 0px border-radius', () => {
    const { container } = render(
      <div>
        {MODULAR_HUD_LOADER_VARIANTS.map((v) => (
          <ModularHudLoader key={v} variant={v} />
        ))}
        {MICRO_ANIM_ICON_VARIANTS.map((v) => (
          <MicroAnimIcon key={v} variant={v} size={20} />
        ))}
        <MicroAnimIcon variant="TIME" timeStyle="clock" size={16} />
      </div>,
    );

    expect(container.querySelectorAll('[data-fui="modular-hud-loader"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-hud-callout="true"]')).toHaveLength(4);
    const microBadges = container.querySelectorAll<HTMLElement>('[data-fui="micro-anim-icon"]');
    expect(microBadges).toHaveLength(8);
    for (const badge of Array.from(microBadges)) {
      expect(window.getComputedStyle(badge).borderRadius).toBe('0px');
    }
    expect(container.querySelector('[data-grimoire-leaf="true"]')).toBeTruthy();
  });
});
