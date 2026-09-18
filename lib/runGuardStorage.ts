export const RUN_GUARD_STORAGE_KEYS = {
  records: 'run-guard-records-v1',
  coach: 'run-guard-coach-v1',
  settings: 'run-guard-settings-v1',
  locationGrantedHint: 'run-guard-location-granted-v1',
} as const;

export const RUN_GUARD_SESSION_KEYS = {
  locationDismissed: 'run-guard-location-dismissed',
} as const;

export const PROJECT_GITHUB_URL =
  'https://github.com/hyunsoung02/run-guard-web';

type StorageLike = Pick<Storage, 'removeItem'>;

export function removeRunningRecords(storage: StorageLike) {
  storage.removeItem(RUN_GUARD_STORAGE_KEYS.records);
}

export function removeCoachConversation(storage: StorageLike) {
  storage.removeItem(RUN_GUARD_STORAGE_KEYS.coach);
}

export function removeAllRunGuardData(
  storage: StorageLike,
  sessionStorage?: StorageLike,
) {
  Object.values(RUN_GUARD_STORAGE_KEYS).forEach((key) =>
    storage.removeItem(key),
  );
  Object.values(RUN_GUARD_SESSION_KEYS).forEach((key) =>
    sessionStorage?.removeItem(key),
  );
}
