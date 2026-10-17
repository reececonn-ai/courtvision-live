export const TEAMS = [
  {abbr:"ATL",name:"Atlanta Hawks",lastWins:46,line:43.5},
  {abbr:"BOS",name:"Boston Celtics",lastWins:56,line:51.5},
  {abbr:"BKN",name:"Brooklyn Nets",lastWins:20,line:24.5},
  {abbr:"CHA",name:"Charlotte Hornets",lastWins:44,line:37.5},
  {abbr:"CHI",name:"Chicago Bulls",lastWins:31,line:27.5},
  {abbr:"CLE",name:"Cleveland Cavaliers",lastWins:52,line:47.5},
  {abbr:"DAL",name:"Dallas Mavericks",lastWins:26,line:34.5},
  {abbr:"DEN",name:"Denver Nuggets",lastWins:54,line:49.5},
  {abbr:"DET",name:"Detroit Pistons",lastWins:60,line:49.5},
  {abbr:"GSW",name:"Golden State Warriors",lastWins:37,line:40.5},
  {abbr:"HOU",name:"Houston Rockets",lastWins:52,line:47.5},
  {abbr:"IND",name:"Indiana Pacers",lastWins:19,line:44.5},
  {abbr:"LAC",name:"LA Clippers",lastWins:42,line:30.5},
  {abbr:"LAL",name:"Los Angeles Lakers",lastWins:53,line:46.5},
  {abbr:"MEM",name:"Memphis Grizzlies",lastWins:25,line:28.5},
  {abbr:"MIA",name:"Miami Heat",lastWins:43,line:46.5},
  {abbr:"MIL",name:"Milwaukee Bucks",lastWins:32,line:25.5},
  {abbr:"MIN",name:"Minnesota Timberwolves",lastWins:49,line:48.5},
  {abbr:"NOP",name:"New Orleans Pelicans",lastWins:26,line:27.5},
  {abbr:"NYK",name:"New York Knicks",lastWins:53,line:52.5},
  {abbr:"OKC",name:"Oklahoma City Thunder",lastWins:64,line:62.5},
  {abbr:"ORL",name:"Orlando Magic",lastWins:45,line:43.5},
  {abbr:"PHI",name:"Philadelphia 76ers",lastWins:45,line:50.5},
  {abbr:"PHX",name:"Phoenix Suns",lastWins:45,line:38.5},
  {abbr:"POR",name:"Portland Trail Blazers",lastWins:42,line:42.5},
  {abbr:"SAC",name:"Sacramento Kings",lastWins:22,line:21.5},
  {abbr:"SAS",name:"San Antonio Spurs",lastWins:62,line:59.5},
  {abbr:"TOR",name:"Toronto Raptors",lastWins:46,line:45.5},
  {abbr:"UTA",name:"Utah Jazz",lastWins:22,line:35.5},
  {abbr:"WAS",name:"Washington Wizards",lastWins:17,line:34.5}
];

export function teamByName(name) {
  const key = String(name || "").toLowerCase();
  return TEAMS.find(t => t.name.toLowerCase() === key || t.abbr.toLowerCase() === key) || null;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}

function metric(value, label) {
  return `<div class="metric"><strong>${esc(value ?? "—")}</strong><span>${esc(label)}</span></div>`;
}

function budgets(players = []) {
  if (!players.length) return "";
  return `<div class="budget-strip">${players.map((p) => `
    <div class="budget">
      <b>${esc(p.name)}</b>
      <strong>$${Number(p.remaining || 0).toFixed(Number.isInteger(Number(p.remaining || 0)) ? 0 : 1)}</strong>
      <span class="preview-label">${Array.isArray(p.teams) ? p.teams.length : 0} teams</span>
    </div>`).join("")}</div>`;
}

function teamStatus(state, team) {
  if (state.currentTeam === team.name) return "live";
  if ((state.passed || []).includes(team.name)) return "passed";
  for (const [name, assignment] of Object.entries(state.assignments || {})) {
    if (name === team.name || assignment?.team === team.name) return "owned";
  }
  return "available";
}

function teamBoard(state) {
  return `<div class="team-board" aria-label="NBA teams">${TEAMS.map(team => {
    const status = teamStatus(state, team);
    return `<button class="team-tile team-${status}" type="button" data-team="${esc(team.name)}">
      <span class="team-abbr">${team.abbr}</span>
      <span class="team-tile-name">${esc(team.name)}</span>
      <span class="team-line">${team.lastWins} → ${team.line}</span>
    </button>`;
  }).join("")}</div>`;
}

export function renderBroadcastStage(stage, state, options = {}) {
  const screen = state.screen || "lobby";
  const roomLabel = options.room ? `ROOM · ${esc(options.room)}` : "NBA TEAM DRAFT";

  if (screen === "lobby") {
    stage.innerHTML = `
      <div class="broadcast-layout">
        <div class="broadcast-hero">
          <div class="eyebrow">${roomLabel}</div>
          <h1>NBA TEAM<br>DRAFT</h1>
          <p>${esc(state.message || "Waiting for the commissioner to start the draft.")}</p>
          ${budgets(state.players)}
        </div>
        <div class="broadcast-board-wrap">
          <div class="board-title">TEAM BOARD <span>Tap any team for a local preview</span></div>
          ${teamBoard(state)}
        </div>
      </div>`;
  } else if (screen === "wheel") {
    stage.innerHTML = `
      <div class="watch-team">
        <span class="screen-badge">LIVE WHEEL</span>
        <div class="wheel-broadcast-mark">${state.wheel?.spinning ? "SPINNING…" : "NEXT TEAM"}</div>
        <div class="watch-message">${esc(state.message || "The commissioner is spinning the wheel.")}</div>
        ${budgets(state.players)}
        <button class="open-team-board local-action" type="button">VIEW TEAM BOARD</button>
      </div>`;
  } else if (screen === "team" || screen === "bidding") {
    const selected = teamByName(state.currentTeam);
    const last = state.lastSeasonWins ?? selected?.lastWins ?? "—";
    const line = state.winLine ?? selected?.line ?? "—";
    const delta = Number.isFinite(Number(line)) && Number.isFinite(Number(last))
      ? (Number(line) - Number(last)).toFixed(1)
      : "—";
    stage.innerHTML = `
      <div class="watch-team">
        <span class="screen-badge">${screen === "bidding" ? "LIVE BIDDING" : "TEAM REVEAL"}</span>
        <button class="watch-team-name team-name-button" type="button" data-team="${esc(state.currentTeam || "")}">${esc(state.currentTeam || "TEAM")}</button>
        <div class="watch-metrics">
          ${metric(last, "LAST SEASON WINS")}
          ${metric(line, "THIS SEASON WIN LINE")}
          ${metric(delta === "—" ? delta : (Number(delta) >= 0 ? "+" + delta : delta), "LINE VS LAST SEASON")}
          ${screen === "bidding" ? metric(state.currentBid == null ? "—" : `$${state.currentBid}`, "CURRENT BID") : ""}
        </div>
        <div class="watch-message">${esc(state.message || "Live draft decision.")}</div>
        ${budgets(state.players)}
        <button class="open-team-board local-action" type="button">VIEW TEAM BOARD</button>
      </div>`;
  } else if (screen === "barrel") {
    stage.innerHTML = `
      <div class="watch-lobby">
        <span class="screen-badge">THE BARREL</span>
        <h1>RANDOM<br>ASSIGNMENT</h1>
        <p>${esc(state.message || "Passed teams are being assigned randomly.")}</p>
        ${budgets(state.players)}
        <button class="open-team-board local-action" type="button">VIEW TEAM BOARD</button>
      </div>`;
  } else if (screen === "recap") {
    stage.innerHTML = `
      <div class="watch-lobby">
        <span class="screen-badge">FINAL RECAP</span>
        <h1>DRAFT<br>COMPLETE</h1>
        <p>${esc(state.message || "The draft is complete.")}</p>
        ${budgets(state.players)}
        <div class="broadcast-board-wrap recap-board">${teamBoard(state)}</div>
      </div>`;
  } else {
    stage.innerHTML = `<div class="watch-lobby"><h1>COURTVISION</h1><p>Waiting for the next update.</p></div>`;
  }

  stage.querySelectorAll("[data-team]").forEach(el => {
    el.addEventListener("click", () => {
      const name = el.dataset.team;
      if (name) options.onTeamClick?.(name);
    });
  });

  stage.querySelectorAll(".open-team-board").forEach(el => {
    el.addEventListener("click", () => options.onOpenBoard?.());
  });
}

export function renderLocalTeamOverlay(container, teamName, onClose) {
  const team = teamByName(teamName);
  if (!team) return;
  const delta = (team.line - team.lastWins).toFixed(1);
  container.innerHTML = `
    <div class="local-overlay-backdrop">
      <section class="local-team-window" role="dialog" aria-modal="true" aria-label="${esc(team.name)}">
        <div class="local-only-badge">YOUR VIEW ONLY</div>
        <button class="local-close" type="button">BACK TO LIVE DRAFT</button>
        <div class="eyebrow">TEAM PREVIEW</div>
        <div class="local-team-abbr">${team.abbr}</div>
        <h2>${esc(team.name)}</h2>
        <div class="watch-metrics">
          ${metric(team.lastWins, "LAST SEASON WINS")}
          ${metric(team.line, "THIS SEASON WIN LINE")}
          ${metric(Number(delta) >= 0 ? "+" + delta : delta, "LINE VS LAST SEASON")}
        </div>
        <p class="local-note">This preview is only on your device. The live draft continues underneath.</p>
      </section>
    </div>`;
  container.hidden = false;
  container.querySelector(".local-close")?.addEventListener("click", onClose);
}

export function renderLocalBoardOverlay(container, state, onTeamClick, onClose) {
  container.innerHTML = `
    <div class="local-overlay-backdrop">
      <section class="local-board-window" role="dialog" aria-modal="true">
        <div class="local-only-badge">YOUR VIEW ONLY</div>
        <button class="local-close" type="button">BACK TO LIVE DRAFT</button>
        <div class="eyebrow">TEAM BOARD</div>
        <h2>Explore a team</h2>
        ${teamBoard(state)}
      </section>
    </div>`;
  container.hidden = false;
  container.querySelector(".local-close")?.addEventListener("click", onClose);
  container.querySelectorAll("[data-team]").forEach(el => {
    el.addEventListener("click", () => onTeamClick?.(el.dataset.team));
  });
}
