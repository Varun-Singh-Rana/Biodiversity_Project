const nodemailer = require("nodemailer");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const { getUserProfile } = require("../../electron/db");

const DIGEST_TABLE_SQL = `CREATE TABLE IF NOT EXISTS environment_digest (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	weather_summary TEXT,
	aqi_index INTEGER,
	aqi_category TEXT,
	earthquake_origin TEXT,
	earthquake_magnitude REAL,
	earthquake_details TEXT,
	rainfall_report TEXT,
	snowfall_report TEXT,
	landslide_report TEXT,
	other_alerts TEXT,
	issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

let digestTableEnsured = false;

function getDatabasePath() {
  const custom = process.env.SQLITE_DB_PATH;
  if (custom) {
    return path.resolve(custom);
  }
  return path.join(__dirname, "..", "..", "data", "ecowatch.sqlite");
}

function openDatabase() {
  const databasePath = getDatabasePath();
  const targetDir = path.dirname(databasePath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  return new sqlite3.Database(databasePath);
}

function ensureDigestTable(db) {
  if (digestTableEnsured) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    db.exec(DIGEST_TABLE_SQL, (error) => {
      if (error) {
        reject(error);
        return;
      }
      digestTableEnsured = true;
      resolve();
    });
  });
}

function closeDatabase(db) {
  return new Promise((resolve) => {
    db.close(() => resolve());
  });
}

async function fetchLatestDigest() {
  const db = openDatabase();

  try {
    await ensureDigestTable(db);
    const row = await new Promise((resolve, reject) => {
      db.get(
        `SELECT weather_summary AS weatherSummary,
								aqi_index AS aqiIndex,
								aqi_category AS aqiCategory,
								earthquake_origin AS earthquakeOrigin,
								earthquake_magnitude AS earthquakeMagnitude,
								earthquake_details AS earthquakeDetails,
								rainfall_report AS rainfallReport,
								snowfall_report AS snowfallReport,
								landslide_report AS landslideReport,
								other_alerts AS otherAlerts,
								issued_at AS issuedAt
					 FROM environment_digest
					 ORDER BY datetime(issued_at) DESC
					 LIMIT 1`,
        (error, data) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(data || null);
        }
      );
    });

    return row;
  } catch (error) {
    if (/no such table/i.test(error.message)) {
      return null;
    }
    throw error;
  } finally {
    await closeDatabase(db);
  }
}

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  if (!host) {
    throw new Error("SMTP_HOST is not configured");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });
}

function formatEarthquakeDetails(digest) {
  if (!digest) {
    return "No earthquake alerts reported.";
  }

  const { earthquakeDetails, earthquakeMagnitude, earthquakeOrigin } = digest;
  if (!earthquakeDetails && !earthquakeMagnitude && !earthquakeOrigin) {
    return "No earthquake alerts reported.";
  }

  const hasMagnitude =
    earthquakeMagnitude !== null &&
    earthquakeMagnitude !== undefined &&
    `${earthquakeMagnitude}`.trim() !== "";
  const numericMagnitude = Number(earthquakeMagnitude);
  const magnitude = hasMagnitude
    ? Number.isFinite(numericMagnitude)
      ? `Magnitude ${numericMagnitude.toFixed(1)}`
      : `Magnitude ${earthquakeMagnitude}`
    : "Magnitude not reported";
  const origin = earthquakeOrigin || "Uttarakhand";
  const summary = earthquakeDetails || "Earthquake alert issued.";

  return `${summary} ${magnitude} near ${origin}.`;
}

function buildEmailContent(user, digest) {
  const recipientName = user?.name ? user.name.trim() : "there";
  const issuedDate = digest?.issuedAt ? new Date(digest.issuedAt) : new Date();
  const subjectDate = issuedDate.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const sections = [
    {
      title: "Weather Update",
      text:
        digest?.weatherSummary?.trim() ||
        "No weather update recorded for today.",
    },
    {
      title: "Air Quality Index",
      text: digest?.aqiIndex
        ? `Current AQI is ${digest.aqiIndex}${
            digest?.aqiCategory ? ` (${digest.aqiCategory})` : ""
          }.`
        : "No AQI data recorded.",
    },
    {
      title: "Earthquake Alert",
      text: formatEarthquakeDetails(digest),
    },
    {
      title: "Rainfall",
      text: digest?.rainfallReport?.trim() || "No rainfall information shared.",
    },
    {
      title: "Snowfall",
      text: digest?.snowfallReport?.trim() || "No snowfall information shared.",
    },
    {
      title: "Landslide",
      text:
        digest?.landslideReport?.trim() || "No landslide advisories issued.",
    },
    {
      title: "Additional Alerts",
      text:
        digest?.otherAlerts?.trim() || "No additional alerts from authorities.",
    },
  ];

  const htmlSections = sections
    .map(
      (section) =>
        `<h3>${section.title}</h3><p>${section.text.replace(
          /\n/g,
          "<br/>"
        )}</p>`
    )
    .join("\n");

  const textSections = sections
    .map((section) => `${section.title}: ${section.text}`)
    .join("\n\n");

  const html = `
		<p>Hi ${recipientName},</p>
		<p>Here is your EcoWatch update for Uttarakhand (${subjectDate}).</p>
		${htmlSections}
		<p>Stay safe,<br/>EcoWatch</p>
	`;

  const text = `Hi ${recipientName},

Here is your EcoWatch update for Uttarakhand (${subjectDate}).

${textSections}

Stay safe,
EcoWatch`;

  return {
    subject: `EcoWatch update for ${subjectDate}`,
    html,
    text,
  };
}

async function sendDigestEmail(options = {}) {
  const user = await getUserProfile();
  if (!user?.email) {
    throw new Error("User profile email is not available");
  }

  const digest = await fetchLatestDigest();
  const transport = options.transport || createTransport();
  const fromAddress =
    options.from || process.env.NOTIFY_FROM || transport.options?.auth?.user;
  if (!fromAddress) {
    throw new Error("Sender address is not configured");
  }

  const message = buildEmailContent(user, digest);
  const recipient = options.to || user.email;

  await transport.sendMail({
    to: recipient,
    from: fromAddress,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  return {
    to: recipient,
    subject: message.subject,
    issuedAt: digest?.issuedAt || null,
  };
}

module.exports = {
  fetchLatestDigest,
  sendDigestEmail,
  buildEmailContent,
  createTransport,
};
