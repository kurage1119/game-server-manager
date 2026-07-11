import { sqliteTable, text, integer, primaryKey, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`)
});

export const sessions = sqliteTable('sessions', {
	// id = SHA-256 hash (hex) of the raw session token. The raw token is only ever
	// held by the client (HttpOnly cookie); we never store it server-side.
	id: text('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`)
});

export const servers = sqliteTable('servers', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	// Also used as the Discord slash-command argument, so keep it short/friendly.
	name: text('name').notNull().unique(),
	// Must match ^game-[A-Za-z0-9_.@-]+\.service$ — enforced in systemctl/index.ts.
	unitName: text('unit_name').notNull().unique(),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`)
});

export const permissions = sqliteTable(
	'permissions',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		serverId: integer('server_id')
			.notNull()
			.references(() => servers.id, { onDelete: 'cascade' }),
		// 'view' = read-only status; 'operate' = can also start/stop.
		level: text('level', { enum: ['view', 'operate'] }).notNull()
	},
	(table) => [primaryKey({ columns: [table.userId, table.serverId] })]
);

export const discordChannels = sqliteTable(
	'discord_channels',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		serverId: integer('server_id')
			.notNull()
			.references(() => servers.id, { onDelete: 'cascade' }),
		guildId: text('guild_id').notNull(),
		channelId: text('channel_id').notNull()
	},
	(table) => [unique().on(table.serverId, table.guildId, table.channelId)]
);
