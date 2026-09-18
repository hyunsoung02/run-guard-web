import { describe, expect, it, vi } from 'vitest';
import {
  removeAllRunGuardData,
  removeCoachConversation,
  removeRunningRecords,
  RUN_GUARD_SESSION_KEYS,
  RUN_GUARD_STORAGE_KEYS,
} from './runGuardStorage';

function storageSpy() {
  return { removeItem: vi.fn() };
}

describe('RUN Guard storage ownership', () => {
  it('removes only running records for a records reset', () => {
    const storage = storageSpy();
    removeRunningRecords(storage);
    expect(storage.removeItem).toHaveBeenCalledOnce();
    expect(storage.removeItem).toHaveBeenCalledWith(
      RUN_GUARD_STORAGE_KEYS.records,
    );
  });

  it('removes only coach history and its current plan for a coach reset', () => {
    const storage = storageSpy();
    removeCoachConversation(storage);
    expect(storage.removeItem).toHaveBeenCalledOnce();
    expect(storage.removeItem).toHaveBeenCalledWith(
      RUN_GUARD_STORAGE_KEYS.coach,
    );
  });

  it('removes every owned local and session key without clearing the browser', () => {
    const storage = storageSpy();
    const sessionStorage = storageSpy();
    removeAllRunGuardData(storage, sessionStorage);
    expect(storage.removeItem.mock.calls.flat()).toEqual(
      Object.values(RUN_GUARD_STORAGE_KEYS),
    );
    expect(sessionStorage.removeItem.mock.calls.flat()).toEqual(
      Object.values(RUN_GUARD_SESSION_KEYS),
    );
  });
});
