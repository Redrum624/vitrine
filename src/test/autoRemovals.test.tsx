// src/test/autoRemovals.test.tsx
/**
 * v1.37.0 Task R1 — removal tripwires for the user-approved D1-D3 decisions
 * (2026-07-20). Driving complaint: "'Tone Curve' auto apply sometimes" — Auto
 * All wrote the style-profile curve (identity below 0.15 tonal span = the
 * "sometimes"), and the Adjust-menu "Auto Levels" item was mislabeled (it
 * applied that same curve, not the panel's histogram-stretch Auto Levels).
 *
 *   D1 — Auto Tone Curve removed EVERYWHERE (service method, autoAll bundle,
 *        panel ⚡ Auto, mislabeled menu item).
 *   D2 — Auto Color Balance removed on all three surfaces (service method,
 *        autoAll bundle, card Auto); the menu item keeps its WB half only,
 *        renamed "Auto White Balance".
 *   D3 — the "Styled" toolbar chip removed (with D1+D2 gone it can never light).
 *
 * These assert the NEW surface — every test here FAILS on the pre-R1 tree.
 * The panel's real Auto Levels/Contrast checkboxes (histogram stretch,
 * ToneCurveModule params) are DISTINCT surviving features, asserted untouched.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { autoAdjustService } from '../services/AutoAdjustService';
import { userStyleProfile } from '../services/UserStyleProfile';
import { ToneCurveModule } from '../modules/ToneCurveModule';
import { ColorBalanceModule } from '../modules/ColorBalanceModule';
import { ToneCurveModuleComponent } from '../components/Modules/ToneCurveModuleComponent';
import { ColorBalanceModuleComponent } from '../components/Modules/ColorBalanceModuleComponent';
import { MenuBar } from '../components/Layout/MenuBar';
import { Toolbar } from '../components/Layout/Toolbar';
import { createTestImage } from './testUtils';
import type { ModuleCardActions } from '../components/Controls/moduleCardActions';

// The Toolbar renders an empty shell outside Electron (jsdom) — pretend we are in it.
jest.mock('../services/ElectronService', () => ({
  electronService: { isElectron: () => true, openFile: jest.fn() },
}));

const W = 64;
const H = 48;

describe('D1/D2 — AutoAdjustService surface (no tone-curve / color-balance autos)', () => {
  const svc = autoAdjustService as unknown as Record<string, unknown>;

  it('autoToneCurve no longer exists on the service', () => {
    expect(svc.autoToneCurve).toBeUndefined();
  });

  it('autoColorBalance no longer exists on the service', () => {
    expect(svc.autoColorBalance).toBeUndefined();
  });

  it('autoAll bundle carries NO toneCurve / colorBalance keys (full strength)', () => {
    const data = createTestImage(W, H, 0.65, 0.45, 0.3); // warm, mid-dark
    const result = autoAdjustService.autoAll(data, W, H) as unknown as Record<string, unknown>;
    expect('toneCurve' in result).toBe(false);
    expect('colorBalance' in result).toBe(false);
    // The surviving composition (v1.37.0 R2): ONE standalone Basic-Adj bundle.
    expect(result.basicAdj).toBeDefined();
  });

  it('autoAll bundle carries NO toneCurve / colorBalance keys (scaled strength path)', () => {
    const data = createTestImage(W, H, 0.65, 0.45, 0.3);
    const result = autoAdjustService.autoAll(data, W, H, { strength: 0.5 }) as unknown as Record<string, unknown>;
    expect('toneCurve' in result).toBe(false);
    expect('colorBalance' in result).toBe(false);
  });

  it('UserStyleProfile buckets no longer carry the (now unread) toneCurveShape field', () => {
    for (const profile of Object.values(userStyleProfile)) {
      expect('toneCurveShape' in (profile as unknown as Record<string, unknown>)).toBe(false);
    }
  });
});

describe('D1 — Tone Curve panel registers Reset only (no ⚡ Auto)', () => {
  it('registers no auto action on the module card header', () => {
    let actions: ModuleCardActions | null = null;
    render(
      <ToneCurveModuleComponent
        module={new ToneCurveModule()}
        onParamsChange={jest.fn()}
        onRegisterActions={(a) => { actions = a; }}
      />
    );
    expect(actions).not.toBeNull();
    expect(actions!.auto).toBeUndefined();
    expect(typeof actions!.reset).toBe('function');
  });

  it('keeps the DISTINCT panel Auto Levels surfaces (histogram stretch stays)', () => {
    render(
      <ToneCurveModuleComponent module={new ToneCurveModule()} onParamsChange={jest.fn()} />
    );
    // The inner "Auto Levels" button and the advanced checkbox are surviving features.
    expect(screen.getAllByText('Auto Levels').length).toBeGreaterThanOrEqual(1);
  });
});

describe('D2 — Color Balance card registers Reset only (no ⚡ Auto)', () => {
  it('registers no auto action on the module card header', () => {
    let actions: ModuleCardActions | null = null;
    render(
      <ColorBalanceModuleComponent
        module={new ColorBalanceModule()}
        onParamsChange={jest.fn()}
        onRegisterActions={(a) => { actions = a; }}
      />
    );
    expect(actions).not.toBeNull();
    expect(actions!.auto).toBeUndefined();
    expect(typeof actions!.reset).toBe('function');
  });
});

describe('D1/D2 — Adjust menu surface', () => {
  const openAdjustMenu = () => {
    render(<MenuBar hasImage onAutoWhiteBalance={jest.fn()} />);
    fireEvent.click(screen.getByText('Adjust'));
  };

  it('has NO "Auto Levels" item (it was mislabeled — it applied the style curve)', () => {
    openAdjustMenu();
    expect(screen.queryByText('Auto Levels')).toBeNull();
  });

  it('has NO "Auto Color" item — replaced by "Auto White Balance" (WB half kept)', () => {
    openAdjustMenu();
    expect(screen.queryByText('Auto Color')).toBeNull();
    expect(screen.getByText('Auto White Balance')).toBeInTheDocument();
  });

  it('keeps Auto Contrast and fires the renamed Auto White Balance handler', () => {
    const onAutoWhiteBalance = jest.fn();
    render(<MenuBar hasImage onAutoContrast={jest.fn()} onAutoWhiteBalance={onAutoWhiteBalance} />);
    fireEvent.click(screen.getByText('Adjust'));
    expect(screen.getByText('Auto Contrast')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Auto White Balance'));
    expect(onAutoWhiteBalance).toHaveBeenCalledTimes(1);
  });
});

describe('D3 — "Styled" toolbar chip removed', () => {
  it('never renders the chip, even if a stale styleGradeActive prop is forced through', () => {
    // Force the old prop through an untyped spread: on the pre-R1 tree this
    // rendered the chip; post-R1 the Toolbar has no such prop and no chip code.
    const staleProps = { styleGradeActive: true } as Record<string, unknown>;
    render(<Toolbar hasImage {...staleProps} />);
    expect(screen.queryByText('Styled')).toBeNull();
  });

  it('keeps the Auto All primary clickable', () => {
    const onAutoAll = jest.fn();
    render(<Toolbar hasImage onAutoAll={onAutoAll} />);
    fireEvent.click(screen.getByRole('button', { name: /auto all/i }));
    expect(onAutoAll).toHaveBeenCalledTimes(1);
  });
});
