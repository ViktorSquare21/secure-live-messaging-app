import { isValidEnvelope, type DecryptResult } from '@slm/shared';

export type ReceiverStatus = 'waiting' | 'live' | 'integrity_error' | 'disconnected';

export interface ReceiverState {
  readonly text: string;
  readonly lastSeq: number | null;
  readonly status: ReceiverStatus;
  readonly integrityWarning: boolean;
}

export type ReceiverEvent =
  | { readonly type: 'update' | 'resync'; readonly envelope: unknown; readonly result: DecryptResult }
  | { readonly type: 'disconnected' }
  | { readonly type: 'rejoined' };

export const initialReceiverState: ReceiverState = {
  text: '',
  lastSeq: null,
  status: 'waiting',
  integrityWarning: false,
};

export function receiverTransition(state: ReceiverState, event: ReceiverEvent): ReceiverState {
  switch (event.type) {
    case 'disconnected':
      return { ...state, status: 'disconnected' };
    case 'rejoined':
      return { ...state, status: state.lastSeq === null ? 'waiting' : 'live' };
    case 'update':
    case 'resync':
      return applyEnvelope(state, event);
  }
}

function applyEnvelope(state: ReceiverState, event: Extract<ReceiverEvent, { type: 'update' | 'resync' }>): ReceiverState {
  const { result } = event;
  if (!isValidEnvelope(event.envelope) || result.status !== 'ok') return rejected(state);
  if (event.type === 'resync' && result.seq === state.lastSeq) return { ...state };
  if (state.lastSeq !== null && result.seq <= state.lastSeq) return rejected(state);
  return { text: result.text, lastSeq: result.seq, status: 'live', integrityWarning: false };
}

function rejected(state: ReceiverState): ReceiverState {
  return { ...state, status: 'integrity_error', integrityWarning: true };
}
