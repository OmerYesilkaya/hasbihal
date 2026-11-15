/** The migrated database each test database is copied from. */
export const TEMPLATE_DATABASE = 'hasbihal_template';

/** The same server URL, pointing at another database. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}
