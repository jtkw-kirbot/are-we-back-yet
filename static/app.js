(async function () {
  const labels = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google_gemini: "Gemini",
    microsoft_copilot: "Copilot",
  };
  const providerColorVars = {
    openai: "--openai",
    anthropic: "--anthropic",
    google_gemini: "--google_gemini",
    microsoft_copilot: "--microsoft_copilot",
  };
  const providerOrder = Object.keys(labels);
  const fallbackTrackerStartDate = "2026-01-01";

  const grid = document.getElementById("grid");
  const popover = document.getElementById("popover");
  const rangeLabel = document.getElementById("range-label");
  let activeAnchor = null;
  let activeDate = null;
  let openedFromGridRoute = false;
  let calendar = null;
  let weeks = [];
  const squareByDate = new Map();
  const routeDatePattern = /^\d{4}-\d{2}-\d{2}$/;

  function useCompactModal() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function useFittedCalendar() {
    return window.matchMedia("(min-width: 721px)").matches;
  }

  function readPixelVariable(element, name, fallback) {
    const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function fitCalendarToGrid() {
    if (!calendar || !useFittedCalendar() || weeks.length === 0) {
      calendar?.style.removeProperty("--day-size");
      return;
    }

    const weekCount = weeks.length;
    const dayGap = readPixelVariable(calendar, "--day-gap", 4);
    const weekdayWidth = readPixelVariable(calendar, "--weekday-width", 14);
    const bodyGap = readPixelVariable(calendar, "--grid-body-gap", 8);
    const availableWidth = grid.clientWidth - weekdayWidth - bodyGap - ((weekCount - 1) * dayGap);
    const fittedSize = availableWidth / weekCount;
    const boundedSize = Math.max(8, Math.min(40, fittedSize));
    calendar.style.setProperty("--day-size", `${boundedSize.toFixed(2)}px`);
  }

  function scrollGridToEnd() {
    grid.scrollLeft = Math.max(0, grid.scrollWidth - grid.clientWidth);
  }

  function laDateParts(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  }

  function laDateString(date) {
    const parts = laDateParts(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function dateRange(startDate) {
    const today = laDateString(new Date());
    const dates = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${today}T00:00:00Z`);
    while (cursor <= end) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }

  function monthName(date) {
    return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
  }

  function displayDate(date) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
  }

  function trackerStartDate(days) {
    const dates = days
      .map((day) => day.date)
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort();
    return dates[0] ?? fallbackTrackerStartDate;
  }

  function buildWeeks(dates) {
    if (dates.length === 0) return [];
    const out = [];
    let week = new Array(7).fill(null);

    for (const date of dates) {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (day === 0 && week.some(Boolean)) {
        out.push(week);
        week = new Array(7).fill(null);
      }
      week[day] = date;
    }
    if (week.some(Boolean)) out.push(week);
    return out;
  }

  function bucketLabel(value) {
    return {
      strongly_negative: "strongly negative",
      negative: "negative",
      mixed_neutral: "mixed or neutral",
      positive: "positive",
      strongly_positive: "strongly positive",
    }[value] ?? value;
  }

  function sentimentLabel(row) {
    const adjustedMean = Number(row.adjustedMean ?? 0);
    if (row.bucket === "mixed_neutral") {
      if (adjustedMean > 0.05) return "slightly positive";
      if (adjustedMean < -0.05) return "slightly negative";
    }
    return bucketLabel(row.bucket);
  }

  function evidenceStrengthLabel(value) {
    return {
      low: "limited evidence",
      medium: "some evidence",
      high: "broad evidence",
    }[value] ?? value;
  }

  function certaintyLabel(value, support) {
    if (support === "low") return "";
    return {
      low: "low certainty",
      medium: "moderate certainty",
      high: "high certainty",
    }[value] ?? value;
  }

  function rankNoteLabel(value) {
    return {
      low_support: "",
      close_tie: "close tie",
      mixed_high_volume: "mixed reactions",
    }[value] ?? value;
  }

  function annotationTone(annotation) {
    if (annotation.stance > 0) return "positive";
    if (annotation.stance < 0) return "negative";
    return "neutral";
  }

  function evidenceTypeLabel(item) {
    return item.sourceType === "title" ? "title" : "comment";
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function displayCopy(value) {
    return String(value)
      .replace(/\bthe signal is low-support\b/gi, "the signal has limited evidence")
      .replace(/\bthis is low-support\b/gi, "evidence is limited")
      .replace(/\bsupport is low\b/gi, "evidence is limited")
      .replace(/\bsupport was low\b/gi, "evidence was limited")
      .replace(/\bis low-support\b/gi, "has limited evidence")
      .replace(/\blow-support\b/gi, "limited evidence")
      .replace(/\blow support\b/gi, "limited evidence")
      .replace(/\bweak support\b/gi, "limited evidence");
  }

  function withEvidenceLinks(text, evidenceById) {
    return escapeHtml(displayCopy(text)).replace(/\[(E\d+)]/g, (token, id) => {
      const evidence = evidenceById.get(id);
      if (!evidence) return token;
      return `<a href="${escapeHtml(evidence.hnUrl)}" target="_blank" rel="noreferrer">[${id}]</a>`;
    });
  }

  function dayMostPositiveRows(day) {
    if (!day) return [];
    const rows = day.ranking ?? [];
    if (rows.length === 0) return [];
    const topRow = rows.reduce((best, row) => (
      Number(row.adjustedMean) > Number(best.adjustedMean) ? row : best
    ));
    const tiedTargets = new Set([topRow.target, ...(topRow.tiedWith ?? [])]);
    return rows
      .filter((row) => tiedTargets.has(row.target))
      .sort((a, b) => providerOrder.indexOf(a.target) - providerOrder.indexOf(b.target));
  }

  function daySignalTargets(day) {
    return dayMostPositiveRows(day).map((row) => row.target);
  }

  function routeDateFromLocation() {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    return lastSegment && routeDatePattern.test(lastSegment) ? lastSegment : null;
  }

  function routeBasePath() {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && routeDatePattern.test(lastSegment)) segments.pop();
    return `/${segments.join("/")}${segments.length > 0 ? "/" : ""}`;
  }

  function routePathForDate(date) {
    return `${routeBasePath()}${date}`;
  }

  function displayRankingRows(day) {
    return [...(day.ranking ?? [])].sort((a, b) => (
      Number(b.adjustedMean ?? 0) - Number(a.adjustedMean ?? 0)
      || String(a.target).localeCompare(String(b.target))
    ));
  }

  function evidenceBalanceItems(row) {
    return [
      ["positive", row.evidenceBalance.positive],
      ["neutral", row.evidenceBalance.neutral],
      ["negative", row.evidenceBalance.negative],
    ].filter(([, count]) => Number(count) > 0);
  }

  function mentionLabel(tone, count) {
    return `${count} ${tone} mention${Number(count) === 1 ? "" : "s"}`;
  }

  function applyDayBackground(square, day) {
    const targets = daySignalTargets(day);
    if (targets.length <= 1) return;
    const stop = 100 / targets.length;
    const bands = targets.map((target, index) => {
      const start = (index * stop).toFixed(2);
      const end = ((index + 1) * stop).toFixed(2);
      return `var(${providerColorVars[target]}) ${start}% ${end}%`;
    });
    if (targets.length === 2) {
      square.style.background = `linear-gradient(135deg, ${bands.join(", ")})`;
      return;
    }
    square.style.background = `conic-gradient(${bands.join(", ")})`;
  }

  function renderRankingChart(day, evidenceById) {
    const rows = displayRankingRows(day);
    if (rows.length === 0) {
      return `
        <section class="detail-section" aria-label="Provider ranking">
          <div class="section-heading">
            <span>ranking</span>
            <span>most positive first</span>
          </div>
          <p class="judgement secondary">No tracked provider had relevant HN story/comment signal.</p>
        </section>
      `;
    }
    return `
      <section class="detail-section provider-section" aria-label="Provider ranking">
        <div class="section-heading">
          <span>ranking</span>
          <span>most positive first</span>
        </div>
        <div class="provider-list">
          ${rows.map((row, index) => {
            const notes = [...new Set([
              sentimentLabel(row),
              evidenceStrengthLabel(row.support),
              certaintyLabel(row.confidence, row.support),
              row.rankNote ? rankNoteLabel(row.rankNote) : "",
            ].filter(Boolean))];
            const balanceItems = evidenceBalanceItems(row);
            return `
              <article class="provider-row ${escapeHtml(row.direction)}" style="--provider-color: var(${providerColorVars[row.target]});">
                <div class="provider-rank">${index + 1}</div>
                <div class="provider-body">
                  <div class="provider-topline">
                    <strong>${escapeHtml(labels[row.target] ?? row.target)}</strong>
                    <span>${escapeHtml(notes.join(" · "))}</span>
                  </div>
                  <p>${withEvidenceLinks(row.summary || "", evidenceById)}</p>
                </div>
                <div class="balance" aria-label="Evidence balance">
                  ${balanceItems.map(([tone, count]) => `<span>${escapeHtml(mentionLabel(tone, count))}</span>`).join("")}
                </div>
              </article>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderEvidence(day) {
    if (!day.evidence?.length) return "";
    return `
      <details class="detail-section source-section evidence-section" aria-label="Evidence">
        <summary class="section-heading evidence-summary">
          <span>evidence</span>
          <span>${day.evidence.length} excerpt${day.evidence.length === 1 ? "" : "s"}</span>
        </summary>
        <div class="source-list">
          ${day.evidence.map((item) => `
            <article class="source-row">
              <div class="source-head">
                <a href="${escapeHtml(item.hnUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.id)}</a>
                <span>${escapeHtml(evidenceTypeLabel(item))} · story ${escapeHtml(item.storyId)}</span>
              </div>
              <p class="source-excerpt">&quot;${escapeHtml(item.excerpt)}&quot;</p>
              <div class="source-targets">
                ${item.annotations.map((annotation) => `
                  <span class="source-chip ${annotationTone(annotation)}">${escapeHtml(labels[annotation.target] ?? annotation.target)} · ${escapeHtml(annotation.stanceLabel.replaceAll("_", " "))}</span>
                `).join("")}
              </div>
              <details class="annotation-details">
                <summary>annotation${item.annotations.length === 1 ? "" : "s"}</summary>
                <div class="annotation-list">
                  ${item.annotations.map((annotation) => `
                    <div class="annotation">
                      <strong>${escapeHtml(labels[annotation.target] ?? annotation.target)}</strong>
                      <span>${escapeHtml(annotation.relevance)}</span>
                      <span>${escapeHtml(annotation.referenceBasis.replaceAll("_", " "))}</span>
                      <p>${escapeHtml(annotation.rationale)}</p>
                    </div>
                  `).join("")}
                </div>
              </details>
            </article>
          `).join("")}
        </div>
      </details>
    `;
  }

  function renderUnmentioned(day) {
    if (!day.unmentioned?.length) return "";
    return `
      <section class="unmentioned" aria-label="Unmentioned providers">
        <span>unmentioned</span>
        <span>${day.unmentioned.map((target) => escapeHtml(labels[target] ?? target)).join(", ")}</span>
      </section>
    `;
  }

  function renderDetail(anchor, date, day) {
    activeAnchor?.classList.remove("selected");
    activeAnchor = anchor;
    activeAnchor.classList.add("selected");
    popover.className = useCompactModal() ? "popover modal" : "popover sheet";
    if (!day) {
      popover.innerHTML = `
        ${detailCloseButton()}
        <div class="detail-scroll">
          <h2>${escapeHtml(date)}</h2>
          <div class="meta"><span class="pill">No completed data</span></div>
          <p class="judgement">This day has not been processed yet.</p>
        </div>
      `;
      showDetail();
      return;
    }

    const evidenceById = new Map(day.evidence.map((item) => [item.id, item]));
    const signalTargets = daySignalTargets(day).map((target) => labels[target] ?? target);
    const flags = [
      "HN story/comment snapshot",
      signalTargets.length > 0 ? `Most positive: ${signalTargets.join(", ")}` : "No ranked signal",
    ].filter(Boolean);

    popover.innerHTML = `
      ${detailCloseButton()}
      <div class="detail-scroll">
        <header class="detail-header">
          <h2>${escapeHtml(displayDate(day.date))}</h2>
          <div class="meta">${flags.map((flag) => `<span class="pill">${escapeHtml(flag)}</span>`).join("")}</div>
        </header>
        <section class="summary-block" aria-label="Daily summary">
          <div class="section-heading">
            <span>summary</span>
          </div>
          <p class="judgement">${withEvidenceLinks(day.headlineSummary || "No tracked provider had relevant HN signal.", evidenceById)}</p>
        </section>
        ${renderRankingChart(day, evidenceById)}
        ${renderEvidence(day)}
        ${renderUnmentioned(day)}
      </div>
    `;
    showDetail();
  }

  function detailCloseButton() {
    return `<button type="button" class="close-detail" aria-label="Close detail"><span aria-hidden="true">X</span></button>`;
  }

  function showDetail() {
    popover.hidden = false;
    popover.style.left = "";
    popover.style.top = "";
    if (useCompactModal()) {
      document.body.classList.remove("detail-open");
      document.body.classList.add("modal-open");
      return;
    }
    document.body.classList.remove("modal-open");
    document.body.classList.add("detail-open");
  }

  function closeDetail() {
    activeAnchor?.classList.remove("selected");
    activeAnchor = null;
    activeDate = null;
    popover.hidden = true;
    popover.className = "popover";
    document.body.classList.remove("modal-open");
    document.body.classList.remove("detail-open");
  }

  function openDetailForDate(date, options = {}) {
    const anchor = squareByDate.get(date);
    if (!anchor) return false;
    renderDetail(anchor, date, byDate.get(date));
    activeDate = date;
    anchor.scrollIntoView({ block: "nearest", inline: "center" });
    if (options.pushRoute) {
      window.history.pushState({ date }, "", routePathForDate(date));
      openedFromGridRoute = true;
    }
    return true;
  }

  function dismissDetail() {
    const routeDate = routeDateFromLocation();
    if (routeDate && openedFromGridRoute) {
      window.history.back();
      return;
    }
    closeDetail();
    openedFromGridRoute = false;
    if (routeDate) window.history.replaceState(null, "", routeBasePath());
  }

  const response = await fetch("data/index.json");
  const data = response.ok ? await response.json() : { days: [] };
  const byDate = new Map(data.days.map((day) => [day.date, day]));
  const startDate = trackerStartDate(data.days);
  const dates = dateRange(startDate);
  rangeLabel.textContent = `since ${displayDate(startDate)}`;

  weeks = buildWeeks(dates);
  calendar = document.createElement("div");
  calendar.className = "calendar";

  const monthLabels = document.createElement("div");
  monthLabels.className = "month-labels";
  weeks.forEach((week, index) => {
    const label = document.createElement("span");
    label.className = "month-label";
    const monthStart = week.find((date) => date && date.endsWith("-01"));
    const firstRangeDate = index === 0 ? week.find(Boolean) : undefined;
    const labelDate = monthStart ?? firstRangeDate;
    if (labelDate) label.textContent = monthName(new Date(`${labelDate}T00:00:00Z`));
    monthLabels.appendChild(label);
  });

  const body = document.createElement("div");
  body.className = "grid-body";
  const weekdayLabels = document.createElement("div");
  weekdayLabels.className = "weekday-labels";
  ["", "M", "", "W", "", "F", ""].forEach((label) => {
    const node = document.createElement("span");
    node.textContent = label;
    weekdayLabels.appendChild(node);
  });

  const heatmap = document.createElement("div");
  heatmap.className = "heatmap";

  for (const week of weeks) {
    for (const date of week) {
      const day = date ? byDate.get(date) : undefined;
      const targets = daySignalTargets(day);
      const primary = targets.length === 1 ? targets[0] : null;
      const signalClass = primary ?? (targets.length > 1 ? "tied_signal" : "no_signal");
      const square = document.createElement("button");
      square.type = "button";
      square.className = date ? `day ${signalClass}` : "day empty";
      if (!date) {
        square.tabIndex = -1;
        heatmap.appendChild(square);
        continue;
      }
      square.dataset.date = date;
      square.dataset.state = day ? "complete" : "missing";
      squareByDate.set(date, square);
      applyDayBackground(square, day);
      const label = targets.length > 0
        ? `${targets.map((target) => labels[target] ?? target).join(", ")} most positive signal`
        : "no ranked signal";
      square.setAttribute("aria-label", day ? `${date}: ${label}` : `${date}: no data`);
      square.addEventListener("click", (event) => {
        event.stopPropagation();
        if (activeDate === date && !popover.hidden) return;
        openDetailForDate(date, { pushRoute: true });
      });
      heatmap.appendChild(square);
    }
  }

  body.appendChild(weekdayLabels);
  body.appendChild(heatmap);
  calendar.appendChild(monthLabels);
  calendar.appendChild(body);
  grid.appendChild(calendar);
  fitCalendarToGrid();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const routeDate = routeDateFromLocation();
      if (routeDate && openDetailForDate(routeDate)) return;
      scrollGridToEnd();
    });
  });

  popover.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest(".close-detail")) dismissDetail();
  });

  document.addEventListener("click", (event) => {
    if (popover.hidden) return;
    if (activeAnchor && event.target === activeAnchor) return;
    dismissDetail();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || popover.hidden) return;
    dismissDetail();
  });
  window.addEventListener("popstate", () => {
    openedFromGridRoute = false;
    const routeDate = routeDateFromLocation();
    if (routeDate) {
      openDetailForDate(routeDate);
      return;
    }
    closeDetail();
  });
  window.addEventListener("resize", () => {
    fitCalendarToGrid();
    requestAnimationFrame(scrollGridToEnd);
    if (!popover.hidden && activeAnchor) {
      popover.className = useCompactModal() ? "popover modal" : "popover sheet";
      document.body.classList.toggle("modal-open", useCompactModal());
      document.body.classList.toggle("detail-open", !useCompactModal());
      popover.style.left = "";
      popover.style.top = "";
      requestAnimationFrame(fitCalendarToGrid);
      return;
    }
    closeDetail();
  });
})();
