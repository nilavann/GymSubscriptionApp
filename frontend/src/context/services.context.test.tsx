import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ServicesProvider, useServices, type Services } from './services.context';
import { planService } from '../services/plan.service';
import { memberRepository } from '../repositories/member.repository';
import { fakeServices } from '../test/fakes';

function wrapperFor(services?: Partial<Services>) {
  return ({ children }: { children: ReactNode }) => <ServicesProvider services={services}>{children}</ServicesProvider>;
}

describe('ServicesProvider / useServices', () => {
  it('provides the real services when no override is given (what the app itself does)', () => {
    const { result } = renderHook(() => useServices(), { wrapper: wrapperFor() });
    expect(result.current.planService).toBe(planService);
    expect(result.current.memberRepository).toBe(memberRepository);
  });

  it('falls back to the real services outside any provider', () => {
    const { result } = renderHook(() => useServices());
    expect(result.current.planService).toBe(planService);
  });

  it('merges overrides over the real services — the test seam', () => {
    const getById = vi.fn();
    const services = fakeServices({ memberRepository: { getById } });
    const { result } = renderHook(() => useServices(), { wrapper: wrapperFor(services) });
    expect(result.current.memberRepository.getById).toBe(getById);
  });

  it('keeps the same context value across re-renders while the overrides object is unchanged', () => {
    const services = fakeServices();
    const { result, rerender } = renderHook(() => useServices(), { wrapper: wrapperFor(services) });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('fakeServices', () => {
  it('fails loudly, naming the call, when code reaches an un-faked method', () => {
    const services = fakeServices();
    expect(() => services.memberRepository.getById(1)).toThrow(/Unexpected call: memberRepository\.getById\(\)/);
  });

  it('does not look like a thenable (so `await fakeThing` cannot hang)', () => {
    const services = fakeServices();
    expect((services.memberRepository as unknown as { then?: unknown }).then).toBeUndefined();
  });
});
