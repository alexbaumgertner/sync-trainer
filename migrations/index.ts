/**
 * Порядок здесь — алфавитный, и это не косметика: Payload применяет миграции
 * по ИМЕНИ, а не в порядке этого массива. На расхождении уже спотыкались —
 * `engagement_team` встал раньше `engagements`, потому что подчёркивание
 * меньше буквы «s», и таблица создалась до той, на которую ссылается.
 *
 * Пока файл отсортирован, читатель видит тот же порядок, в котором миграции
 * и выполнятся. Проверяется тестом `migrations-complete`.
 */
import * as migration_20260913_005623_initial from './20260913_005623_initial';
import * as migration_20260913_061206_otp_codes from './20260913_061206_otp_codes';
import * as migration_20260913_061846_invitations_optional_token from './20260913_061846_invitations_optional_token';
import * as migration_20260915_debrief_hardest from './20260915_debrief_hardest';
import * as migration_20260915_debrief_reminder from './20260915_debrief_reminder';
import * as migration_20260915_drop_passwords from './20260915_drop_passwords';
import * as migration_20260915_engagements from './20260915_engagements';
import * as migration_20260915_engagements_team from './20260915_engagements_team';
import * as migration_20260915_profile from './20260915_profile';
import * as migration_20260915_team_reminded from './20260915_team_reminded';
import * as migration_20260915_zz_locked_engagements from './20260915_zz_locked_engagements';
import * as migration_20260916_activity from './20260916_activity';
import * as migration_20260916_nullable_actors from './20260916_nullable_actors';
import * as migration_20260916_zz_ratings from './20260916_zz_ratings';
import * as migration_20260917_glossary_variants from './20260917_glossary_variants';
import * as migration_20260917_zz_waveform from './20260917_zz_waveform';
import * as migration_20260917_zzz_cues from './20260917_zzz_cues';
import * as migration_20260920_document_sources from './20260920_document_sources';
import * as migration_20260920_zz_glossary_step from './20260920_zz_glossary_step';
import * as migration_20260920_zzz_glossary_layers from './20260920_zzz_glossary_layers';
import * as migration_20260921_project_team from './20260921_project_team';

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
    up: migration_20260915_debrief_reminder.up,
    down: migration_20260915_debrief_reminder.down,
    name: '20260915_debrief_reminder',
  },
  {
    up: migration_20260915_drop_passwords.up,
    down: migration_20260915_drop_passwords.down,
    name: '20260915_drop_passwords',
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
    up: migration_20260915_profile.up,
    down: migration_20260915_profile.down,
    name: '20260915_profile',
  },
  {
    up: migration_20260915_team_reminded.up,
    down: migration_20260915_team_reminded.down,
    name: '20260915_team_reminded',
  },
  {
    up: migration_20260915_zz_locked_engagements.up,
    down: migration_20260915_zz_locked_engagements.down,
    name: '20260915_zz_locked_engagements',
  },
  {
    up: migration_20260916_activity.up,
    down: migration_20260916_activity.down,
    name: '20260916_activity',
  },
  {
    up: migration_20260916_nullable_actors.up,
    down: migration_20260916_nullable_actors.down,
    name: '20260916_nullable_actors',
  },
  {
    up: migration_20260916_zz_ratings.up,
    down: migration_20260916_zz_ratings.down,
    name: '20260916_zz_ratings',
  },
  {
    up: migration_20260917_glossary_variants.up,
    down: migration_20260917_glossary_variants.down,
    name: '20260917_glossary_variants',
  },
  {
    up: migration_20260917_zz_waveform.up,
    down: migration_20260917_zz_waveform.down,
    name: '20260917_zz_waveform',
  },
  {
    up: migration_20260917_zzz_cues.up,
    down: migration_20260917_zzz_cues.down,
    name: '20260917_zzz_cues',
  },
  {
    up: migration_20260920_document_sources.up,
    down: migration_20260920_document_sources.down,
    name: '20260920_document_sources',
  },
  {
    up: migration_20260920_zz_glossary_step.up,
    down: migration_20260920_zz_glossary_step.down,
    name: '20260920_zz_glossary_step',
  },
  {
    up: migration_20260920_zzz_glossary_layers.up,
    down: migration_20260920_zzz_glossary_layers.down,
    name: '20260920_zzz_glossary_layers',
  },
  {
    up: migration_20260921_project_team.up,
    down: migration_20260921_project_team.down,
    name: '20260921_project_team',
  },
];
