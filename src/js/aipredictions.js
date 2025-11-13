let aiPredictionsBridge = null;

if (typeof require === "function") {
  try {
    const { ipcRenderer } = require("electron");
    aiPredictionsBridge = ipcRenderer ?? null;
  } catch (error) {
    console.warn("IPC renderer unavailable for AI predictions:", error);
  }
}

const PRIORITY_WEIGHTS = {
  urgent: 0.45,
  important: 0.3,
  routine: 0.15,
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
  high: "probability--high",
  medium: "probability--medium",
  low: "probability--low",
};

function sanitiseText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toPriorityKey(priority) {
  return sanitiseText(priority).toLowerCase();
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

function toTitleCase(value) {
  return sanitiseText(value)
    .toLowerCase()
    .replace(
      /(^|\s|[-_/])([a-z])/g,
      (match, prefix, letter) => `${prefix}${letter.toUpperCase()}`
    );
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

function deriveFactorList(entry, tags) {
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
  let score = 0.25;

  const priorityWeight =
    PRIORITY_WEIGHTS[toPriorityKey(entry?.priority)] || 0.12;
  score += priorityWeight;

  const days = differenceInDays(entry?.recordedAt);
  if (days <= 3) {
    score += 0.25;
  } else if (days <= 7) {
    score += 0.17;
  } else if (days <= 30) {
    score += 0.08;
  } else if (Number.isFinite(days)) {
    score += 0.03;
  }

  const count = Number(entry?.individualCount);
  if (Number.isFinite(count) && count > 0) {
    score += Math.min(0.18, count * 0.02);
  }

  const temperature = Number(entry?.temperature);
  if (Number.isFinite(temperature)) {
    if (temperature >= 35) {
      score += 0.08;
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
    score += 0.16;
  }

  score = Math.min(score, 0.98);

  const probability = Math.max(12, Math.round(score * 100));
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
    factors: deriveFactorList(entry, tags),
    probability,
    riskLevel,
    fill: Math.min(0.98, Math.max(0.18, probability / 100)),
    daysSince: days,
  };
}

function analysePredictions(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  if (!safeEntries.length) {
    return {
      predictions: [],
      counts: { high: 0, medium: 0, low: 0 },
      summary: {
        total: 0,
        submittedThisWeek: 0,
        recentHigh: 0,
        highActive: 0,
        topRegion: "—",
        topRegionMeta: "Waiting for analytics",
      },
    };
  }

  const scored = safeEntries.map((entry) => scoreEntry(entry));
  scored.sort((a, b) => b.probability - a.probability);

  const uniqueByLabel = new Map();
  scored.forEach((item) => {
    const key = item.label.toLowerCase();
    const current = uniqueByLabel.get(key);
    if (!current || item.probability > current.probability) {
      uniqueByLabel.set(key, item);
    }
  });

  const allPredictions = Array.from(uniqueByLabel.values());
  const predictions = allPredictions.slice(0, 6);

  const counts = {
    high: 0,
    medium: 0,
    low: 0,
  };

  allPredictions.forEach((item) => {
    const key = item.riskLevel;
    if (key === "high" || key === "medium" || key === "low") {
      counts[key] += 1;
    }
  });

  const submittedThisWeek = scored.filter((item) => item.daysSince <= 7).length;

  const recentHigh = scored.filter(
    (item) => item.riskLevel === "high" && item.daysSince <= 7
  ).length;

  const topPrediction = predictions[0];

  const safeRegions = Math.max(
    safeEntries.length - counts.high - counts.medium,
    0
  );
  counts.low = safeRegions;

  const summary = {
    total: safeEntries.length,
    submittedThisWeek,
    recentHigh,
    highActive: counts.high,
    topRegion: topPrediction ? topPrediction.label : "—",
    topRegionMeta: topPrediction
      ? `${topPrediction.probability}% risk • ${toTitleCase(
          topPrediction.riskLevel
        )}`
      : "Waiting for analytics",
  };

  return { predictions, counts, summary };
}

function setText(node, value) {
  if (!node) {
    return;
  }
  node.textContent = value;
}

function renderPredictions(predictions, listNode) {
  if (!listNode) {
    return;
  }

  listNode.innerHTML = "";

  if (!predictions.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "prediction-item prediction-item--empty";
    emptyItem.textContent =
      listNode.dataset.emptyMessage ||
      "No AI predictions yet. Submit field data to generate insights.";
    listNode.appendChild(emptyItem);
    return;
  }

  predictions.forEach((prediction) => {
    const item = document.createElement("li");
    item.className = "prediction-item";

    const header = document.createElement("div");
    header.className = "prediction-item__header";

    const meta = document.createElement("div");
    meta.className = "prediction-meta";

    const dot = document.createElement("span");
    dot.className = `risk-dot risk-dot--${prediction.riskLevel}`;
    dot.setAttribute("aria-hidden", "true");

    const textGroup = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = prediction.label;
    const subtitle = document.createElement("span");
    subtitle.textContent = prediction.description;
    textGroup.appendChild(title);
    textGroup.appendChild(subtitle);

    meta.appendChild(dot);
    meta.appendChild(textGroup);

    const probability = document.createElement("span");
    probability.className = `probability ${
      PROBABILITY_CLASS[prediction.riskLevel]
    }`;
    probability.textContent = `${prediction.probability}% Probability`;

    header.appendChild(meta);
    header.appendChild(probability);
    item.appendChild(header);

    const progress = document.createElement("div");
    progress.className = "prediction-bar";
    progress.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.style.setProperty("--fill", prediction.fill.toFixed(2));
    progress.appendChild(fill);
    item.appendChild(progress);

    const factors = document.createElement("div");
    factors.className = "prediction-factors";
    factors.setAttribute("aria-label", "Contributing factors");

    prediction.factors.forEach((factor) => {
      const chip = document.createElement("span");
      chip.className = "factor-chip";
      chip.textContent = factor;
      factors.appendChild(chip);
    });

    item.appendChild(factors);
    listNode.appendChild(item);
  });
}

function updateRiskTiles(counts) {
  const highNode = document.getElementById("risk-high-count");
  const mediumNode = document.getElementById("risk-medium-count");
  const lowNode = document.getElementById("risk-low-count");

  setText(highNode, counts.high.toString());
  setText(mediumNode, counts.medium.toString());
  setText(lowNode, counts.low.toString());
}

function updateInsights(summary) {
  const totalNode = document.getElementById("insight-total-observations");
  const totalMetaNode = document.getElementById("insight-total-trend");
  const highRiskNode = document.getElementById("insight-high-risk-count");
  const highRiskMetaNode = document.getElementById("insight-high-risk-meta");
  const regionNode = document.getElementById("insight-top-region");
  const regionMetaNode = document.getElementById("insight-top-region-meta");

  setText(totalNode, summary.total.toString());
  if (summary.submittedThisWeek) {
    setText(totalMetaNode, `+${summary.submittedThisWeek} this week`);
  } else {
    setText(totalMetaNode, "No new submissions this week");
  }

  setText(highRiskNode, summary.highActive.toString());
  if (summary.recentHigh) {
    setText(
      highRiskMetaNode,
      `${summary.recentHigh} urgent ${
        summary.recentHigh === 1 ? "alert" : "alerts"
      } in last 7 days`
    );
  } else {
    setText(highRiskMetaNode, "No urgent alerts logged this week");
  }

  setText(regionNode, summary.topRegion);
  setText(regionMetaNode, summary.topRegionMeta);
}

async function loadPredictions() {
  if (
    !aiPredictionsBridge ||
    typeof aiPredictionsBridge.invoke !== "function"
  ) {
    const listNode = document.getElementById("prediction-list");
    renderPredictions([], listNode);
    updateRiskTiles({ high: 0, medium: 0, low: 0 });
    updateInsights({
      total: 0,
      submittedThisWeek: 0,
      recentHigh: 0,
      highActive: 0,
      topRegion: "—",
      topRegionMeta: "Waiting for analytics",
    });
    return;
  }

  try {
    const response = await aiPredictionsBridge.invoke("fieldData:list", {
      limit: 50,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load field data");
    }

    const analysis = analysePredictions(response.data || []);
    renderPredictions(
      analysis.predictions,
      document.getElementById("prediction-list")
    );
    updateRiskTiles(analysis.counts);
    updateInsights(analysis.summary);
  } catch (error) {
    console.error("Failed to load AI predictions:", error);
    renderPredictions([], document.getElementById("prediction-list"));
    updateRiskTiles({ high: 0, medium: 0, low: 0 });
    updateInsights({
      total: 0,
      submittedThisWeek: 0,
      recentHigh: 0,
      highActive: 0,
      topRegion: "—",
      topRegionMeta: "Waiting for analytics",
    });
  }
}

async function loadUserProfile() {
  if (
    !aiPredictionsBridge ||
    typeof aiPredictionsBridge.invoke !== "function"
  ) {
    return;
  }

  try {
    const response = await aiPredictionsBridge.invoke("userProfile:get");
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load profile");
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
    console.error("Failed to load profile for AI predictions:", error);
  }
}

function initNavigation() {
  const navItems = document.querySelectorAll(".main-nav .nav-item");
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      navItems.forEach((link) => link.classList.remove("active"));
      item.classList.add("active");
    });
  });
}

function initTabs() {
  const tabButtons = document.querySelectorAll(".tab-button");
  const tabPanels = document.querySelectorAll(".tab-panel");

  const setActiveTab = (tabId) => {
    tabButtons.forEach((button) => {
      const isMatch = button.dataset.tab === tabId;
      button.classList.toggle("is-active", isMatch);
      button.setAttribute("aria-selected", String(isMatch));
    });

    tabPanels.forEach((panel) => {
      const isMatch = panel.dataset.tabPanel === tabId;
      panel.classList.toggle("is-active", isMatch);
      if (isMatch) {
        panel.removeAttribute("hidden");
      } else {
        panel.setAttribute("hidden", "hidden");
      }
    });
  };

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tabId = button.dataset.tab;
      if (!tabId) {
        return;
      }
      setActiveTab(tabId);
    });
  });

  const initial = document.querySelector(".tab-button.is-active");
  if (initial && initial.dataset.tab) {
    setActiveTab(initial.dataset.tab);
  }
}

function initExportButton() {
  const exportButton = document.querySelector(".hero-export");
  if (!exportButton) {
    return;
  }
  exportButton.addEventListener("click", () => {
    window.alert(
      "Exporting AI predictions will be available in a future update."
    );
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initTabs();
  initExportButton();
  loadUserProfile();
  loadPredictions();
});
