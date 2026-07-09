import type { DbClient } from '@ubm-klar/db';

/**
 * Maps external subject ids (from the verified SSO token) to data-plane
 * user_profiles rows. Most FK columns reference user_profiles(id), so every
 * acting user gets a profile on first write.
 */
export class UsersRepository {
  constructor(private readonly db: DbClient) {}

  async ensureUserProfile(
    subjectId: string,
    displayName?: string,
    email?: string,
  ): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `insert into user_profiles (subject_id, display_name, email)
       values ($1, $2, $3)
       on conflict (subject_id) do update set updated_at = now()
       returning id`,
      [subjectId, displayName ?? subjectId, email ?? `${subjectId}@internal.invalid`],
    );
    return result.rows[0]!.id;
  }

  async findBySubjectId(
    subjectId: string,
  ): Promise<{ id: string; displayName: string } | undefined> {
    const result = await this.db.query<{ id: string; display_name: string }>(
      'select id, display_name from user_profiles where subject_id = $1',
      [subjectId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, displayName: row.display_name } : undefined;
  }
}
