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
  const fallbackTrackerStartDate = "2026-01-01";
  const positiveSignalThreshold = 0.35;
  const tieThreshold = 0.2;

  const grid = document.getElementById("grid");
  const popover = document.getElementById("popover");
  const rangeLabel = document.getElementById("range-label");
  let activeAnchor = null;
  let calendar = null;
  let weeks = [];

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
      mixed_neutral: "mixed/neutral",
      positive: "positive",
      strongly_positive: "strongly positive",
    }[value] ?? value;
  }

  function rankNoteLabel(value) {
    return {
      low_support: "low support",
      close_tie: "close tie",
      mixed_high_volume: "mixed high volume",
    }[value] ?? value;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function withEvidenceLinks(text, evidenceById) {
    return escapeHtml(text).replace(/\[(E\d+)]/g, (token, id) => {
      const evidence = evidenceById.get(id);
      if (!evidence) return token;
      return `<a href="${escapeHtml(evidence.hnUrl)}" target="_blank" rel="noreferrer">[${id}]</a>`;
    });
  }

  function dayPositiveSignalRows(day) {
    if (!day) return [];
    const positiveRows = (day.ranking ?? []).filter((row) => Number(row.adjustedMean) >= positiveSignalThreshold);
    if (positiveRows.length === 0) return [];
    const maxPositive = Math.max(...positiveRows.map((row) => Number(row.adjustedMean)));
    return positiveRows
      .filter((row) => maxPositive - Number(row.adjustedMean) <= tieThreshold)
      .sort((a, b) => String(a.target).localeCompare(String(b.target)));
  }

  function daySignalTargets(day) {
    return dayPositiveSignalRows(day).map((row) => row.target);
  }

  function applyDayBackground(square, day) {
    const targets = daySignalTargets(day);
    if (targets.length <= 1) return;
    const stop = 100 / targets.length;
    const bands = targets.flatMap((target, index) => {
      const start = (index * stop).toFixed(2);
      const end = ((index + 1) * stop).toFixed(2);
      return [`var(${providerColorVars[target]}) ${start}%`, `var(${providerColorVars[target]}) ${end}%`];
    });
    square.style.background = `linear-gradient(to bottom, ${bands.join(", ")})`;
  }

  function renderRankingChart(day, evidenceById) {
    const rows = day.ranking ?? [];
    if (rows.length === 0) {
      return `
        <section class="ranking-block" aria-label="Provider ranking">
          <div class="section-title">ranking</div>
          <p class="judgement secondary">No tracked provider had relevant HN story/comment signal.</p>
        </section>
      `;
    }
    return `
      <section class="ranking-block" aria-label="Provider ranking">
        <div class="section-title">ranking</div>
        <div class="ranking-list">
          ${rows.map((row) => {
            const notes = [
              bucketLabel(row.bucket),
              `${row.support} support`,
              `${row.confidence} confidence`,
              row.rankNote ? rankNoteLabel(row.rankNote) : "",
            ].filter(Boolean);
            return `
              <div class="rank-row">
                <div class="rank-meta">
                  <span class="rank-label">
                    <span class="rank-position">${row.displayRank}</span>
                    <span>${escapeHtml(labels[row.target] ?? row.target)}</span>
                  </span>
                  <span class="rank-score">${escapeHtml(notes.join(" · "))}</span>
                </div>
                <div class="rank-counts">
                  <span>${row.evidenceBalance.positive} positive</span>
                  <span>${row.evidenceBalance.neutral} neutral</span>
                  <span>${row.evidenceBalance.negative} negative</span>
                </div>
                <p class="rank-summary">${withEvidenceLinks(row.summary || "", evidenceById)}</p>
              </div>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderEvidence(day) {
    if (!day.evidence?.length) return "";
    return `
      <section class="detail-section" aria-label="Evidence">
        <div class="section-title">evidence</div>
        <div class="evidence-list">
          ${day.evidence.map((item) => `
            <article class="evidence-card">
              <div class="evidence-head">
                <a href="${escapeHtml(item.hnUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.id)}</a>
                <span>${escapeHtml(item.sourceType)} · story ${escapeHtml(item.storyId)}</span>
              </div>
              <blockquote>${escapeHtml(item.excerpt)}</blockquote>
              <div class="annotation-list">
                ${item.annotations.map((annotation) => `
                  <div class="annotation">
                    <strong>${escapeHtml(labels[annotation.target] ?? annotation.target)}</strong>
                    <span>${escapeHtml(annotation.stanceLabel.replaceAll("_", " "))}</span>
                    <span>${escapeHtml(annotation.relevance)}</span>
                    <span>${escapeHtml(annotation.referenceBasis.replaceAll("_", " "))}</span>
                    <p>${escapeHtml(annotation.rationale)}</p>
                  </div>
                `).join("")}
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderUnmentioned(day) {
    if (!day.unmentioned?.length) return "";
    return `
      <section class="detail-section" aria-label="Unmentioned providers">
        <div class="section-title">unmentioned</div>
        <p class="judgement secondary">${day.unmentioned.map((target) => escapeHtml(labels[target] ?? target)).join(", ")}</p>
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
    const signalRows = dayPositiveSignalRows(day);
    const signalTargets = daySignalTargets(day).map((target) => labels[target] ?? target);
    const flags = [
      "front?day story/comment snapshot",
      signalTargets.length > 1 ? `Tied positive signal: ${signalTargets.join(", ")}` : signalTargets.length === 1 ? `Primary positive: ${signalTargets[0]}` : "No positive signal",
      signalRows.some((row) => row.support === "low") ? "Low-support positive signal" : "",
    ].filter(Boolean);

    popover.innerHTML = `
      ${detailCloseButton()}
      <div class="detail-scroll">
        <h2>${escapeHtml(day.date)}</h2>
        <div class="meta">${flags.map((flag) => `<span class="pill">${escapeHtml(flag)}</span>`).join("")}</div>
        ${renderRankingChart(day, evidenceById)}
        <section class="detail-section judgement-block" aria-label="Overall judgement">
          <div class="section-title">daily summary</div>
          <p class="judgement">${withEvidenceLinks(day.headlineSummary || "No tracked provider had relevant HN signal.", evidenceById)}</p>
        </section>
        ${renderUnmentioned(day)}
        ${renderEvidence(day)}
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
    popover.hidden = true;
    popover.className = "popover";
    document.body.classList.remove("modal-open");
    document.body.classList.remove("detail-open");
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
      const square = document.createElement("button");
      square.type = "button";
      square.className = date ? `day ${primary ?? "no_signal"}` : "day empty";
      if (!date) {
        square.tabIndex = -1;
        heatmap.appendChild(square);
        continue;
      }
      square.dataset.date = date;
      square.dataset.state = day ? "complete" : "missing";
      applyDayBackground(square, day);
      const label = targets.length > 0
        ? `${targets.map((target) => labels[target] ?? target).join(", ")} strongest positive adjusted signal`
        : "no meaningful positive provider signal";
      square.setAttribute("aria-label", day ? `${date}: ${label}` : `${date}: no data`);
      square.addEventListener("click", (event) => {
        event.stopPropagation();
        renderDetail(square, date, day);
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
      scrollGridToEnd();
    });
  });

  popover.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest(".close-detail")) closeDetail();
  });

  document.addEventListener("click", (event) => {
    if (popover.hidden) return;
    if (activeAnchor && event.target === activeAnchor) return;
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
