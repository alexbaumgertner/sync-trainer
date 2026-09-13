import * as migration_20260913_005623_initial from './20260913_005623_initial';
import * as migration_20260913_061206_otp_codes from './20260913_061206_otp_codes';
import * as migration_20260913_061846_invitations_optional_token from './20260913_061846_invitations_optional_token';

export const migrations = [
  {
    up: migration_20260913_005623_initial.up,
    down: migration_20260913_005623_initial.down,
    name: '20260913_005623_initial',
  },
  {
    up: migration_20260913_061206_otp_codes.up,
    down: migration_20260913_061206_otp_codes.down,
    name: '20260913_061206_otp_codes',
  },
  {
    up: migration_20260913_061846_invitations_optional_token.up,
    down: migration_20260913_061846_invitations_optional_token.down,
    name: '20260913_061846_invitations_optional_token',
  },
];
