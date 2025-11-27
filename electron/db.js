const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

let db;

function getDatabaseFilePath() {
  return resolveDatabasePath();
}

function resolveDatabasePath() {
  if (process.env.SQLITE_DB_PATH) {
    return path.resolve(process.env.SQLITE_DB_PATH);
  }

  let baseDir = null;

  try {
    const { app } = require("electron");
    if (app) {
      if (app.isPackaged) {
        const userData = app.getPath("userData");
        baseDir = path.join(userData, "EcoWatch");
      } else {
        baseDir = path.join(__dirname, "..", "data");
      }
    }
  } catch (error) {
    console.warn("[database] failed to resolve Electron app path:", error);
  }

  if (!baseDir) {
    baseDir = path.join(process.cwd(), "data");
  }

  return path.join(baseDir, "ecowatch.sqlite");
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

function all(dbInstance, sql, params = []) {
  return new Promise((resolve, reject) => {
    dbInstance.all(sql, params, (error, rows) => {
      if (error) {
        return reject(error);
      }
      resolve(rows || []);
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

  await exec(
    database,
    `CREATE TABLE IF NOT EXISTS field_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      latitude TEXT,
      longitude TEXT,
      category TEXT,
      species TEXT NOT NULL,
      age_group TEXT,
      behavior TEXT,
      individual_count INTEGER,
      weather TEXT,
      temperature REAL,
      visibility TEXT,
      notes TEXT,
      priority TEXT,
      tags TEXT
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

function sanitiseText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function sanitiseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function saveFieldData(entry = {}) {
  const database = getDatabase();

  const species = sanitiseText(entry.species);
  if (!species) {
    throw new Error("Species or subject is required");
  }

  const category = sanitiseText(entry.category);
  const ageGroup = sanitiseText(entry.ageGroup);
  const behavior = sanitiseText(entry.behavior);
  const weather = sanitiseText(entry.weather);
  const visibility = sanitiseText(entry.visibility);
  const notes = sanitiseText(entry.notes);
  const priority = sanitiseText(entry.priority);
  const tags = Array.isArray(entry.tags)
    ? entry.tags
        .map((tag) => sanitiseText(tag))
        .filter(Boolean)
        .join(", ")
    : sanitiseText(entry.tags);

  const latitude = sanitiseText(entry.latitude);
  const longitude = sanitiseText(entry.longitude);
  const individualCount = sanitiseNumber(entry.individualCount);
  const temperature = sanitiseNumber(entry.temperature);

  const statement = await run(
    database,
    `INSERT INTO field_data (
       latitude,
       longitude,
       category,
       species,
       age_group,
       behavior,
       individual_count,
       weather,
       temperature,
       visibility,
       notes,
       priority,
       tags,
       recorded_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      latitude || null,
      longitude || null,
      category || null,
      species,
      ageGroup || null,
      behavior || null,
      individualCount,
      weather || null,
      temperature,
      visibility || null,
      notes || null,
      priority || null,
      tags || null,
    ]
  );

  const saved = await get(
    database,
    `SELECT
       id,
       species,
       category,
       priority,
       individual_count AS individualCount,
       recorded_at AS recordedAt,
       latitude,
       longitude,
       tags
     FROM field_data
     WHERE id = ?`,
    [statement.lastID]
  );

  return saved;
}

async function listFieldData(limit = 10) {
  const database = getDatabase();

  const rows = await all(
    database,
    `SELECT
       id,
       species,
       category,
       priority,
       individual_count AS individualCount,
       recorded_at AS recordedAt,
       latitude,
       longitude,
       tags
     FROM field_data
     ORDER BY recorded_at DESC
     LIMIT ?`,
    [Math.max(1, Math.min(Number(limit) || 10, 100))]
  );

  return rows;
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
  saveFieldData,
  listFieldData,
  getDatabaseFilePath,
  closeDatabase,
};
