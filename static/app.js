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
  let pinned = false;
  let activeAnchor = null;
  let hideTimer = 0;
  let hoveringPopover = false;

  function useMobileModal() {
    return window.matchMedia("(max-width: 720px), (pointer: coarse)").matches;
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

  function positionPopover(anchor) {
    const rect = anchor.getBoundingClientRect();
    const margin = 12;
    popover.hidden = false;
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    let left = rect.left + rect.width / 2 - width / 2;
    let top = rect.bottom + 8;
    left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - height - 8);
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function renderDetail(anchor, date, day) {
    clearHideTimer();
    activeAnchor = anchor;
    popover.className = useMobileModal() ? "popover modal" : "popover";
    if (!day) {
      popover.innerHTML = `
        ${modalCloseButton()}
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

    const links = day.evidence.slice(0, 8).map((item) => {
      return `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.id)}</a>`;
    }).join("");

    const flags = [
      day.samplingMethod === "algolia_date_search" ? "Backfill sample" : "9pm snapshot",
      day.lowConfidence ? "Low confidence" : "",
      day.closeCall ? "Close call" : "",
    ].filter(Boolean);

    popover.innerHTML = `
      ${modalCloseButton()}
      <div class="detail-scroll">
        <h2>${escapeHtml(day.date)} · ${escapeHtml(labels[day.winner])}</h2>
        <div class="meta">${flags.map((flag) => `<span class="pill">${escapeHtml(flag)}</span>`).join("")}</div>
        <details class="judgement-block" open>
          <summary>Daily judgement</summary>
          <p class="judgement">${withEvidenceLinks(day.dailyJudgementSnippet, evidenceById)}</p>
          <p class="judgement secondary">${withEvidenceLinks(day.winnerExplanation || "", evidenceById)}</p>
        </details>
        <div class="scores">${entityRows}</div>
        <div class="links">${links}</div>
      </div>
    `;
    showDetail(anchor);
  }

  function modalCloseButton() {
    return `<button type="button" class="close-detail" aria-label="Close detail">Close</button>`;
  }

  function showDetail(anchor) {
    popover.hidden = false;
    if (useMobileModal()) {
      document.body.classList.add("modal-open");
      return;
    }
    document.body.classList.remove("modal-open");
    positionPopover(anchor);
  }

  function hidePopover() {
    if (useMobileModal()) return;
    if (pinned) return;
    if (hoveringPopover) return;
    popover.hidden = true;
  }

  function clearHideTimer() {
    if (!hideTimer) return;
    window.clearTimeout(hideTimer);
    hideTimer = 0;
  }

  function scheduleHidePopover() {
    if (useMobileModal()) return;
    if (pinned) return;
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      hidePopover();
    }, 90);
  }

  function closeDetail() {
    clearHideTimer();
    pinned = false;
    activeAnchor = null;
    hoveringPopover = false;
    popover.hidden = true;
    popover.className = "popover";
    document.body.classList.remove("modal-open");
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
      square.addEventListener("mouseenter", () => {
        clearHideTimer();
        if (!useMobileModal() && !pinned) renderDetail(square, date, day);
      });
      square.addEventListener("mouseleave", scheduleHidePopover);
      square.addEventListener("focus", () => {
        clearHideTimer();
        if (!useMobileModal()) renderDetail(square, date, day);
      });
      square.addEventListener("blur", scheduleHidePopover);
      square.addEventListener("click", (event) => {
        event.stopPropagation();
        pinned = true;
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

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      grid.scrollLeft = grid.scrollWidth - grid.clientWidth;
    });
  });

  popover.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest(".close-detail")) closeDetail();
  });

  popover.addEventListener("mouseenter", () => {
    hoveringPopover = true;
    clearHideTimer();
  });

  popover.addEventListener("mouseleave", () => {
    hoveringPopover = false;
    scheduleHidePopover();
  });

  document.addEventListener("click", (event) => {
    if (useMobileModal()) return;
    if (activeAnchor && event.target === activeAnchor) return;
    closeDetail();
  });
  window.addEventListener("resize", () => {
    if (!popover.hidden && activeAnchor) {
      if (useMobileModal()) document.body.classList.add("modal-open");
      else {
        document.body.classList.remove("modal-open");
        positionPopover(activeAnchor);
      }
      return;
    }
    closeDetail();
  });
})();
