import { roomFromLocation, getState, connectRoom } from "./shared.js";

const room = roomFromLocation();
const stage = document.getElementById("stage");
const statusEl = document.getElementById("connStatus");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]));
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

function render(state) {
  const screen = state.screen || "lobby";

  if (screen === "lobby") {
    stage.innerHTML = `
      <div class="watch-lobby">
        <div class="eyebrow">ROOM · ${esc(room)}</div>
        <h1>NBA TEAM<br>DRAFT</h1>
        <p>${esc(state.message || "Waiting for the commissioner to start the draft.")}</p>
        ${budgets(state.players)}
      </div>`;
    return;
  }

  if (screen === "wheel") {
    stage.innerHTML = `
      <div class="watch-team">
        <span class="screen-badge">LIVE WHEEL</span>
        <div class="watch-team-name">${state.wheel?.spinning ? "SPINNING…" : "NEXT TEAM"}</div>
        <div class="watch-message">${esc(state.message || "The commissioner is spinning the wheel.")}</div>
        ${budgets(state.players)}
      </div>`;
    return;
  }

  if (screen === "team" || screen === "bidding") {
    const last = state.lastSeasonWins ?? "—";
    const line = state.winLine ?? "—";
    const delta = Number.isFinite(Number(line)) && Number.isFinite(Number(last))
      ? (Number(line) - Number(last)).toFixed(1)
      : "—";
    const bidMetric = screen === "bidding" ? metric(state.currentBid == null ? "—" : `$${state.currentBid}`, "CURRENT BID") : "";
    stage.innerHTML = `
      <div class="watch-team">
        <span class="screen-badge">${screen === "bidding" ? "LIVE BIDDING" : "TEAM REVEAL"}</span>
        <div class="watch-team-name">${esc(state.currentTeam || "TEAM")}</div>
        <div class="watch-metrics">
          ${metric(last, "LAST SEASON WINS")}
          ${metric(line, "THIS SEASON WIN LINE")}
          ${metric(delta === "—" ? delta : (Number(delta) >= 0 ? "+" + delta : delta), "LINE VS LAST SEASON")}
          ${bidMetric}
        </div>
        <div class="watch-message">${esc(state.message || "Live draft decision.")}</div>
        ${budgets(state.players)}
      </div>`;
    return;
  }

  if (screen === "barrel") {
    stage.innerHTML = `
      <div class="watch-lobby">
        <span class="screen-badge">THE BARREL</span>
        <h1>RANDOM<br>ASSIGNMENT</h1>
        <p>${esc(state.message || "Passed teams are being assigned randomly.")}</p>
        ${budgets(state.players)}
      </div>`;
    return;
  }

  if (screen === "recap") {
    stage.innerHTML = `
      <div class="watch-lobby">
        <span class="screen-badge">FINAL RECAP</span>
        <h1>DRAFT<br>COMPLETE</h1>
        <p>${esc(state.message || "The draft is complete.")}</p>
        ${budgets(state.players)}
      </div>`;
    return;
  }

  stage.innerHTML = `<div class="watch-lobby"><h1>COURTVISION</h1><p>Waiting for the next update.</p></div>`;
}

function setStatus(value) {
  statusEl.textContent = value === "live" ? "LIVE" : value.toUpperCase();
  statusEl.classList.toggle("live", value === "live");
}

try { render(await getState(room)); } catch (_) {}
connectRoom(room, { onStatus: setStatus, onState: render });
