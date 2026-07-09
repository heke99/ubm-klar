import pg from 'pg';

/**
 * Thin Postgres access layer shared by the control plane, the API repositories,
 * the persistent audit/data-access sinks and the job queue.
 *
 * Server-side only: this module must never be imported from browser code.
 * Connection strings come from environment configuration and are never logged.
 */

export interface DbClient {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<Row>>;
  /** Runs fn inside a transaction; rolls back on any thrown error. */
  withTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

class PoolClient implements DbClient {
  constructor(private readonly pool: pg.Pool) {}

  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<pg.QueryResult<Row>> {
    return this.pool.query<Row>(text, params);
  }

  async withTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect();
    const tx: DbClient = {
      query: (text, params = []) => connection.query(text, params),
      withTransaction: () => {
        throw new Error('Nested transactions are not supported');
      },
      end: async () => undefined,
    };
    try {
      await connection.query('begin');
      const result = await fn(tx);
      await connection.query('commit');
      return result;
    } catch (error) {
      await connection.query('rollback');
      throw error;
    } finally {
      connection.release();
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export interface CreateDbClientOptions {
  connectionString: string;
  max?: number;
  /** Application name shown in pg_stat_activity (no PII). */
  applicationName?: string;
}

export function createDbClient(options: CreateDbClientOptions): DbClient {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'ubm-klar',
  });
  return new PoolClient(pool);
}
