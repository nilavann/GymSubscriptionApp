import { afterEach, beforeEach, vi, type MockInstance } from 'vitest';

/**
 * Fails any test during which `console.error` was called unexpectedly — this is what surfaces
 * React's "unique key", "not wrapped in act(...)" and "state update on an unmounted component"
 * warnings instead of letting them scroll past. A test that legitimately triggers an error
 * (e.g. an error boundary catching a thrown render) declares it with `allowConsoleError(/pattern/)`.
 */

let spy: MockInstance<typeof console.error> | null = null;
let allowed: RegExp[] = [];

export function allowConsoleError(...patterns: RegExp[]): void {
  allowed.push(...patterns);
}

export function installConsoleErrorGuard(): void {
  beforeEach(() => {
    allowed = [];
    spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    const calls = spy?.mock.calls ?? [];
    spy?.mockRestore();
    spy = null;
    const unexpected = calls
      .map((args) => args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '))
      .filter((message) => !allowed.some((pattern) => pattern.test(message)));
    if (unexpected.length > 0) {
      throw new Error(`Unexpected console.error during test:\n${unexpected.map((m) => `  - ${m.slice(0, 300)}`).join('\n')}`);
    }
  });
}
