import * as migration_20260913_005623_initial from './20260913_005623_initial';
import * as migration_20260913_061206_otp_codes from './20260913_061206_otp_codes';
import * as migration_20260913_061846_invitations_optional_token from './20260913_061846_invitations_optional_token';
import * as migration_20260915_debrief_hardest from './20260915_debrief_hardest';
import * as migration_20260915_drop_passwords from './20260915_drop_passwords';
import * as migration_20260915_debrief_reminder from './20260915_debrief_reminder';
import * as migration_20260915_profile from './20260915_profile';
import * as migration_20260915_engagements from './20260915_engagements';
import * as migration_20260915_engagements_team from './20260915_engagements_team';
import * as migration_20260915_team_reminded from './20260915_team_reminded';

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
  {
    up: migration_20260915_debrief_hardest.up,
    down: migration_20260915_debrief_hardest.down,
    name: '20260915_debrief_hardest',
  },
  {
    up: migration_20260915_drop_passwords.up,
    down: migration_20260915_drop_passwords.down,
    name: '20260915_drop_passwords',
  },
  {
    up: migration_20260915_debrief_reminder.up,
    down: migration_20260915_debrief_reminder.down,
    name: '20260915_debrief_reminder',
  },
  {
    up: migration_20260915_profile.up,
    down: migration_20260915_profile.down,
    name: '20260915_profile',
  },
  {
    up: migration_20260915_engagements.up,
    down: migration_20260915_engagements.down,
    name: '20260915_engagements',
  },
  {
    up: migration_20260915_engagements_team.up,
    down: migration_20260915_engagements_team.down,
    name: '20260915_engagements_team',
  },
  {
    up: migration_20260915_team_reminded.up,
    down: migration_20260915_team_reminded.down,
    name: '20260915_team_reminded',
  },
];
