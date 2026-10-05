import { describe, expect, it } from 'vitest';
import { shouldHideTabBar } from './route-handle';

describe('shouldHideTabBar', () => {
  it('is false when no matched route has a handle', () => {
    expect(shouldHideTabBar([{}, { handle: undefined }])).toBe(false);
  });

  it('is false for a handle that does not mention the tab bar', () => {
    expect(shouldHideTabBar([{ handle: { somethingElse: true } }])).toBe(false);
  });

  it('is true when the leaf route asks to hide it', () => {
    expect(shouldHideTabBar([{}, { handle: { hideTabBar: true } }])).toBe(true);
  });

  it('is true when a PARENT layout route asks to hide it, so a whole subtree can opt out', () => {
    expect(shouldHideTabBar([{ handle: { hideTabBar: true } }, {}])).toBe(true);
  });

  it('only an explicit `true` hides it', () => {
    expect(shouldHideTabBar([{ handle: { hideTabBar: false } }])).toBe(false);
    expect(shouldHideTabBar([{ handle: { hideTabBar: 'yes' } }])).toBe(false);
  });

  it('copes with an empty match list', () => {
    expect(shouldHideTabBar([])).toBe(false);
  });
});
