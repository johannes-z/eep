const tcpPathPattern = /^tcp:\/\/([\w.-]+):(\d{1,5})$/;

export function isTcpPath(path: string): boolean {
  const match = tcpPathPattern.exec(path);
  if (!match) return false;
  const port = Number(match[2]);
  return port >= 1 && port <= 65_535;
}

export function parseTcpPath(path: string): { host: string; port: number } {
  const match = tcpPathPattern.exec(path);
  if (!match || !isTcpPath(path)) throw new Error(`Invalid TCP adapter path: ${path}`);
  return {
    host: match[1],
    port: Number(match[2]),
  };
}
