const { Pool } = require("pg");
const crypto = require("crypto");

let pool;

function buildPool() {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL;
  const sslRequired = process.env.PGSSLMODE === "require";

  if (!connectionString) {
    const missing = [
      ["PGDATABASE", process.env.PGDATABASE],
      ["PGUSER", process.env.PGUSER],
      ["PGPASSWORD", process.env.PGPASSWORD],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length) {
      throw new Error(
        `Missing PostgreSQL connection settings: ${missing.join(", ")}. ` +
          "Provide DATABASE_URL or the individual PG* environment variables."
      );
    }
  }

  const config = connectionString
    ? {
        connectionString,
        ssl: sslRequired ? { rejectUnauthorized: false } : undefined,
      }
    : {
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: sslRequired ? { rejectUnauthorized: false } : undefined,
      };

  pool = new Pool(config);
  return pool;
}

async function initDatabase() {
  const client = buildPool();
  await client.query(`
    CREATE TABLE IF NOT EXISTS login_audit (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      access_mode TEXT NOT NULL,
      department_id TEXT NOT NULL,
      email TEXT,
      institution TEXT,
      password_hash TEXT,
      otp_hash TEXT,
      access_code_hash TEXT,
      metadata JSONB DEFAULT '{}'::JSONB
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
  const db = buildPool();

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

  const result = await db.query(
    `INSERT INTO login_audit (
        access_mode,
        department_id,
        email,
        institution,
        password_hash,
        otp_hash,
        access_code_hash,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, created_at
    `,
    [
      mode,
      departmentId,
      email,
      institution,
      passwordHash,
      otpHash,
      accessCodeHash,
      JSON.stringify(metadata),
    ]
  );

  return {
    id: result.rows[0].id,
    createdAt: result.rows[0].created_at,
  };
}

function closeDatabase() {
  if (pool) {
    pool.end().catch((error) => {
      console.error("[database] failed to close pool:", error);
    });
  }
}

module.exports = {
  initDatabase,
  saveLoginSubmission,
  closeDatabase,
};
