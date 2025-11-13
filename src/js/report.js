let reportsBridge = null;

if (typeof require === "function") {
  try {
    const { ipcRenderer } = require("electron");
    reportsBridge = ipcRenderer ?? null;
  } catch (error) {
    console.warn("IPC renderer unavailable for reports:", error);
  }
}

const PRIORITY_LABELS = {
  routine: "Routine",
  important: "Important",
  urgent: "Urgent",
  draft: "Draft",
};

const PRIORITY_CLASSES = {
  routine: "status-pill--routine",
  important: "status-pill--important",
  urgent: "status-pill--urgent",
  draft: "status-pill--draft",
};

const CATEGORY_CHIP_CLASSES = {
  wildlife: "chip--success",
  flora: "chip--success",
  species: "chip--success",
  "disaster alert": "chip--danger",
  incident: "chip--danger",
  patrol: "",
  community: "",
};

function sanitiseText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toPriorityKey(priority) {
  return sanitiseText(priority).toLowerCase();
}

function toPriorityLabel(priority) {
  const key = toPriorityKey(priority);
  return PRIORITY_LABELS[key] || PRIORITY_LABELS.important;
}

function toPriorityClass(priority) {
  const key = toPriorityKey(priority);
  return PRIORITY_CLASSES[key] || PRIORITY_CLASSES.important;
}

function toCategoryClass(category) {
  const key = sanitiseText(category).toLowerCase();
  return CATEGORY_CHIP_CLASSES[key] || "";
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch (error) {
    console.warn("Date formatting failed:", error);
    return date.toLocaleString();
  }
}

function formatReportId(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return "FD-0000";
  }
  return `FD-${numericId.toString().padStart(4, "0")}`;
}

function formatRegion(entry) {
  const tags = sanitiseText(entry?.tags);
  if (tags) {
    return tags;
  }

  const latitude = sanitiseText(entry?.latitude);
  const longitude = sanitiseText(entry?.longitude);

  if (latitude && longitude) {
    return `${latitude}, ${longitude}`;
  }

  if (latitude) {
    return latitude;
  }

  if (longitude) {
    return longitude;
  }

  return "—";
}

function estimateReportSize(entry) {
  const count = Number(entry?.individualCount) || 0;
  const baseSize = 1.1;
  const countContribution = Math.min(count * 0.08, 3);
  const tagContribution =
    (sanitiseText(entry?.tags).split(",").filter(Boolean).length || 0) * 0.15;
  const estimated = Math.min(8, baseSize + countContribution + tagContribution);
  return `${estimated.toFixed(1)} MB`;
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

function differenceInDays(fromDate, toDate = new Date()) {
  const from = new Date(fromDate);
  if (Number.isNaN(from.getTime())) {
    return Infinity;
  }
  const diffMs = toDate.getTime() - from.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

function notifyComingSoon(featureLabel) {
  const label = sanitiseText(featureLabel) || "This";
  const message = `${label} feature will be available in a future update.`;
  window.alert(message);
}

document.addEventListener("DOMContentLoaded", () => {
  const userNameNode = document.getElementById("user-name");
  const userRoleNode = document.getElementById("user-role");
  const userAvatarNode = document.getElementById("user-avatar");

  const tableBody = document.getElementById("reports-table-body");
  const reportsCountNode = document.getElementById("reports-count");
  const reportsUpdatedNode = document.getElementById("reports-updated");

  const totalNode = document.getElementById("reports-total");
  const totalMetaNode = document.getElementById("reports-total-meta");
  const topCategoryNode = document.getElementById("reports-top-category");
  const topCategoryMetaNode = document.getElementById(
    "reports-top-category-meta"
  );
  const recentNode = document.getElementById("reports-recent");
  const recentMetaNode = document.getElementById("reports-recent-meta");
  const draftsNode = document.getElementById("reports-drafts");
  const draftsMetaNode = document.getElementById("reports-drafts-meta");

  function setText(node, value) {
    if (!node) {
      return;
    }
    node.textContent = value;
  }

  function renderEmptyState(message) {
    if (!tableBody) {
      return;
    }
    tableBody.innerHTML = "";
    const row = document.createElement("tr");
    row.className = "reports-table__empty";
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = message;
    row.appendChild(cell);
    tableBody.appendChild(row);
  }

  function renderReports(entries = []) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    const total = safeEntries.length;

    setText(reportsCountNode, total.toString());
    setText(totalNode, total.toString());
    setText(
      totalMetaNode,
      total ? "Synced from field submissions" : "Awaiting first submission"
    );

    if (!tableBody) {
      return;
    }

    if (!total) {
      const emptyMessage =
        tableBody.dataset.emptyMessage ||
        "No reports available yet. Submit field data to generate reports.";
      renderEmptyState(emptyMessage);
      setText(reportsUpdatedNode, "—");
      setText(topCategoryNode, "—");
      setText(topCategoryMetaNode, "Awaiting data");
      setText(recentNode, "0");
      setText(recentMetaNode, "New reports in last 7 days");
      setText(draftsNode, "0");
      setText(draftsMetaNode, "Drafts awaiting final review");
      return;
    }

    tableBody.innerHTML = "";

    const categoryCount = new Map();
    let mostRecentDate = null;
    let drafts = 0;
    let recent = 0;

    safeEntries.forEach((entry) => {
      const priority = toPriorityKey(entry?.priority);
      const recordedAt = entry?.recordedAt;

      if (!mostRecentDate || new Date(recordedAt) > new Date(mostRecentDate)) {
        mostRecentDate = recordedAt;
      }

      if (priority === "draft") {
        drafts += 1;
      }

      if (differenceInDays(recordedAt) <= 7) {
        recent += 1;
      }

      const category = sanitiseText(entry?.category) || "General";
      const currentCount = categoryCount.get(category) || 0;
      categoryCount.set(category, currentCount + 1);

      const row = document.createElement("tr");

      const idCell = document.createElement("td");
      idCell.textContent = formatReportId(entry?.id);
      row.appendChild(idCell);

      const titleCell = document.createElement("td");
      titleCell.textContent =
        sanitiseText(entry?.species) || "Untitled Field Observation";
      row.appendChild(titleCell);

      const typeCell = document.createElement("td");
      const chip = document.createElement("span");
      const chipClass = toCategoryClass(entry?.category);
      chip.className = ["chip", chipClass].filter(Boolean).join(" ");
      chip.textContent = category;
      typeCell.appendChild(chip);
      row.appendChild(typeCell);

      const regionCell = document.createElement("td");
      regionCell.textContent = formatRegion(entry);
      row.appendChild(regionCell);

      const dateCell = document.createElement("td");
      dateCell.textContent = formatDateTime(entry?.recordedAt) || "—";
      row.appendChild(dateCell);

      const statusCell = document.createElement("td");
      const statusPill = document.createElement("span");
      statusPill.className = `status-pill ${toPriorityClass(entry?.priority)}`;
      statusPill.textContent = toPriorityLabel(entry?.priority);
      statusCell.appendChild(statusPill);
      row.appendChild(statusCell);

      const sizeCell = document.createElement("td");
      sizeCell.textContent = estimateReportSize(entry);
      row.appendChild(sizeCell);

      const actionsCell = document.createElement("td");
      actionsCell.className = "table-actions";

      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.className = "ghost ghost--compact";
      viewButton.textContent = "View";
      viewButton.addEventListener("click", () => {
        notifyComingSoon("Viewing reports");
      });

      const exportButton = document.createElement("button");
      exportButton.type = "button";
      exportButton.className = "primary primary--compact";
      exportButton.textContent = "PDF";
      exportButton.addEventListener("click", () => {
        notifyComingSoon("PDF export");
      });

      actionsCell.appendChild(viewButton);
      actionsCell.appendChild(exportButton);
      row.appendChild(actionsCell);

      tableBody.appendChild(row);
    });

    if (mostRecentDate) {
      setText(reportsUpdatedNode, formatDateTime(mostRecentDate) || "—");
    } else {
      setText(reportsUpdatedNode, "—");
    }

    setText(draftsNode, drafts.toString());
    setText(
      draftsMetaNode,
      drafts ? "Draft reports awaiting final review" : "All reports published"
    );

    setText(recentNode, recent.toString());
    setText(
      recentMetaNode,
      recent
        ? "Filed within the last 7 days"
        : "No new reports in the last week"
    );

    const [topCategory] = Array.from(categoryCount.entries()).sort(
      (a, b) => b[1] - a[1]
    );

    if (topCategory) {
      const [category, categoryTotal] = topCategory;
      setText(topCategoryNode, category);
      setText(
        topCategoryMetaNode,
        `${categoryTotal} ${categoryTotal === 1 ? "report" : "reports"}`
      );
    } else {
      setText(topCategoryNode, "—");
      setText(topCategoryMetaNode, "Awaiting data");
    }
  }

  async function loadReports() {
    if (!reportsBridge || typeof reportsBridge.invoke !== "function") {
      renderReports([]);
      return;
    }

    try {
      const response = await reportsBridge.invoke("fieldData:list", {
        limit: 25,
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Failed to fetch reports");
      }
      renderReports(response.data || []);
    } catch (error) {
      console.error("Failed to load reports:", error);
      renderReports([]);
    }
  }

  async function loadUserProfile() {
    if (!reportsBridge || typeof reportsBridge.invoke !== "function") {
      return;
    }

    try {
      const response = await reportsBridge.invoke("userProfile:get");
      if (!response?.ok) {
        throw new Error(response?.error || "Failed to fetch profile");
      }

      const profile = response.data;
      if (!profile) {
        return;
      }

      if (userNameNode && profile.name) {
        userNameNode.textContent = profile.name;
      }

      if (userRoleNode && profile.city) {
        userRoleNode.textContent = profile.city;
      }

      if (userAvatarNode && profile.name) {
        userAvatarNode.textContent = getInitials(profile.name);
      }
    } catch (error) {
      console.error("Failed to load user profile:", error);
    }
  }

  loadUserProfile();
  loadReports();
});
