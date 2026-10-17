// Synthetic adapter-initialisation fixture, not a production migration or auth baseline.
import { mysqlTable, varchar, text, boolean, timestamp } from 'drizzle-orm/mysql-core';
const id = () => varchar('id', { length: 36 }).primaryKey();
const dates = () => ({ createdAt: timestamp('created_at').notNull(), updatedAt: timestamp('updated_at').notNull() });
export const user = mysqlTable('probe_user', {
  id: id(), name: text('name').notNull(), email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull(), image: text('image'), ...dates(),
});
export const session = mysqlTable('probe_session', {
  id: id(), userId: varchar('user_id', { length: 36 }).notNull(), token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(), ipAddress: text('ip_address'), userAgent: text('user_agent'), ...dates(),
});
export const account = mysqlTable('probe_account', {
  id: id(), userId: varchar('user_id', { length: 36 }).notNull(), accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(), password: text('password'), accessToken: text('access_token'),
  refreshToken: text('refresh_token'), idToken: text('id_token'), scope: text('scope'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'), refreshTokenExpiresAt: timestamp('refresh_token_expires_at'), ...dates(),
});
export const verification = mysqlTable('probe_verification', {
  id: id(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(), ...dates(),
});
