(async function () {
  const labels = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google_gemini: "Gemini",
    microsoft_copilot: "Copilot",
  };

  const grid = document.getElementById("grid");
  const popover = document.getElementById("popover");
  const rangeLabel = document.getElementById("range-label");
  let activeAnchor = null;

  function useCompactModal() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function useFittedCalendar() {
    return window.matchMedia("(min-width: 901px)").matches
      && !window.matchMedia("(pointer: coarse)").matches;
  }

  function readPixelVariable(element, name, fallback) {
    const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function fitCalendarToGrid() {
    if (!useFittedCalendar() || weeks.length === 0) {
      calendar.style.removeProperty("--day-size");
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

  function dateRangeYtd() {
    const today = laDateString(new Date());
    const year = today.slice(0, 4);
    const dates = [];
    const cursor = new Date(`${year}-01-01T00:00:00Z`);
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

  function buildWeeks(dates) {
    if (dates.length === 0) return [];
    const weeks = [];
    let week = new Array(7).fill(null);
    const firstDate = new Date(`${dates[0]}T00:00:00Z`);
    const firstDay = firstDate.getUTCDay();
    for (let day = 0; day < firstDay; day += 1) {
      const leadingDate = new Date(firstDate);
      leadingDate.setUTCDate(firstDate.getUTCDate() - (firstDay - day));
      week[day] = leadingDate.toISOString().slice(0, 10);
    }

    for (const date of dates) {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (day === 0 && week.some(Boolean)) {
        weeks.push(week);
        week = new Array(7).fill(null);
      }
      week[day] = date;
    }
    if (week.some(Boolean)) weeks.push(week);
    return weeks;
  }

  function formatScore(value) {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}`;
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
      return `<a href="${escapeHtml(evidence.url)}" target="_blank" rel="noreferrer">[${id}]</a>`;
    });
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
      showDetail(anchor);
      return;
    }

    const evidenceById = new Map(day.evidence.map((item) => [item.id, item]));
    const entityRows = Object.entries(labels).map(([target, label]) => {
      const entity = day.entities[target];
      return `
        <div class="entity-row">
          <div class="entity-main">
            <span class="entity-name">${label}</span>
            <span class="entity-score">${formatScore(entity.score)} · ${entity.mentionCount} mentions</span>
          </div>
          <div class="entity-detail">${withEvidenceLinks(entity.judgementSnippet || "No relevant signal.", evidenceById)}</div>
        </div>
      `;
    }).join("");

    const flags = [
      day.samplingMethod === "algolia_date_search" ? "Backfill sample" : "9pm snapshot",
      day.lowConfidence ? "Low confidence" : "",
      day.closeCall ? "Close call" : "",
    ].filter(Boolean);

    popover.innerHTML = `
      ${detailCloseButton()}
      <div class="detail-scroll">
        <h2>${escapeHtml(day.date)} · ${escapeHtml(labels[day.winner])}</h2>
        <div class="meta">${flags.map((flag) => `<span class="pill">${escapeHtml(flag)}</span>`).join("")}</div>
        <details class="judgement-block" open>
          <summary>Daily judgement</summary>
          <p class="judgement">${withEvidenceLinks(day.dailyJudgementSnippet, evidenceById)}</p>
          <p class="judgement secondary">${withEvidenceLinks(day.winnerExplanation || "", evidenceById)}</p>
        </details>
        <div class="scores">${entityRows}</div>
      </div>
    `;
    showDetail(anchor);
  }

  function detailCloseButton() {
    return `<button type="button" class="close-detail" aria-label="Close detail"><span aria-hidden="true">X</span></button>`;
  }

  function showDetail(anchor) {
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
  const dates = dateRangeYtd();
  const currentYear = dates[0]?.slice(0, 4) ?? new Date().getFullYear();
  rangeLabel.textContent = `${currentYear} year to date`;

  const weeks = buildWeeks(dates);
  const calendar = document.createElement("div");
  calendar.className = "calendar";

  const monthLabels = document.createElement("div");
  monthLabels.className = "month-labels";
  weeks.forEach((week) => {
    const label = document.createElement("span");
    label.className = "month-label";
    const firstOfMonth = week.find((date) => date && date.endsWith("-01"));
    if (firstOfMonth) label.textContent = monthName(new Date(`${firstOfMonth}T00:00:00Z`));
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
      const square = document.createElement("button");
      square.type = "button";
      square.className = date ? `day ${day?.winner ?? ""}` : "day empty";
      if (!date) {
        square.tabIndex = -1;
        heatmap.appendChild(square);
        continue;
      }
      square.dataset.date = date;
      square.dataset.state = day ? "complete" : "missing";
      square.setAttribute("aria-label", day ? `${date}: ${labels[day.winner]} won` : `${date}: no data`);
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
