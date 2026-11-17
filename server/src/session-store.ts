import type { Binding, Change, Session, SessionState } from './session-core';

export interface SessionStore extends SessionState {
  readonly sessions: Map<string, Session>;
  readonly bindings: Map<string, Binding>;
}

export function createSessionStore(): SessionStore {
  return { sessions: new Map(), bindings: new Map() };
}

// Applies the core's changes to the shell's own maps instead of copying them, which keeps a publish O(1).
export function applyChangesInPlace(store: SessionStore, changes: readonly Change[]): void {
  for (const change of changes) {
    switch (change.type) {
      case 'putSession':
        store.sessions.set(change.sessionId, change.session);
        break;
      case 'deleteSession':
        store.sessions.delete(change.sessionId);
        break;
      case 'bind':
        store.bindings.set(change.socketId, change.binding);
        break;
      case 'unbind':
        store.bindings.delete(change.socketId);
        break;
    }
  }
}
