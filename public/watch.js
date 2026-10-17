import { roomFromLocation, getState, connectRoom } from "./shared.js";
import { renderBroadcastStage, renderLocalTeamOverlay, renderLocalBoardOverlay } from "./stage.js";

const room = roomFromLocation();
const stage = document.getElementById("stage");
const statusEl = document.getElementById("connStatus");
const overlay = document.getElementById("localOverlay");

let currentState = null;
let lastFocusToken = null;
let localMode = null;

function closeLocal() {
  localMode = null;
  overlay.hidden = true;
  overlay.innerHTML = "";
}

function openTeam(name) {
  localMode = { type: "team", name };
  renderLocalTeamOverlay(overlay, name, closeLocal);
}

function openBoard() {
  localMode = { type: "board" };
  renderLocalBoardOverlay(overlay, currentState || {}, openTeam, closeLocal);
}

function render(state) {
  currentState = state;

  if (lastFocusToken !== null && state.focusToken && state.focusToken !== lastFocusToken) {
    closeLocal();
  }
  if (state.focusToken) lastFocusToken = state.focusToken;

  renderBroadcastStage(stage, state, {
    room,
    onTeamClick: openTeam,
    onOpenBoard: openBoard,
  });
}

function setStatus(value) {
  statusEl.textContent = value === "live" ? "LIVE" : value.toUpperCase();
  statusEl.classList.toggle("live", value === "live");
}

try {
  const state = await getState(room);
  lastFocusToken = state.focusToken || null;
  render(state);
} catch (_) {}

connectRoom(room, { onStatus: setStatus, onState: render });
