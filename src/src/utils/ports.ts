/** Host/container port mapping display helpers. */

export interface PortMappingView {
  ip?: string;
  privatePort: number;
  publicPort?: number;
  type: string;
}

/**
 * Compact list-cell text for published ports, de-duplicated.
 * Dual-stack bindings (0.0.0.0 + ::) collapse into one `host→container` pair.
 */
export function formatPortMappings(ports: PortMappingView[] | undefined): string {
  if (!ports?.length) return '-';
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const p of ports) {
    if (!p.publicPort) continue;
    const proto = p.type || 'tcp';
    const key = `${p.publicPort}→${p.privatePort}/${proto}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(
      proto === 'tcp' ? `${p.publicPort}→${p.privatePort}` : `${p.publicPort}→${p.privatePort}/${proto}`
    );
  }
  return parts.join(', ') || '-';
}

/** Detail-page text: keep per-IP entries, still collapse exact duplicates. */
export function formatPortMappingsDetailed(ports: PortMappingView[] | undefined): string {
  if (!ports?.length) return '-';
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const p of ports) {
    const ip = p.ip || '0.0.0.0';
    const pub = p.publicPort ? String(p.publicPort) : '-';
    const key = `${ip}:${pub}→${p.privatePort}/${p.type || 'tcp'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${ip}:${pub} → ${p.privatePort}/${p.type || 'tcp'}`);
  }
  return lines.join('\n') || '-';
}
