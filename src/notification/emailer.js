const nodemailer = require("nodemailer");

const { getUserProfile } = require("../../electron/db");
const { collectEnvironmentalSummary } = require("./api");

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

function formatTemperature(value) {
  if (value === null || value === undefined) {
    return "Data unavailable";
  }
  return `${value}\u00B0C`;
}

function formatHumidity(value) {
  if (value === null || value === undefined) {
    return "Data unavailable";
  }
  return `${value}%`;
}

function formatRainfall(value) {
  if (value === null || value === undefined) {
    return "No rainfall expected";
  }
  if (value === 0) {
    return "No rainfall expected";
  }
  return `${value} mm`;
}

function formatAqiSection(airQuality) {
  if (!airQuality?.index) {
    return "Air quality data unavailable.";
  }
  return `Air Quality Index: ${airQuality.index} / 5 (${airQuality.category}).`;
}

function formatAlertsSection(alerts) {
  if (!alerts) {
    return "Alerts service unavailable.";
  }

  if (alerts.notices && alerts.notices.length) {
    return alerts.notices.join("\n");
  }

  return alerts.summary || "No major warnings today.";
}

function formatEarthquakeSection(earthquakes) {
  if (!Array.isArray(earthquakes) || !earthquakes.length) {
    return "No significant seismic activity recorded in Uttarakhand in the last 24 hours.";
  }

  const [latest] = earthquakes;
  const magnitudeText = latest.magnitude
    ? `Magnitude ${latest.magnitude.toFixed(1)}`
    : "Magnitude not reported";
  const locationText = latest.location || "Uttarakhand";
  const timeText = latest.timestamp
    ? latest.timestamp.toLocaleString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        day: "numeric",
        month: "short",
      })
    : "Recent";

  return `${magnitudeText} near ${locationText} (${timeText}).`;
}

function buildEmailContent(user, summary) {
  const recipientName = user?.name ? user.name.trim() : "there";
  const cityName = summary?.city || user?.city || "Uttarakhand";
  const date = new Date();
  const subjectDate = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const weather = {
    temperature: summary?.weather?.temperature,
    condition: summary?.weather?.condition,
    humidity: summary?.weather?.humidity,
    rainfall: summary?.weather?.rainfall,
  };

  const html = `
    <p>Hello ${recipientName},</p>
    <p>Here is your daily environmental summary for ${cityName}:</p>
    <ul style="list-style:none;padding:0;margin:0;line-height:1.8;">
      <li>🌡️ <strong>Temperature:</strong> ${formatTemperature(
        weather.temperature
      )}</li>
      <li>🌦️ <strong>Condition:</strong> ${
        weather.condition || "Data unavailable"
      }</li>
      <li>💧 <strong>Humidity:</strong> ${formatHumidity(weather.humidity)}</li>
      <li>🌧️ <strong>Rainfall Expected:</strong> ${formatRainfall(
        weather.rainfall
      )}</li>
      <li>🏙️ <strong>${formatAqiSection(summary?.airQuality)}</strong></li>
      <li>⚠️ <strong>Alerts:</strong> ${formatAlertsSection(
        summary?.alerts
      ).replace(/\n/g, "<br/>")}</li>
    </ul>
    <p><strong>Earthquake Updates:</strong><br/>${formatEarthquakeSection(
      summary?.earthquakes
    )}</p>
    <p>Stay safe and stay informed!<br/>-- EcoWatch</p>
  `;

  const textSections = [
    `🌡️ Temperature: ${formatTemperature(weather.temperature)}`,
    `🌦️ Condition: ${weather.condition || "Data unavailable"}`,
    `💧 Humidity: ${formatHumidity(weather.humidity)}`,
    `🌧️ Rainfall Expected: ${formatRainfall(weather.rainfall)}`,
    `🏙️ ${formatAqiSection(summary?.airQuality)}`,
    `⚠️ Alerts: ${formatAlertsSection(summary?.alerts).replace(/\n/g, "; ")}`,
    "",
    "Earthquake Updates:",
    formatEarthquakeSection(summary?.earthquakes),
    "",
    "Stay safe and stay informed!",
    "-- EcoWatch",
  ].join("\n");

  return {
    subject: `Daily Environmental Update for ${cityName} - EcoWatch`,
    html,
    text: `Hello ${recipientName},

Here is your daily environmental summary for ${cityName} (${subjectDate}):

${textSections}
`,
  };
}

async function sendDigestEmail(options = {}) {
  const user = await getUserProfile();
  if (!user?.email) {
    throw new Error("User profile email is not available");
  }

  const summary = await collectEnvironmentalSummary(user?.city);
  const transport = options.transport || createTransport();
  const fromAddress =
    options.from || process.env.NOTIFY_FROM || transport.options?.auth?.user;
  if (!fromAddress) {
    throw new Error("Sender address is not configured");
  }

  const message = buildEmailContent(user, summary);
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
    issuedAt: new Date().toISOString(),
  };
}

module.exports = {
  sendDigestEmail,
  buildEmailContent,
  createTransport,
  collectEnvironmentalSummary,
};
