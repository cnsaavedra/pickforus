import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ChatEntry,
  DecisionVerdict,
  PickMode,
  RoomPhase,
  RoomSnapshot,
} from "../shared/types.js";

const ALIAS_POOL = [
  "Hungry Otter",
  "Indecisive Panda",
  "Cozy Capybara",
  "Night Noodle",
  "Sleepy Fox",
  "Curious Duck",
  "Chilly Mango",
  "Crispy Bao",
  "Breezy Alpaca",
  "Toasted Marshmallow",
  "Sunny Dumpling",
  "Dizzy Penguin",
  "Velvet Wombat",
  "Peppy Koala",
  "Spicy Pretzel",
  "Pickled Giraffe",
] as const;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface RoomRow {
  code: string;
  mode: PickMode;
  duration_seconds: number;
  remaining_seconds: number;
  phase: RoomPhase;
  round_number: number;
  created_at: string;
}

interface MessageRow {
  id: string;
  room_code: string;
  round_number: number;
  participant_id: string;
  alias: string;
  text: string;
  created_at: string;
}

export interface RoomStateUpdates {
  mode?: PickMode;
  durationSeconds?: number;
  remainingSeconds?: number;
  phase?: RoomPhase;
  roundNumber?: number;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function generateRoomCode(): string {
  let result = "";
  for (let i = 0; i < 4; i += 1) {
    const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
    result += CODE_ALPHABET.charAt(idx);
  }
  return result;
}

export class PickForUsStore {
  private readonly db: DatabaseSync;

  constructor(dbPath = "./data/pickforus.sqlite") {
    if (dbPath !== ":memory:" && !dbPath.startsWith("file::memory:")) {
      const parentDir = path.dirname(path.resolve(dbPath));
      mkdirSync(parentDir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ":memory:" && !dbPath.startsWith("file::memory:")) {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        remaining_seconds INTEGER NOT NULL,
        phase TEXT NOT NULL,
        round_number INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS participants (
        room_code TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        PRIMARY KEY (room_code, participant_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        round_number INTEGER NOT NULL,
        participant_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_room_round
        ON messages (room_code, round_number);

      CREATE TABLE IF NOT EXISTS verdicts (
        room_code TEXT NOT NULL,
        round_number INTEGER NOT NULL,
        verdict_json TEXT NOT NULL,
        PRIMARY KEY (room_code, round_number)
      );
    `);
  }

  createRoom(mode: PickMode = "food", durationSeconds = 60): RoomSnapshot {
    const clampedDuration = Math.min(3600, Math.max(1, Math.floor(durationSeconds)));
    let code = generateRoomCode();
    const checkStmt = this.db.prepare("SELECT code FROM rooms WHERE code = ?");
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const existing = checkStmt.get(code);
      if (existing === undefined) {
        break;
      }
      code = generateRoomCode();
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO rooms (
          code, mode, duration_seconds, remaining_seconds, phase, round_number, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(code, mode, clampedDuration, clampedDuration, "lobby", 1, now);

    const snapshot = this.getRoomSnapshot(code);
    if (snapshot === null) {
      throw new Error(`Failed to read newly created room ${code}`);
    }
    return snapshot;
  }

  getOrAssignAlias(roomCode: string, participantId: string): string {
    const code = normalizeCode(roomCode);
    const existing = this.db
      .prepare("SELECT alias FROM participants WHERE room_code = ? AND participant_id = ?")
      .get(code, participantId) as { alias: string } | undefined;

    if (existing !== undefined) {
      return existing.alias;
    }

    const rows = this.db
      .prepare("SELECT alias FROM participants WHERE room_code = ?")
      .all(code) as Array<{ alias: string }>;
    const used = new Set(rows.map((row) => row.alias));

    const startIdx = hashString(`${code}:${participantId}`) % ALIAS_POOL.length;
    let chosen: string | undefined;
    for (let offset = 0; offset < ALIAS_POOL.length; offset += 1) {
      const candidate = ALIAS_POOL[(startIdx + offset) % ALIAS_POOL.length];
      if (candidate !== undefined && !used.has(candidate)) {
        chosen = candidate;
        break;
      }
    }

    if (chosen === undefined) {
      const base = ALIAS_POOL[startIdx] ?? "Hungry Otter";
      chosen = `${base} #${used.size + 1}`;
    }

    this.db
      .prepare(
        "INSERT OR IGNORE INTO participants (room_code, participant_id, alias) VALUES (?, ?, ?)",
      )
      .run(code, participantId, chosen);

    const persisted = this.db
      .prepare("SELECT alias FROM participants WHERE room_code = ? AND participant_id = ?")
      .get(code, participantId) as { alias: string } | undefined;

    return persisted?.alias ?? chosen;
  }

  getRoomSnapshot(code: string): RoomSnapshot | null {
    const normalized = normalizeCode(code);
    const room = this.db
      .prepare(
        `SELECT code, mode, duration_seconds, remaining_seconds, phase, round_number, created_at
         FROM rooms WHERE code = ?`,
      )
      .get(normalized) as RoomRow | undefined;

    if (room === undefined) {
      return null;
    }

    const participantRow = this.db
      .prepare("SELECT COUNT(*) AS count FROM participants WHERE room_code = ?")
      .get(normalized) as { count: number } | undefined;

    const messageRows = this.db
      .prepare(
        `SELECT id, room_code, round_number, participant_id, alias, text, created_at
         FROM messages
         WHERE room_code = ? AND round_number = ?
         ORDER BY rowid ASC`,
      )
      .all(normalized, room.round_number) as unknown as MessageRow[];

    const messages: ChatEntry[] = messageRows.map((row) => ({
      id: row.id,
      roomCode: row.room_code,
      roundNumber: row.round_number,
      participantId: row.participant_id,
      alias: row.alias,
      text: row.text,
      createdAt: row.created_at,
    }));

    const verdictRow = this.db
      .prepare("SELECT verdict_json FROM verdicts WHERE room_code = ? AND round_number = ?")
      .get(normalized, room.round_number) as { verdict_json: string } | undefined;

    let verdict: DecisionVerdict | null = null;
    if (verdictRow !== undefined) {
      verdict = JSON.parse(verdictRow.verdict_json) as DecisionVerdict;
    }

    return {
      code: room.code,
      mode: room.mode,
      durationSeconds: room.duration_seconds,
      remainingSeconds: room.remaining_seconds,
      phase: room.phase,
      roundNumber: room.round_number,
      participantCount: participantRow?.count ?? 0,
      messages,
      verdict,
    };
  }

  updateRoomState(code: string, updates: RoomStateUpdates): RoomSnapshot | null {
    const normalized = normalizeCode(code);
    const current = this.db
      .prepare(
        `SELECT code, mode, duration_seconds, remaining_seconds, phase, round_number
         FROM rooms WHERE code = ?`,
      )
      .get(normalized) as RoomRow | undefined;

    if (current === undefined) {
      return null;
    }

    const mode = updates.mode ?? current.mode;
    const durationSeconds = updates.durationSeconds ?? current.duration_seconds;
    const remainingSeconds = updates.remainingSeconds ?? current.remaining_seconds;
    const phase = updates.phase ?? current.phase;
    const roundNumber = updates.roundNumber ?? current.round_number;

    this.db
      .prepare(
        `UPDATE rooms
         SET mode = ?, duration_seconds = ?, remaining_seconds = ?, phase = ?, round_number = ?
         WHERE code = ?`,
      )
      .run(mode, durationSeconds, remainingSeconds, phase, roundNumber, normalized);

    return this.getRoomSnapshot(normalized);
  }

  addMessage(
    roomCode: string,
    participantId: string,
    text: string,
  ): { entry: ChatEntry; snapshot: RoomSnapshot } {
    const normalized = normalizeCode(roomCode);
    const room = this.db.prepare("SELECT round_number FROM rooms WHERE code = ?").get(normalized) as
      | { round_number: number }
      | undefined;

    if (room === undefined) {
      throw new Error(`Room ${normalized} not found`);
    }

    const alias = this.getOrAssignAlias(normalized, participantId);
    const entry: ChatEntry = {
      id: randomUUID(),
      roomCode: normalized,
      roundNumber: room.round_number,
      participantId,
      alias,
      text,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO messages (id, room_code, round_number, participant_id, alias, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.roomCode,
        entry.roundNumber,
        entry.participantId,
        entry.alias,
        entry.text,
        entry.createdAt,
      );

    const snapshot = this.getRoomSnapshot(normalized);
    if (snapshot === null) {
      throw new Error(`Room ${normalized} disappeared after insert`);
    }

    return { entry, snapshot };
  }

  saveVerdict(roomCode: string, roundNumber: number, verdict: DecisionVerdict): void {
    const normalized = normalizeCode(roomCode);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO verdicts (room_code, round_number, verdict_json)
         VALUES (?, ?, ?)`,
      )
      .run(normalized, roundNumber, JSON.stringify(verdict));
  }

  resetRoom(
    code: string,
    options?: { mode?: PickMode; durationSeconds?: number },
  ): RoomSnapshot | null {
    const normalized = normalizeCode(code);
    const current = this.db
      .prepare("SELECT mode, duration_seconds, round_number FROM rooms WHERE code = ?")
      .get(normalized) as
      | { mode: PickMode; duration_seconds: number; round_number: number }
      | undefined;

    if (current === undefined) {
      return null;
    }

    const nextMode = options?.mode ?? current.mode;
    const nextDuration =
      options?.durationSeconds !== undefined
        ? Math.min(3600, Math.max(1, Math.floor(options.durationSeconds)))
        : current.duration_seconds;

    return this.updateRoomState(normalized, {
      mode: nextMode,
      durationSeconds: nextDuration,
      remainingSeconds: nextDuration,
      phase: "lobby",
      roundNumber: current.round_number + 1,
    });
  }

  close(): void {
    this.db.close();
  }
}
