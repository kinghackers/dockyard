/** Coarse log-level detection for whole-line coloring in log views. */
export type LogLevel = 'error' | 'warn';

const ERROR_RE = /\b(ERROR|FATAL|PANIC|CRITICAL)\b|"level"\s*:\s*"(error|fatal|crit)"/i;
const WARN_RE = /\b(WARN|WARNING)\b|"level"\s*:\s*"warn(ing)?"/i;

export function detectLogLevel(text: string): LogLevel | undefined {
  if (ERROR_RE.test(text)) return 'error';
  if (WARN_RE.test(text)) return 'warn';
  return undefined;
}
