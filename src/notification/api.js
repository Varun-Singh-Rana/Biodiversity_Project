const DEFAULT_COORDINATES = {
  lat: 30.3165,
  lon: 78.0322,
};

const WEATHER_ENDPOINT = "https://api.openweathermap.org/data/2.5/weather";
const AIR_QUALITY_ENDPOINT =
  "https://api.openweathermap.org/data/2.5/air_pollution";
const IMD_ALERTS_URL =
  "https://mausam.imd.gov.in/imd_latest/contents/subdivisionwise-warning.php";
const EARTHQUAKE_URL =
  "https://riseq.seismo.gov.in/riseq/earthquake/recent_earthquake";

function getFetch() {
  if (typeof fetch === "function") {
    return fetch;
  }

  throw new Error(
    "Global fetch API is not available in this runtime. Please use Node.js 18 or later."
  );
}

function decodeHtmlEntities(value = "") {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#8211;/gi, "-")
    .replace(/&#8212;/gi, "-")
    .replace(/&#176;/gi, "°")
    .replace(/&#37;/gi, "%");
}

function stripHtml(input = "") {
  return decodeHtmlEntities(input)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value = "") {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatNumber(value, options = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  const { digits = 1 } = options;
  return Number(number.toFixed(digits));
}

async function fetchWeatherByCity(city) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENWEATHER_API_KEY is not configured");
  }

  const trimmedCity = (city || "").trim() || "Dehradun";
  const params = new URLSearchParams({
    q: trimmedCity,
    units: "metric",
    appid: apiKey,
  });

  const fetchFn = getFetch();
  const response = await fetchFn(`${WEATHER_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(
      `Weather API request failed with status ${response.status}`
    );
  }

  const data = await response.json();
  const weatherDescription =
    Array.isArray(data.weather) && data.weather.length
      ? data.weather[0].description || ""
      : "";

  const rainfall = data.rain ? data.rain["1h"] ?? data.rain["3h"] ?? 0 : 0;

  return {
    location: {
      city: toTitleCase(trimmedCity),
      country: data.sys?.country || "IN",
      latitude: data.coord?.lat ?? DEFAULT_COORDINATES.lat,
      longitude: data.coord?.lon ?? DEFAULT_COORDINATES.lon,
    },
    temperature: formatNumber(data.main?.temp, { digits: 0 }),
    condition: toTitleCase(weatherDescription || "Unavailable"),
    humidity: formatNumber(data.main?.humidity, { digits: 0 }),
    rainfall: formatNumber(rainfall, { digits: 1 }) ?? 0,
    source: WEATHER_ENDPOINT,
  };
}

function mapAqiCategory(value) {
  const categories = {
    1: "Good",
    2: "Fair",
    3: "Moderate",
    4: "Poor",
    5: "Very Poor",
  };
  return categories[value] || "Unavailable";
}

async function fetchAirQualityByCoords(latitude, longitude) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENWEATHER_API_KEY is not configured");
  }

  const lat = Number(latitude ?? DEFAULT_COORDINATES.lat);
  const lon = Number(longitude ?? DEFAULT_COORDINATES.lon);

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    appid: apiKey,
  });

  const fetchFn = getFetch();
  const response = await fetchFn(
    `${AIR_QUALITY_ENDPOINT}?${params.toString()}`
  );
  if (!response.ok) {
    throw new Error(
      `Air quality API request failed with status ${response.status}`
    );
  }

  const payload = await response.json();
  const reading = Array.isArray(payload.list) ? payload.list[0] : null;
  if (!reading) {
    throw new Error("Air quality data is missing in API response");
  }

  return {
    index: Number(reading.main?.aqi) || null,
    category: mapAqiCategory(reading.main?.aqi),
    components: reading.components || {},
    source: AIR_QUALITY_ENDPOINT,
  };
}

function extractTableRows(html) {
  const rows = [];
  const rowMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  rowMatches.forEach((row) => {
    const cells = [];
    const cellMatches = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
    cellMatches.forEach((cell) => {
      cells.push(stripHtml(cell));
    });
    if (cells.length) {
      rows.push(cells);
    }
  });
  return rows;
}

async function fetchUttarakhandAlerts() {
  const fetchFn = getFetch();
  const response = await fetchFn(IMD_ALERTS_URL, {
    headers: {
      "User-Agent": "EcoWatch-Dashboard/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`IMD alert request failed with status ${response.status}`);
  }

  const html = await response.text();
  const rows = extractTableRows(html);
  const targetRow = rows.find((row) =>
    row.some((cell) => cell.toLowerCase().includes("uttarakhand"))
  );

  if (!targetRow) {
    return {
      summary: "No major warnings today.",
      notices: [],
    };
  }

  const [, ...alertCells] = targetRow;
  const notices = alertCells
    .map((entry) => entry.replace(/\s+/g, " ").trim())
    .filter((entry) => entry && !/n\/a|nil|no warning/i.test(entry));

  return {
    summary: notices.length ? notices[0] : "No major warnings today.",
    notices,
  };
}

function parseEarthquakeDate(dateStr, timeStr) {
  const formattedDate = stripHtml(dateStr);
  const formattedTime = stripHtml(timeStr);

  const isoCandidate = `${formattedDate} ${formattedTime}`.trim();
  const normalised = isoCandidate
    .replace(/\//g, "-")
    .replace(/(\d{2})-(\d{2})-(\d{4})/g, "$3-$2-$1");

  const parsed = new Date(normalised);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

async function fetchUttarakhandEarthquakes() {
  const fetchFn = getFetch();
  const response = await fetchFn(EARTHQUAKE_URL, {
    headers: {
      "User-Agent": "EcoWatch-Dashboard/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Earthquake feed request failed with status ${response.status}`
    );
  }

  const html = await response.text();
  const rows = extractTableRows(html).filter((row) => row.length >= 6);

  const matches = rows
    .map((cells) => {
      const locationCell = cells[cells.length - 1] || "";
      if (!locationCell.toLowerCase().includes("uttarakhand")) {
        return null;
      }

      const dateTime = parseEarthquakeDate(cells[0], cells[1]);
      const magnitude = Number(cells[4]) || Number(cells[3]);
      return {
        location: stripHtml(locationCell),
        magnitude: magnitude ? Number(magnitude.toFixed(1)) : null,
        timestamp: dateTime,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0)
    );

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return matches.filter(
    (item) => item.timestamp && item.timestamp.getTime() >= cutoff
  );
}

async function collectEnvironmentalSummary(city) {
  const summary = {
    city: toTitleCase((city || "").trim() || "Dehradun"),
    weather: null,
    airQuality: null,
    alerts: null,
    earthquakes: [],
    errors: [],
  };

  let weatherData = null;
  try {
    weatherData = await fetchWeatherByCity(summary.city);
    summary.weather = weatherData;
  } catch (error) {
    summary.errors.push(`Weather: ${error.message}`);
  }

  try {
    const latitude = weatherData?.location?.latitude ?? DEFAULT_COORDINATES.lat;
    const longitude =
      weatherData?.location?.longitude ?? DEFAULT_COORDINATES.lon;
    summary.airQuality = await fetchAirQualityByCoords(latitude, longitude);
  } catch (error) {
    summary.errors.push(`Air Quality: ${error.message}`);
  }

  try {
    summary.alerts = await fetchUttarakhandAlerts();
  } catch (error) {
    summary.errors.push(`Alerts: ${error.message}`);
    summary.alerts = {
      summary: "Alerts service unavailable.",
      notices: [],
    };
  }

  try {
    summary.earthquakes = await fetchUttarakhandEarthquakes();
  } catch (error) {
    summary.errors.push(`Earthquakes: ${error.message}`);
  }

  return summary;
}

module.exports = {
  collectEnvironmentalSummary,
  fetchWeatherByCity,
  fetchAirQualityByCoords,
  fetchUttarakhandAlerts,
  fetchUttarakhandEarthquakes,
};
