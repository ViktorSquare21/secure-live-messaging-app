import { describe, expect, test } from 'vitest';
import { applyChanges, type Change, type Session } from './session-core';
import { applyChangesInPlace, createSessionStore } from './session-store';

const SESSION: Session = { senderTokenHash: new Uint8Array(32), lastSeq: 0, lastActivity: 0 };

describe('applyChangesInPlace', () => {
  test('ends in the same state as the core applyChanges, on the same map objects', () => {
    const changes: Change[] = [
      { type: 'putSession', sessionId: 'a', session: SESSION },
      { type: 'putSession', sessionId: 'b', session: SESSION },
      { type: 'bind', socketId: 's1', binding: { sessionId: 'a', role: 'sender' } },
      { type: 'bind', socketId: 's2', binding: { sessionId: 'a', role: 'receiver' } },
      { type: 'unbind', socketId: 's2' },
      { type: 'deleteSession', sessionId: 'b' },
      { type: 'putSession', sessionId: 'a', session: { ...SESSION, lastSeq: 3 } },
    ];
    const store = createSessionStore();
    const { sessions, bindings } = store;

    applyChangesInPlace(store, changes);

    expect(store.sessions).toBe(sessions);
    expect(store.bindings).toBe(bindings);
    expect(store).toEqual(applyChanges(createSessionStore(), changes));
    expect(store.sessions.get('a')?.lastSeq).toBe(3);
    expect([...store.bindings.keys()]).toEqual(['s1']);
  });

  test('changes nothing for an empty change list', () => {
    const store = createSessionStore();
    applyChangesInPlace(store, []);
    expect(store.sessions.size).toBe(0);
    expect(store.bindings.size).toBe(0);
  });
});
