const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

let db;

function resolveDatabasePath() {
  if (process.env.SQLITE_DB_PATH) {
    return path.resolve(process.env.SQLITE_DB_PATH);
  }

  const defaultDir = path.join(__dirname, "..", "data");
  return path.join(defaultDir, "ecowatch.sqlite");
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

  db = new sqlite3.Database(databasePath);
  return db;
}

function exec(dbInstance, sql) {
  return new Promise((resolve, reject) => {
    dbInstance.exec(sql, (error) => {
      if (error) {
        return reject(error);
      }
      resolve();
    });
  });
}

function run(dbInstance, sql, params = []) {
  return new Promise((resolve, reject) => {
    dbInstance.run(sql, params, function runCallback(error) {
      if (error) {
        return reject(error);
      }
      resolve(this);
    });
  });
}

function get(dbInstance, sql, params = []) {
  return new Promise((resolve, reject) => {
    dbInstance.get(sql, params, (error, row) => {
      if (error) {
        return reject(error);
      }
      resolve(row);
    });
  });
}

async function initDatabase() {
  const database = getDatabase();
  await exec(
    database,
    `PRAGMA journal_mode = WAL;
     PRAGMA foreign_keys = ON;`
  );

  await exec(
    database,
    `CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      dob TEXT NOT NULL,
      city TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
}

function validateEmail(email) {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return pattern.test(email);
}

function normaliseDob(dob) {
  const parsed = new Date(dob);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date of birth");
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function saveUserProfile(payload) {
  const database = getDatabase();

  const name = (payload?.name || "").trim();
  const email = (payload?.email || "").trim().toLowerCase();
  const dob = (payload?.dob || "").trim();
  const city = (payload?.city || "").trim();

  if (!name) {
    throw new Error("Name is required");
  }

  if (name.length < 3) {
    throw new Error("Name should be at least three characters long");
  }

  if (!email) {
    throw new Error("Email address is required");
  }

  if (!validateEmail(email)) {
    throw new Error("Email address is invalid");
  }

  if (!dob) {
    throw new Error("Date of birth is required");
  }

  const normalisedDob = normaliseDob(dob);
  const today = new Date();
  const dobDate = new Date(normalisedDob);
  if (dobDate > today) {
    throw new Error("Date of birth cannot be in the future");
  }

  if (!city) {
    throw new Error("City is required");
  }

  await run(
    database,
    `INSERT INTO user_profile (id, name, email, dob, city, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       email = excluded.email,
       dob = excluded.dob,
       city = excluded.city,
       updated_at = CURRENT_TIMESTAMP`,
    [name, email, normalisedDob, city]
  );

  return getUserProfile();
}

async function getUserProfile() {
  const database = getDatabase();
  const row = await get(
    database,
    `SELECT id, name, email, dob, city, created_at AS createdAt, updated_at AS updatedAt
       FROM user_profile
       WHERE id = 1`
  );
  return row || null;
}

async function hasUserProfile() {
  const database = getDatabase();
  const row = await get(
    database,
    "SELECT 1 AS hasProfile FROM user_profile WHERE id = 1 LIMIT 1"
  );
  return Boolean(row);
}

function closeDatabase() {
  return new Promise((resolve) => {
    if (!db) {
      resolve();
      return;
    }

    db.close((error) => {
      if (error) {
        console.error("[database] failed to close database:", error);
      }
      db = null;
      resolve();
    });
  });
}

module.exports = {
  initDatabase,
  saveUserProfile,
  getUserProfile,
  hasUserProfile,
  closeDatabase,
};
