let dashboardBridge = null;

if (typeof require === "function") {
  try {
    const { ipcRenderer } = require("electron");
    dashboardBridge = ipcRenderer ?? null;
  } catch (error) {
    console.warn("IPC renderer unavailable for dashboard:", error);
  }
}

const PRIORITY_WEIGHTS = {
  urgent: 0.45,
  important: 0.28,
  routine: 0.12,
  draft: 0.05,
};

const TAG_KEYWORD_BOOSTS = {
  flood: 0.22,
  landslide: 0.24,
  wildfire: 0.18,
  fire: 0.16,
  drought: 0.14,
  erosion: 0.12,
  poaching: 0.18,
  pollution: 0.12,
  outbreak: 0.16,
  risk: 0.08,
};

const PROBABILITY_CLASS = {
  high: {
    marker: "marker--danger",
    riskLevel: "risk-level--high",
    dot: "risk-dot--high",
    label: "High",
    alertClass: "alert-item--critical",
  },
  medium: {
    marker: "marker--medium",
    riskLevel: "risk-level--medium",
    dot: "risk-dot--medium",
    label: "Medium",
    alertClass: "alert-item--field",
  },
  low: {
    marker: "marker--safe",
    riskLevel: "risk-level--low",
    dot: "risk-dot--low",
    label: "Low",
    alertClass: "alert-item--field",
  },
};

const MAP_BOUNDS = {
  minLat: 28.0,
  maxLat: 31.5,
  minLon: 77.0,
  maxLon: 81.5,
};

function sanitiseText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toPriorityKey(priority) {
  return sanitiseText(priority).toLowerCase();
}

function toTitleCase(value) {
  return sanitiseText(value)
    .toLowerCase()
    .replace(
      /(^|\s|[-_/])([a-z])/g,
      (match, prefix, letter) => `${prefix}${letter.toUpperCase()}`
    );
}

function getInitials(name) {
  const parts = sanitiseText(name).split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "EW";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function parseTags(rawTags) {
  return sanitiseText(rawTags)
    .split(/[,|]/)
    .map((tag) => toTitleCase(tag))
    .filter(Boolean);
}

function differenceInDays(fromDate, toDate = new Date()) {
  if (!fromDate) {
    return Infinity;
  }
  const from = new Date(fromDate);
  if (Number.isNaN(from.getTime())) {
    return Infinity;
  }
  const diffMs = toDate.getTime() - from.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

function formatRelativeTime(value) {
  if (!value) {
    return "—";
  }
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) {
    return "—";
  }
  const diffMs = target.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const { abs } = Math;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs(diffMinutes) < 60) {
    return rtf.format(Math.round(diffMinutes), "minute");
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (abs(diffHours) < 24) {
    return rtf.format(diffHours, "hour");
  }
  const diffDays = Math.round(diffHours / 24);
  if (abs(diffDays) < 30) {
    return rtf.format(diffDays, "day");
  }
  const diffMonths = Math.round(diffDays / 30);
  return rtf.format(diffMonths, "month");
}

function getRegionLabel(entry, tags) {
  if (tags.length) {
    return tags[0];
  }
  const city = sanitiseText(entry?.city);
  if (city) {
    return toTitleCase(city);
  }
  const category = sanitiseText(entry?.category);
  if (category) {
    return toTitleCase(category);
  }
  const species = sanitiseText(entry?.species);
  if (species) {
    return toTitleCase(species);
  }
  const latitude = sanitiseText(entry?.latitude);
  const longitude = sanitiseText(entry?.longitude);
  if (latitude && longitude) {
    return `${latitude}, ${longitude}`;
  }
  return "Field Observation";
}

function getRegionDescription(entry) {
  const category = sanitiseText(entry?.category);
  const species = sanitiseText(entry?.species);
  const behavior = sanitiseText(entry?.behavior);
  if (category && species) {
    return `${toTitleCase(category)} — ${toTitleCase(species)}`;
  }
  if (category) {
    return toTitleCase(category);
  }
  if (species) {
    return toTitleCase(species);
  }
  if (behavior) {
    return toTitleCase(behavior);
  }
  return "Observation logged by field team";
}

function deriveFactors(entry, tags) {
  const factors = tags.slice(0, 3);
  if (factors.length < 3) {
    const weather = sanitiseText(entry?.weather);
    if (weather) {
      factors.push(toTitleCase(weather));
    }
  }
  if (factors.length < 3) {
    const behavior = sanitiseText(entry?.behavior);
    if (behavior) {
      factors.push(toTitleCase(behavior));
    }
  }
  if (factors.length < 3) {
    const priorityKey = toPriorityKey(entry?.priority);
    if (priorityKey === "urgent") {
      factors.push("Urgent Response Required");
    } else if (priorityKey === "important") {
      factors.push("Field Team Follow-up");
    }
  }
  if (factors.length < 3) {
    factors.push("Environmental Baseline");
  }
  return factors.slice(0, 3);
}

function scoreEntry(entry) {
  let score = 0.22;
  const priorityWeight =
    PRIORITY_WEIGHTS[toPriorityKey(entry?.priority)] || 0.1;
  score += priorityWeight;

  const days = differenceInDays(entry?.recordedAt);
  if (days <= 3) {
    score += 0.25;
  } else if (days <= 7) {
    score += 0.16;
  } else if (days <= 30) {
    score += 0.08;
  } else if (Number.isFinite(days)) {
    score += 0.02;
  }

  const count = Number(entry?.individualCount);
  if (Number.isFinite(count) && count > 0) {
    score += Math.min(0.16, count * 0.018);
  }

  const temperature = Number(entry?.temperature);
  if (Number.isFinite(temperature)) {
    if (temperature >= 35) {
      score += 0.07;
    } else if (temperature <= 5) {
      score += 0.05;
    }
  }

  const tags = parseTags(entry?.tags);
  let tagBoost = 0;
  tags.forEach((tag) => {
    const key = tag.toLowerCase();
    Object.entries(TAG_KEYWORD_BOOSTS).forEach(([keyword, boost]) => {
      if (key.includes(keyword)) {
        tagBoost = Math.max(tagBoost, boost);
      }
    });
  });
  score += tagBoost;

  const category = sanitiseText(entry?.category).toLowerCase();
  if (category.includes("disaster") || category.includes("alert")) {
    score += 0.14;
  }

  score = Math.min(score, 0.97);

  const probability = Math.max(10, Math.round(score * 100));
  let riskLevel = "low";
  if (probability >= 70) {
    riskLevel = "high";
  } else if (probability >= 45) {
    riskLevel = "medium";
  }

  return {
    entry,
    tags,
    label: getRegionLabel(entry, tags),
    description: getRegionDescription(entry),
    factors: deriveFactors(entry, tags),
    probability,
    riskLevel,
    daysSince: days,
  };
}

function analyseEntries(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const scored = safeEntries.map((entry) => scoreEntry(entry));
  scored.sort((a, b) => b.probability - a.probability);

  const regionMap = new Map();
  scored.forEach((item) => {
    const key = sanitiseText(item.label).toLowerCase();
    const current = regionMap.get(key);
    if (!current || item.probability > current.probability) {
      regionMap.set(key, { ...item });
    }
  });

  const regions = Array.from(regionMap.values());

  const metrics = {
    total: safeEntries.length,
    uniqueRegions: regions.length,
    uniqueSpecies: new Set(
      safeEntries
        .map((entry) => sanitiseText(entry?.species).toLowerCase())
        .filter(Boolean)
    ).size,
    recentReports: safeEntries.filter(
      (entry) => differenceInDays(entry?.recordedAt) <= 7
    ).length,
  };

  const highRegions = regions.filter((region) => region.riskLevel === "high");
  const mediumRegions = regions.filter(
    (region) => region.riskLevel === "medium"
  );
  const safeRegions = Math.max(
    metrics.uniqueRegions - highRegions.length - mediumRegions.length,
    0
  );

  const counts = {
    high: highRegions.length,
    medium: mediumRegions.length,
    low: safeRegions,
  };

  return {
    scored,
    regions,
    counts,
    metrics,
    highRegions,
    mediumRegions,
  };
}

function setText(node, value) {
  if (!node) {
    return;
  }
  node.textContent = value;
}

function formatTemperature(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "—";
  }
  return `${Math.round(number)}°C`;
}

function formatHumidity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "—";
  }
  return `${Math.round(number)}%`;
}

function formatRainfall(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "No data";
  }
  if (number <= 0) {
    return "None";
  }
  return `${number.toFixed(1)} mm`;
}

function renderEnvironmentSummary(summary) {
  const card = document.getElementById("environment-card");
  if (!card) {
    return;
  }

  const updatedNode = document.getElementById("environment-updated");
  const temperatureNode = document.getElementById("env-temperature");
  const conditionNode = document.getElementById("env-condition");
  const humidityNode = document.getElementById("env-humidity");
  const rainfallNode = document.getElementById("env-rainfall");
  const aqiNode = document.getElementById("env-aqi");
  const aqiCategoryNode = document.getElementById("env-aqi-category");
  const alertSummaryNode = document.getElementById("env-alert-summary");
  const alertListNode = document.getElementById("env-alert-list");
  const earthquakeNode = document.getElementById("env-earthquake");
  const errorsSection = document.getElementById("environment-errors");
  const errorList = document.getElementById("env-error-list");

  const now = new Date();
  setText(
    updatedNode,
    `Updated ${now.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    })}`
  );

  const weather = summary?.weather || null;
  setText(temperatureNode, formatTemperature(weather?.temperature));
  setText(
    conditionNode,
    weather?.condition ? weather.condition : "Condition unavailable"
  );
  setText(humidityNode, formatHumidity(weather?.humidity));
  setText(rainfallNode, `Rainfall: ${formatRainfall(weather?.rainfall)}`);

  const airQuality = summary?.airQuality || null;
  if (airQuality?.index) {
    setText(aqiNode, airQuality.index.toString());
    setText(aqiCategoryNode, airQuality.category || "Category unavailable");
  } else {
    setText(aqiNode, "—");
    setText(aqiCategoryNode, "Air quality data unavailable");
  }

  if (alertListNode) {
    alertListNode.innerHTML = "";
  }

  const alerts = summary?.alerts || null;
  if (alerts?.summary) {
    setText(alertSummaryNode, alerts.summary);
  } else {
    setText(alertSummaryNode, "No major warnings today.");
  }

  if (
    alertListNode &&
    Array.isArray(alerts?.notices) &&
    alerts.notices.length
  ) {
    alertListNode.hidden = false;
    alerts.notices.slice(0, 4).forEach((notice) => {
      const item = document.createElement("li");
      item.textContent = notice;
      alertListNode.appendChild(item);
    });
  } else if (alertListNode) {
    alertListNode.hidden = true;
  }

  if (earthquakeNode) {
    const earthquakes = Array.isArray(summary?.earthquakes)
      ? summary.earthquakes
      : [];
    if (earthquakes.length) {
      const latest = earthquakes[0];
      const magnitude =
        Number(latest?.magnitude) && Number.isFinite(Number(latest.magnitude))
          ? `Magnitude ${Number(latest.magnitude).toFixed(1)}`
          : "Magnitude unavailable";
      const location = latest?.location || "Uttarakhand";
      const timeLabel = latest?.timestamp
        ? formatRelativeTime(latest.timestamp)
        : "recent";
      setText(earthquakeNode, `${magnitude} near ${location} · ${timeLabel}`);
    } else {
      setText(
        earthquakeNode,
        "No significant seismic activity reported in the last 24 hours."
      );
    }
  }

  if (errorsSection && errorList) {
    errorList.innerHTML = "";
    const issues = Array.isArray(summary?.errors)
      ? summary.errors.filter(Boolean)
      : [];
    if (issues.length) {
      issues.slice(0, 4).forEach((issue) => {
        const item = document.createElement("li");
        item.textContent = issue;
        errorList.appendChild(item);
      });
      errorsSection.hidden = false;
    } else {
      errorsSection.hidden = true;
    }
  }
}

function renderEnvironmentError(errorMessage) {
  const temperatureNode = document.getElementById("env-temperature");
  const conditionNode = document.getElementById("env-condition");
  const humidityNode = document.getElementById("env-humidity");
  const rainfallNode = document.getElementById("env-rainfall");
  const aqiNode = document.getElementById("env-aqi");
  const aqiCategoryNode = document.getElementById("env-aqi-category");
  const alertSummaryNode = document.getElementById("env-alert-summary");
  const alertListNode = document.getElementById("env-alert-list");
  const earthquakeNode = document.getElementById("env-earthquake");
  const errorsSection = document.getElementById("environment-errors");
  const errorList = document.getElementById("env-error-list");

  setText(temperatureNode, "—");
  setText(conditionNode, "Environmental feed unavailable");
  setText(humidityNode, "—");
  setText(rainfallNode, "Rainfall: —");
  setText(aqiNode, "—");
  setText(aqiCategoryNode, "Air quality data unavailable");
  setText(alertSummaryNode, "Environmental feeds unavailable.");
  if (alertListNode) {
    alertListNode.innerHTML = "";
    alertListNode.hidden = true;
  }
  setText(earthquakeNode, "Seismic feed unavailable.");

  if (errorsSection && errorList) {
    errorsSection.hidden = false;
    errorList.innerHTML = "";
    const item = document.createElement("li");
    item.textContent = errorMessage || "Unable to load environmental data.";
    errorList.appendChild(item);
  }
}

async function loadEnvironmentSummary() {
  if (!dashboardBridge || typeof dashboardBridge.invoke !== "function") {
    return;
  }

  try {
    const response = await dashboardBridge.invoke("environment:summary");
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load environment summary");
    }
    renderEnvironmentSummary(response.data);
  } catch (error) {
    console.error("Failed to load environment summary:", error);
    renderEnvironmentError(error?.message);
  }
}

function renderStats(metrics, counts) {
  setText(
    document.getElementById("stat-protected-areas"),
    metrics.uniqueRegions
      ? `${metrics.uniqueRegions} region${
          metrics.uniqueRegions === 1 ? "" : "s"
        }`
      : "Awaiting data"
  );

  setText(
    document.getElementById("stat-species-tracked"),
    metrics.uniqueSpecies
      ? `${metrics.uniqueSpecies} species`
      : "No species logged"
  );

  const totalAlerts = counts.high + counts.medium;
  setText(
    document.getElementById("stat-risk-alerts"),
    `${totalAlerts} alert${totalAlerts === 1 ? "" : "s"}`
  );

  setText(
    document.getElementById("stat-reports-week"),
    metrics.recentReports
      ? `${metrics.recentReports} entr${
          metrics.recentReports === 1 ? "y" : "ies"
        }`
      : "0 entries"
  );
}

function toMapPosition(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  const { minLat, maxLat, minLon, maxLon } = MAP_BOUNDS;
  if (
    lat < minLat - 2 ||
    lat > maxLat + 2 ||
    lon < minLon - 2 ||
    lon > maxLon + 2
  ) {
    return null;
  }
  const x = ((lon - minLon) / (maxLon - minLon)) * 100;
  const y = ((maxLat - lat) / (maxLat - minLat)) * 100;
  const clamp = (value) => Math.min(100, Math.max(0, value));
  return { x: clamp(x), y: clamp(y) };
}

function renderMapMarkers(regions) {
  const container = document.getElementById("map-markers");
  const placeholder = document.getElementById("map-marker-placeholder");
  if (!container) {
    return;
  }

  container.querySelectorAll(".marker").forEach((node) => node.remove());

  let created = 0;
  regions
    .filter(
      (region) => region.riskLevel === "high" || region.riskLevel === "medium"
    )
    .slice(0, 6)
    .forEach((region) => {
      const position = toMapPosition(
        region.entry?.latitude,
        region.entry?.longitude
      );
      if (!position) {
        return;
      }
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = `marker ${PROBABILITY_CLASS[region.riskLevel].marker}`;
      marker.style.setProperty("--x", `${position.x}%`);
      marker.style.setProperty("--y", `${position.y}%`);
      marker.setAttribute(
        "aria-label",
        `${region.label} — ${PROBABILITY_CLASS[region.riskLevel].label} risk`
      );
      container.appendChild(marker);
      created += 1;
    });

  if (placeholder) {
    placeholder.hidden = created > 0;
    if (!created) {
      placeholder.textContent = "Awaiting live geospatial data";
    }
  } else if (!created) {
    const fallback = document.createElement("div");
    fallback.id = "map-marker-placeholder";
    fallback.className = "map-marker-placeholder";
    fallback.textContent = "Awaiting live geospatial data";
    container.appendChild(fallback);
  }
}

function renderRiskList(regions) {
  const list = document.getElementById("risk-list");
  if (!list) {
    return;
  }

  list.innerHTML = "";

  if (!regions.length) {
    const placeholder = document.createElement("li");
    placeholder.className = "risk-row risk-row--placeholder";
    placeholder.textContent =
      "No risk data yet. Field submissions will appear here.";
    list.appendChild(placeholder);
    return;
  }

  const sorted = regions
    .slice()
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 6);

  sorted.forEach((region) => {
    const row = document.createElement("li");
    row.className = "risk-row";

    const info = document.createElement("div");
    info.className = "risk-info";

    const dot = document.createElement("span");
    dot.className = `risk-dot ${PROBABILITY_CLASS[region.riskLevel].dot}`;
    info.appendChild(dot);

    const textWrap = document.createElement("div");
    const zone = document.createElement("span");
    zone.className = "risk-zone";
    zone.textContent = region.label;
    const type = document.createElement("span");
    type.className = "risk-type";
    type.textContent = region.description;
    textWrap.appendChild(zone);
    textWrap.appendChild(type);
    info.appendChild(textWrap);

    const level = document.createElement("span");
    level.className = `risk-level ${
      PROBABILITY_CLASS[region.riskLevel].riskLevel
    }`;
    level.textContent = PROBABILITY_CLASS[region.riskLevel].label;

    row.appendChild(info);
    row.appendChild(level);
    list.appendChild(row);
  });
}

function createAlertItem(region) {
  const li = document.createElement("li");
  const classes = [
    "alert-item",
    PROBABILITY_CLASS[region.riskLevel].alertClass,
  ];
  li.className = classes.join(" ");

  const meta = document.createElement("div");
  meta.className = "alert-meta";

  const type = document.createElement("span");
  type.className = "alert-type";
  type.textContent = region.factors[0] || region.description;

  const location = document.createElement("span");
  location.className = "alert-location";
  location.textContent = region.label;

  meta.appendChild(type);
  meta.appendChild(location);

  if (region.factors[1]) {
    const note = document.createElement("span");
    note.className = "alert-note";
    note.textContent = region.factors[1];
    meta.appendChild(note);
  }

  const time = document.createElement("span");
  time.className = "alert-time";
  time.textContent = formatRelativeTime(region.entry?.recordedAt);

  li.appendChild(meta);
  li.appendChild(time);

  return li;
}

function renderAlerts(highRegions, mediumRegions, scored) {
  const criticalList = document.getElementById("alert-critical-list");
  const fieldList = document.getElementById("alert-field-list");

  if (criticalList) {
    criticalList.innerHTML = "";
    const criticalItems = highRegions
      .slice()
      .sort(
        (a, b) =>
          new Date(b.entry?.recordedAt || 0) -
          new Date(a.entry?.recordedAt || 0)
      )
      .slice(0, 4);

    if (!criticalItems.length) {
      const placeholder = document.createElement("li");
      placeholder.className = "alert-item alert-item--placeholder";
      placeholder.textContent =
        "No alerts available yet. Submit field data to see updates.";
      criticalList.appendChild(placeholder);
    } else {
      criticalItems.forEach((item) => {
        criticalList.appendChild(createAlertItem(item));
      });
    }
  }

  if (fieldList) {
    fieldList.innerHTML = "";
    const remaining = scored
      .filter((item) => item.riskLevel !== "high")
      .slice(0, 5);

    if (!remaining.length) {
      const placeholder = document.createElement("li");
      placeholder.className = "alert-item alert-item--placeholder";
      placeholder.textContent = "Waiting for system updates...";
      fieldList.appendChild(placeholder);
    } else {
      remaining.forEach((item) => {
        fieldList.appendChild(createAlertItem(item));
      });
    }
  }
}

async function loadFieldData() {
  if (!dashboardBridge || typeof dashboardBridge.invoke !== "function") {
    renderStats(
      { uniqueRegions: 0, uniqueSpecies: 0, recentReports: 0 },
      {
        high: 0,
        medium: 0,
        low: 0,
      }
    );
    renderMapMarkers([]);
    renderRiskList([]);
    renderAlerts([], [], []);
    return;
  }

  try {
    const response = await dashboardBridge.invoke("fieldData:list", {
      limit: 100,
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load field data");
    }

    const entries = response.data || [];
    const analysis = analyseEntries(entries);

    renderStats(analysis.metrics, analysis.counts);
    renderMapMarkers(analysis.regions);
    renderRiskList(analysis.regions);
    renderAlerts(analysis.highRegions, analysis.mediumRegions, analysis.scored);
  } catch (error) {
    console.error("Failed to load dashboard data:", error);
    renderStats(
      { uniqueRegions: 0, uniqueSpecies: 0, recentReports: 0 },
      {
        high: 0,
        medium: 0,
        low: 0,
      }
    );
    renderMapMarkers([]);
    renderRiskList([]);
    renderAlerts([], [], []);
  }
}

async function loadUserProfile() {
  if (!dashboardBridge || typeof dashboardBridge.invoke !== "function") {
    return;
  }

  try {
    const response = await dashboardBridge.invoke("userProfile:get");
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to fetch profile");
    }

    const profile = response.data;
    if (!profile) {
      return;
    }

    const userNameNode = document.getElementById("user-name");
    const userRoleNode = document.getElementById("user-role");
    const userAvatarNode = document.getElementById("user-avatar");

    if (userNameNode && profile.name) {
      userNameNode.textContent = profile.name;
    }

    if (userRoleNode) {
      const role = profile.city || profile.email || "Field Coordinator";
      userRoleNode.textContent = role;
    }

    if (userAvatarNode && profile.name) {
      userAvatarNode.textContent = getInitials(profile.name);
    }
  } catch (error) {
    console.error("Failed to load user profile for dashboard:", error);
  }
}

function initNavigation() {
  const navItems = document.querySelectorAll(".main-nav .nav-item");
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      navItems.forEach((btn) => btn.classList.remove("active"));
      item.classList.add("active");
    });
  });
}

function initToggleGroups() {
  const groups = [
    document.querySelectorAll(".map-layer-toggle .pill-button"),
    document.querySelectorAll(".map-tabs .pill-button"),
  ];

  groups.forEach((group) => {
    if (!group.length) {
      return;
    }
    group.forEach((button) => {
      button.addEventListener("click", () => {
        group.forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
      });
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initToggleGroups();
  loadUserProfile();
  loadFieldData();
  loadEnvironmentSummary();
});
