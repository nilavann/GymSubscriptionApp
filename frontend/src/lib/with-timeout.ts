/** Races a promise against a timeout so a hung network call can't leave the UI stuck forever. */
export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
