import { Database } from "@db/sqlite";
import Config from "./config.ts";

interface Connection {
	ownerId: number;
	connectionId: string;
	logChatId: number | null;
	logEnabled: number;
}

class PmManagerDB {
	private db: Database;

	private connByConnId = new Map<string, Connection | null>();
	private connByLogChat = new Map<number, Connection | null>();
	private connByOwner = new Map<number, Connection | null>();
	private locksCache = new Map<string, string[]>();

	constructor() {
		const config = new Config();
		this.db = new Database(config.dbString);
		this.initDatabase();
	}

	private initDatabase(): void {
		this.db.exec("PRAGMA journal_mode = WAL;");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS messages (
				id        INTEGER PRIMARY KEY AUTOINCREMENT,
				fromId    INTEGER,
				toId      INTEGER,
				userId    INTEGER,
				topicId   INTEGER,
				ChatId    INTEGER,
				createdAt TEXT DEFAULT (datetime('now'))
			);
		`);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS business_connections (
				id           INTEGER PRIMARY KEY AUTOINCREMENT,
				ownerId      INTEGER,
				connectionId TEXT,
				logChatId    INTEGER,
				rights       TEXT,
				logEnabled   INTEGER DEFAULT 1
			);
		`);
		for (
			const col of [
				"rights TEXT",
				"logEnabled INTEGER DEFAULT 1",
			]
		) {
			try {
				this.db.exec(
					`ALTER TABLE business_connections ADD COLUMN ${col};`,
				);
			} catch {
				// noop
			}
		}
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS locks (
				ownerId  INTEGER,
				targetId INTEGER,
				lockType TEXT,
				PRIMARY KEY (ownerId, targetId, lockType)
			);
		`);
		this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (ChatId);",
		);
		this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_conn_connection ON business_connections (connectionId);",
		);
		this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_locks_owner_target ON locks (ownerId, targetId);",
		);
	}

	private clearConnCache(): void {
		this.connByConnId.clear();
		this.connByLogChat.clear();
		this.connByOwner.clear();
	}

	private connBy(
		cache: Map<string | number, Connection | null>,
		key: string | number,
		column: string,
	): Connection | null {
		if (cache.has(key)) return cache.get(key)!;
		const row = this.db
			.prepare(
				`SELECT ownerId, connectionId, logChatId, logEnabled FROM business_connections WHERE ${column} = ?`,
			)
			.get<Connection>(key);
		const conn = row ?? null;
		cache.set(key, conn);
		return conn;
	}

	private byConnId(connectionId: string): Connection | null {
		return this.connBy(
			this.connByConnId as Map<string | number, Connection | null>,
			connectionId,
			"connectionId",
		);
	}

	private byLogChat(logChatId: number): Connection | null {
		return this.connBy(
			this.connByLogChat as Map<string | number, Connection | null>,
			logChatId,
			"logChatId",
		);
	}

	private byOwner(ownerId: number): Connection | null {
		return this.connBy(
			this.connByOwner as Map<string | number, Connection | null>,
			ownerId,
			"ownerId",
		);
	}

	addMessage(
		fromId: number,
		toId: number,
		topicId: number,
		userId: number,
		ChatId: number,
	): void {
		this.db
			.prepare(
				"INSERT INTO messages (fromId, toId, topicId, userId, ChatId) VALUES (?, ?, ?, ?, ?)",
			)
			.run(fromId, toId, topicId, userId, ChatId);
	}

	getMessagesByToId(toId: number, chatId: number): number | null {
		const row = this.db
			.prepare(
				"SELECT fromId FROM messages WHERE toId = ? AND ChatId = ? ORDER BY id DESC LIMIT 1",
			)
			.get<{ fromId: number }>(toId, chatId);
		return row ? Number(row.fromId) : null;
	}

	getTopicIdByUserId(userId: number, connectionId: string): number | null {
		const chatId = this.getLogChatFromBusinessId(connectionId);
		if (chatId === null) return null;
		const row = this.db
			.prepare(
				"SELECT topicId FROM messages WHERE userId = ? AND ChatId = ? ORDER BY id DESC LIMIT 1",
			)
			.get<{ topicId: number }>(userId, chatId);
		return row ? Number(row.topicId) : null;
	}

	getMessagesByFromId(fromId: number, chatId: number): number | null {
		const row = this.db
			.prepare(
				"SELECT toId FROM messages WHERE fromId = ? AND ChatId = ? ORDER BY id DESC LIMIT 1",
			)
			.get<{ toId: number }>(fromId, chatId);
		return row ? Number(row.toId) : null;
	}

	userIdByTopicId(topicId: number, logchat: number): number | null {
		const logchatid = this.getLogChatId(logchat);
		if (logchatid === null) return null;
		const row = this.db
			.prepare(
				"SELECT userId FROM messages WHERE topicId = ? AND ChatId = ? ORDER BY id DESC LIMIT 1",
			)
			.get<{ userId: number }>(topicId, logchatid);
		return row ? Number(row.userId) : null;
	}

	addBusinessConnection(ownerId: number, connectionId: string): void {
		const existing = this.db
			.prepare("SELECT id FROM business_connections WHERE ownerId = ?")
			.get<{ id: number }>(ownerId);
		if (existing) {
			this.db
				.prepare(
					"UPDATE business_connections SET connectionId = ? WHERE ownerId = ?",
				)
				.run(connectionId, ownerId);
		} else {
			this.db
				.prepare(
					"INSERT INTO business_connections (ownerId, connectionId, logChatId) VALUES (?, ?, NULL)",
				)
				.run(ownerId, connectionId);
		}
		this.clearConnCache();
	}

	deleteBusinessConnection(connectionId: string): void {
		this.db
			.prepare("DELETE FROM business_connections WHERE connectionId = ?")
			.run(connectionId);
		this.clearConnCache();
	}

	addLogChatToBusinessConnection(ownerId: number, logChatId: number): void {
		this.db
			.prepare(
				"UPDATE business_connections SET logChatId = ? WHERE ownerId = ?",
			)
			.run(logChatId, ownerId);
		this.clearConnCache();
	}

	getLogChatFromBusinessId(connectionId: string): number | null {
		const conn = this.byConnId(connectionId);
		return conn && conn.logChatId !== null ? Number(conn.logChatId) : null;
	}

	getLogChatId(logChatId: number): number | null {
		const conn = this.byLogChat(logChatId);
		return conn && conn.logChatId !== null ? Number(conn.logChatId) : null;
	}

	getLogInfo(logChatId: number): [number, string | null] {
		const conn = this.byLogChat(logChatId);
		return conn && conn.logChatId !== null
			? [Number(conn.logChatId), String(conn.connectionId)]
			: [0, null];
	}

	getLogChatFromOwnerId(ownerId: number): number | null {
		const conn = this.byOwner(ownerId);
		return conn && conn.logChatId !== null ? Number(conn.logChatId) : null;
	}

	getOwnerIdFromBusinessId(connectionId: string): number | null {
		const conn = this.byConnId(connectionId);
		return conn ? Number(conn.ownerId) : null;
	}

	getConnectionRights(connectionId: string): string | null {
		const row = this.db
			.prepare(
				"SELECT rights FROM business_connections WHERE connectionId = ?",
			)
			.get<{ rights: string | null }>(connectionId);
		return row?.rights ?? null;
	}

	setConnectionRights(connectionId: string, rights: string): void {
		this.db
			.prepare(
				"UPDATE business_connections SET rights = ? WHERE connectionId = ?",
			)
			.run(rights, connectionId);
	}

	setLogging(ownerId: number, enabled: boolean): boolean {
		const changes = this.db
			.prepare(
				"UPDATE business_connections SET logEnabled = ? WHERE ownerId = ?",
			)
			.run(enabled ? 1 : 0, ownerId);
		this.clearConnCache();
		return changes > 0;
	}

	isLoggingEnabled(connectionId: string): boolean {
		const conn = this.byConnId(connectionId);
		return conn ? conn.logEnabled !== 0 : true;
	}

	private lockKey(ownerId: number, targetId: number): string {
		return `${ownerId}:${targetId}`;
	}

	addLock(ownerId: number, targetId: number, lockType: string): void {
		this.db
			.prepare(
				"INSERT OR IGNORE INTO locks (ownerId, targetId, lockType) VALUES (?, ?, ?)",
			)
			.run(ownerId, targetId, lockType);
		this.locksCache.delete(this.lockKey(ownerId, targetId));
	}

	removeLock(ownerId: number, targetId: number, lockType: string): void {
		this.db
			.prepare(
				"DELETE FROM locks WHERE ownerId = ? AND targetId = ? AND lockType = ?",
			)
			.run(ownerId, targetId, lockType);
		this.locksCache.delete(this.lockKey(ownerId, targetId));
	}

	getLocks(ownerId: number, targetId: number): string[] {
		const key = this.lockKey(ownerId, targetId);
		const cached = this.locksCache.get(key);
		if (cached) return cached;
		const rows = this.db
			.prepare(
				"SELECT lockType FROM locks WHERE ownerId = ? AND targetId = ?",
			)
			.all<{ lockType: string }>(ownerId, targetId)
			.map((r) => r.lockType);
		this.locksCache.set(key, rows);
		return rows;
	}

	getAllLocks(ownerId: number): { targetId: number; lockType: string }[] {
		return this.db
			.prepare(
				"SELECT targetId, lockType FROM locks WHERE ownerId = ? ORDER BY targetId",
			)
			.all<{ targetId: number; lockType: string }>(ownerId);
	}

	checkDatabaseConnection(): boolean {
		try {
			this.db.prepare("SELECT 1").value();
			return true;
		} catch (error) {
			console.error("Database connection error:", error);
			return false;
		}
	}

	close(): void {
		this.db.close();
	}
}

export default PmManagerDB;
