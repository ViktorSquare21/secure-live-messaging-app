import { describe, expect, test } from 'vitest';
import * as shared from './index';

describe('@slm/shared', () => {
  test('loads as a module under the shared Vitest suite', () => {
    expect(shared).toBeTypeOf('object');
  });
});
