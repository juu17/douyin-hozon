import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as BetterDb, Statement } from "better-sqlite3";

// SQLite schema mirrored from upstream's storage/database.py:Database.
// Keeping this byte-for-byte compatible means a user can point the engine
// at an existing dy_downloader.db and incremental skip still works.
//
// Tables: aweme (the only one v2 reads/writes), download_history (writeable),
// transcript_job (created so upstream's CLI can keep coexisting on the same
// db file; v2 doesn't read it).

const SCHEMA_AWEME = `
  CREATE TABLE IF NOT EXISTS aweme (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aweme_id TEXT UNIQUE NOT NULL,
    aweme_type TEXT NOT NULL,
    title TEXT,
    author_id TEXT,
    author_name TEXT,
    create_time INTEGER,
    download_time INTEGER,
    file_path TEXT,
    metadata TEXT
  )
`;

const SCHEMA_HISTORY = `
  CREATE TABLE IF NOT EXISTS download_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    url_type TEXT NOT NULL,
    download_time INTEGER,
    total_count INTEGER,
    success_count INTEGER,
    config TEXT
  )
`;

const SCHEMA_TRANSCRIPT = `
  CREATE TABLE IF NOT EXISTS transcript_job (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aweme_id TEXT NOT NULL,
    video_path TEXT NOT NULL,
    transcript_dir TEXT,
    text_path TEXT,
    json_path TEXT,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    skip_reason TEXT,
    error_message TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(aweme_id, video_path, model)
  )
`;

const INDEX_STATEMENTS = [
  "CREATE INDEX IF NOT EXISTS idx_aweme_id ON aweme(aweme_id)",
  "CREATE INDEX IF NOT EXISTS idx_author_id ON aweme(author_id)",
  "CREATE INDEX IF NOT EXISTS idx_download_time ON aweme(download_time)",
  "CREATE INDEX IF NOT EXISTS idx_transcript_aweme_id ON transcript_job(aweme_id)",
  "CREATE INDEX IF NOT EXISTS idx_transcript_status ON transcript_job(status)",
];

export interface AwemeRecord {
  aweme_id: string;
  aweme_type: string;
  title: string | null;
  author_id: string | null;
  author_name: string | null;
  create_time: number | null;
  file_path: string | null;
  metadata: string | null;
}

export interface HistoryRecord {
  url: string;
  url_type: string;
  total_count: number;
  success_count: number;
  config: string | null;
}

export class DedupeDb {
  private db: BetterDb;
  private isDownloadedStmt: Statement;
  private upsertAwemeStmt: Statement;
  private latestAwemeTimeStmt: Statement;
  private addHistoryStmt: Statement;
  private countByAuthorStmt: Statement;

  constructor(filePath: string) {
    // Ensure the parent dir exists (e.g. `download-db/` for the default
    // path) — better-sqlite3 won't create missing directories on its own.
    const parentDir = path.dirname(filePath);
    if (parentDir && parentDir !== "." && !fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_AWEME);
    this.db.exec(SCHEMA_HISTORY);
    this.db.exec(SCHEMA_TRANSCRIPT);
    for (const idx of INDEX_STATEMENTS) this.db.exec(idx);

    this.isDownloadedStmt = this.db.prepare(
      "SELECT 1 FROM aweme WHERE aweme_id = ? LIMIT 1",
    );
    this.upsertAwemeStmt = this.db.prepare(`
      INSERT INTO aweme (aweme_id, aweme_type, title, author_id, author_name, create_time, download_time, file_path, metadata)
      VALUES (@aweme_id, @aweme_type, @title, @author_id, @author_name, @create_time, @download_time, @file_path, @metadata)
      ON CONFLICT(aweme_id) DO UPDATE SET
        aweme_type = excluded.aweme_type,
        title = excluded.title,
        author_id = excluded.author_id,
        author_name = excluded.author_name,
        create_time = excluded.create_time,
        download_time = excluded.download_time,
        file_path = excluded.file_path,
        metadata = excluded.metadata
    `);
    this.latestAwemeTimeStmt = this.db.prepare(
      "SELECT MAX(create_time) as ts FROM aweme WHERE author_id = ?",
    );
    this.addHistoryStmt = this.db.prepare(`
      INSERT INTO download_history (url, url_type, download_time, total_count, success_count, config)
      VALUES (@url, @url_type, @download_time, @total_count, @success_count, @config)
    `);
    this.countByAuthorStmt = this.db.prepare(
      "SELECT COUNT(*) as n FROM aweme WHERE author_id = ?",
    );
  }

  isDownloaded(awemeId: string): boolean {
    return this.isDownloadedStmt.get(awemeId) !== undefined;
  }

  addAweme(record: AwemeRecord): void {
    this.upsertAwemeStmt.run({
      ...record,
      download_time: Math.floor(Date.now() / 1000),
    });
  }

  latestAwemeTime(authorId: string): number | null {
    const row = this.latestAwemeTimeStmt.get(authorId) as { ts: number | null } | undefined;
    return row?.ts ?? null;
  }

  countByAuthor(authorId: string): number {
    const row = this.countByAuthorStmt.get(authorId) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  addHistory(record: HistoryRecord): void {
    this.addHistoryStmt.run({
      ...record,
      download_time: Math.floor(Date.now() / 1000),
    });
  }

  close(): void {
    this.db.close();
  }
}
