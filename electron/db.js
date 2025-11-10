const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

let db;

function resolveDatabasePath() {
  if (process.env.SQLITE_DB_PATH) {
    return path.resolve(process.env.SQLITE_DB_PATH);
  }

  const defaultDir = path.join(__dirname, "..", "data");
  return path.join(defaultDir, "ecowatch.db");
}

function ensureDirectory(targetPath) {
  const directory = path.dirname(targetPath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function getDatabase() {
  if (db) {
    return db;
  }

  const databasePath = resolveDatabasePath();
  ensureDirectory(databasePath);

  db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return db;
}

async function initDatabase() {
  const database = getDatabase();
  database.exec(`
    CREATE TABLE IF NOT EXISTS login_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      access_mode TEXT NOT NULL,
      department_id TEXT NOT NULL,
      email TEXT,
      institution TEXT,
      password_hash TEXT,
      otp_hash TEXT,
      access_code_hash TEXT,
      metadata TEXT DEFAULT '{}'
    )
  `);
}

function hashSensitiveField(value) {
  if (!value) {
    return null;
  }

  const salt = process.env.LOGIN_HASH_SALT || "ecowatch-salt";
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

async function saveLoginSubmission(payload) {
  const database = getDatabase();

  const mode = payload?.mode === "department" ? "department" : "guest";
  const departmentId = (payload?.departmentId || "").trim();
  const email = (payload?.email || "").trim() || null;
  const institution = (payload?.institution || "").trim() || null;
  const passwordHash = hashSensitiveField(payload?.password || null);
  const otpHash = hashSensitiveField(payload?.otp || null);
  const accessCodeHash = hashSensitiveField(payload?.accessCode || null);

  if (!departmentId) {
    throw new Error("Department ID is required");
  }

  if (mode === "guest") {
    if (!email) {
      throw new Error("Email address is required for guest access");
    }
    if (!institution) {
      throw new Error("Institution/Organization is required for guest access");
    }
    if (!accessCodeHash) {
      throw new Error("Guest access code is required");
    }
  } else {
    if (!passwordHash) {
      throw new Error("Password is required for department login");
    }
  }

  const metadata = {
    raw: {
      hasPassword: Boolean(payload?.password),
      hasOtp: Boolean(payload?.otp),
      hasAccessCode: Boolean(payload?.accessCode),
    },
    version: 1,
  };

  const insert = database.prepare(`
    INSERT INTO login_audit (
      access_mode,
      department_id,
      email,
      institution,
      password_hash,
      otp_hash,
      access_code_hash,
      metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const metadataJson = JSON.stringify(metadata);
  const info = insert.run(
    mode,
    departmentId,
    email,
    institution,
    passwordHash,
    otpHash,
    accessCodeHash,
    metadataJson
  );

  const createdRow = database
    .prepare("SELECT created_at FROM login_audit WHERE id = ?")
    .get(info.lastInsertRowid);

  return {
    id: info.lastInsertRowid,
    createdAt: createdRow?.created_at || null,
  };
}

function closeDatabase() {
  if (db) {
    try {
      db.close();
    } catch (error) {
      console.error("[database] failed to close database:", error);
    } finally {
      db = null;
    }
  }
}

module.exports = {
  initDatabase,
  saveLoginSubmission,
  closeDatabase,
};
