import * as migration_20260913_005623_initial from './20260913_005623_initial';

export const migrations = [
  {
    up: migration_20260913_005623_initial.up,
    down: migration_20260913_005623_initial.down,
    name: '20260913_005623_initial'
  },
];
