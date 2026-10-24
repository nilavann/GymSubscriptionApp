import type { Services } from '../context/services.context';

/**
 * A fake for one service/repository: anything the test overrides works normally, anything it
 * doesn't throws a descriptive error the moment it's called. That makes an un-faked dependency
 * a loud failure ("Unexpected call: memberRepository.getAll()") rather than an `undefined is not
 * a function` several frames away — or worse, a silent real network call.
 */
function fake<T extends object>(name: string, overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      // React/Vitest probe objects for these; they must not look like a thenable or a function.
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON' || prop === '$$typeof') return undefined;
      return () => {
        throw new Error(`Unexpected call: ${name}.${prop}() — add it to the overrides of fakeServices()`);
      };
    },
  });
}

// `satisfies Record<keyof Services, true>` makes this list a compile error whenever a service
// is added to (or removed from) `Services` — the fakes can never silently fall behind.
const SERVICE_KEYS = {
  authService: true,
  memberService: true,
  subscriptionService: true,
  branchService: true,
  planService: true,
  roleService: true,
  reportService: true,
  userService: true,
  profileRepository: true,
  memberRepository: true,
  branchRepository: true,
  planRepository: true,
  roleRepository: true,
  memberListRepository: true,
  subscriptionRepository: true,
  auditLogRepository: true,
  memberNumberingRepository: true,
  memberNumberingService: true,
} satisfies Record<keyof Services, true>;

export type ServiceOverrides = { [K in keyof Services]?: Partial<Services[K]> };

/** A complete `Services` object where every key is a strict fake. Pass overrides per service. */
export function fakeServices(overrides: ServiceOverrides = {}): Services {
  const entries = (Object.keys(SERVICE_KEYS) as (keyof Services)[]).map((key) => [
    key,
    fake<object>(key, overrides[key] as object | undefined),
  ]);
  return Object.fromEntries(entries) as unknown as Services;
}
