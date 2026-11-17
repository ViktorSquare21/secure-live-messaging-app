import type { PeerState } from '@slm/shared';
import type { ReceiverError } from '../session/receiver-session.service';
import type { ReceiverStatus } from '../session/receiver-state';
import type { SenderConnection, SenderError } from '../session/sender-core';

export type PeerPhase = 'waiting' | 'connected' | 'left';

// The server answers a sender join with peer "disconnected" when no receiver has come yet, so "left" needs the history.
export function nextPeerPhase(previous: PeerPhase, peer: PeerState | null): PeerPhase {
  if (peer === 'connected') return 'connected';
  if (peer === 'disconnected' && previous === 'connected') return 'left';
  return previous;
}

const PEER_LABELS: Record<PeerPhase, string> = {
  waiting: 'Waiting for receiver',
  connected: 'Receiver connected',
  left: 'Receiver disconnected',
};

export function senderPeerLabel(connection: SenderConnection, phase: PeerPhase): string {
  return connection === 'disconnected' ? 'Reconnecting…' : PEER_LABELS[phase];
}

export type LastSentView =
  | { readonly kind: 'none' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'sent'; readonly at: number };

export function lastSentView(sending: boolean, lastSentAt: number | null): LastSentView {
  if (sending) return { kind: 'sending' };
  return lastSentAt === null ? { kind: 'none' } : { kind: 'sent', at: lastSentAt };
}

export interface SenderErrorView {
  readonly message: string;
  readonly fatal: boolean;
}

export function senderErrorView(error: SenderError | null): SenderErrorView | null {
  switch (error) {
    case null:
      return null;
    case 'unknown_session':
      return { message: "This session doesn't exist or has ended.", fatal: true };
    case 'bad_token':
      return { message: "This session can't be opened from this tab.", fatal: true };
    case 'slot_taken':
      return { message: 'This session is already open in another tab.', fatal: true };
    case 'rate_limited':
      return { message: 'Updates are arriving too fast. Pause briefly and keep typing.', fatal: false };
    default:
      return { message: 'The server did not accept the last update.', fatal: false };
  }
}

export function homeErrorMessage(error: SenderError | null): string | null {
  switch (error) {
    case null:
      return null;
    case 'unreachable':
      return "Can't reach the server. Check your connection and try again.";
    case 'server_busy':
      return 'The server is busy. Try again in a moment.';
    case 'rate_limited':
      return 'Too many new sessions. Wait a moment and try again.';
    default:
      return "Couldn't start a session. Try again.";
  }
}

const RECEIVER_STATUS_LABELS: Record<ReceiverStatus, string> = {
  waiting: 'Waiting for the sender',
  live: 'Live',
  disconnected: 'Disconnected – reconnecting…',
  integrity_error: 'Update rejected',
};

export function receiverStatusLabel(status: ReceiverStatus): string {
  return RECEIVER_STATUS_LABELS[status];
}

export function receiverErrorMessage(error: ReceiverError | null): string | null {
  switch (error) {
    case null:
      return null;
    case 'invalid_key':
      return 'This link is incomplete or damaged. Ask the sender for a new link.';
    case 'unknown_session':
    case 'invalid_payload':
      return "This session doesn't exist or has ended.";
    case 'slot_taken':
      return 'Someone else is already viewing this session.';
    default:
      return "Couldn't open this session. Try again later.";
  }
}
