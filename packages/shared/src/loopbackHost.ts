const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/** Host fields `lsof` and `netstat` print for a listener reachable from this machine. */
export const LSOF_LOCAL_HOST_TOKENS: ReadonlySet<string> = new Set([
  ...LOOPBACK_HOSTS,
  "*",
  "[::]",
]);
