export interface LogEntry {
  readonly event: string;
  readonly outcome?: string;
  readonly count?: number;
}

export type Logger = (entry: LogEntry) => void;

export function formatLogEntry(entry: LogEntry): string {
  const parts = [`event=${entry.event}`];
  if (entry.outcome !== undefined) parts.push(`outcome=${entry.outcome}`);
  if (entry.count !== undefined) parts.push(`count=${entry.count}`);
  return parts.join(' ');
}

export function ackOutcome(result: { readonly ok: true } | { readonly ok: false; readonly error: string }): string {
  return result.ok ? 'ok' : result.error;
}
