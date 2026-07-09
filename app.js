"use strict";

const WS_URL =
  location.protocol === "file:" ||
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1"
    ? "ws://localhost:3000"
    : "wss://TU-APP.onrender.com";

const COLOR_CLASS = { Rojo: "rojo", Amarillo: "amarillo", Verde: "verde", Azul: "azul" };
const GLYPH = { Bloqueo: "\u{1F6AB}", CambioSentido: "\u{1F504}", CambiaColor: "\u{1F308}" };

// Se detecta por value: al jugarse, el servidor le reescribe el color al elegido,
// así que "Comodín" solo aparece mientras la carta está en la mano.
const isWild = card => card.value === "CambiaColor" || card.value === "+4";
const colorClass = card => COLOR_CLASS[card.color] || "wild";
const glyph = card => GLYPH[card.value] || card.value;

const $ = id => document.getElementById(id);

let socket = null;
let state = null;
let pendingWildIndex = null;   // carta esperando elección de color
let popupOpen = false;         // hay una penalización sin aceptar

/* ---------------- Conexión ---------------- */

function connect() {
  socket = new WebSocket(WS_URL);

  socket.onmessage = event => {
    const { type, data } = JSON.parse(event.data);

    if (type === "waitingRoom")   renderWaiting(data);
    else if (type === "gameState") onGameState(data);
    else if (type === "showPopup") showPopup(data);
    else if (type === "errorMsg")  alert(data);
    else if (type === "gameOver")  showGameOver(data);
  };

  socket.onclose = () => showGameOver("Se perdió la conexión con el servidor.");
}

const send = (type, data) => socket.send(JSON.stringify({ type, data }));

/* ---------------- Lobby ---------------- */

function join() {
  const name = $("nameInput").value.trim();
  if (!name) return;
  $("btnJoin").disabled = true;
  $("nameInput").disabled = true;
  send("joinGame", name);
}

$("btnJoin").onclick = join;
$("nameInput").onkeydown = e => { if (e.key === "Enter") join(); };

function renderWaiting(names) {
  const list = $("waitingList");
  list.innerHTML = "";

  names.forEach(name => {
    const li = document.createElement("li");
    li.textContent = name;
    list.appendChild(li);
  });

  for (let i = names.length; i < 4; i++) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Esperando jugador…";
    list.appendChild(li);
  }
}

/* ---------------- Estado del juego ---------------- */

function onGameState(data) {
  state = data;

  if (state.gameStarted) {
    $("lobby").classList.remove("active");
    $("game").classList.add("active");
  }

  // Si la pausa terminó, la penalización ya fue resuelta por su dueño.
  if (!state.isPaused && popupOpen) closePopup();

  render();
}

function render() {
  if (!state) return;

  const banner = $("turnBanner");
  banner.classList.toggle("mine", state.isMyTurn);
  $("turnText").textContent = state.isMyTurn
    ? "Es tu turno"
    : `Turno de ${state.currentTurnName}`;
  banner.querySelector(".dir").textContent = "Sentido: " + state.direction;

  $("log").textContent = state.log || "";

  const top = $("topCard");
  top.className = "card " + colorClass(state.topCard);
  top.textContent = glyph(state.topCard);

  $("drawPile").classList.toggle("enabled", state.isMyTurn);

  // La botonera es global: aparece en las 4 pantallas apenas alguien queda con
  // una carta. El servidor decide quién puede cantar qué.
  $("unoBar").classList.toggle("show", state.mostrarBotoneraUno && !state.isPaused);

  renderHand();
}

function renderHand() {
  const hand = $("hand");
  hand.innerHTML = "";
  hand.classList.toggle("playable", state.isMyTurn);

  state.hand.forEach((card, index) => {
    const el = document.createElement("div");
    el.className = "card small " + colorClass(card);
    el.textContent = glyph(card);
    el.onclick = () => playCard(index);
    hand.appendChild(el);
  });
}

/* ---------------- Acciones ---------------- */

function playCard(index) {
  if (!state.isMyTurn || popupOpen) return;

  // Un comodín sin chosenColor deja la carta de la mesa con color null y rompe
  // la partida: hay que elegir el color antes de enviar nada.
  if (isWild(state.hand[index])) {
    pendingWildIndex = index;
    $("colorOverlay").classList.add("show");
    return;
  }

  send("playCard", { index, chosenColor: null });
}

document.querySelectorAll("#colorGrid button").forEach(btn => {
  btn.onclick = () => {
    $("colorOverlay").classList.remove("show");
    send("playCard", { index: pendingWildIndex, chosenColor: btn.dataset.color });
    pendingWildIndex = null;
  };
});

$("drawPile").onclick = () => {
  if (state && state.isMyTurn && !popupOpen) send("drawCard");
};

$("btnUno").onclick   = () => send("cantarUno");
$("btnCorte").onclick = () => send("cantarCorte");

/* ---------------- Popup bloqueante ---------------- */

function showPopup(message) {
  popupOpen = true;
  $("popupText").textContent = message;
  $("popupOverlay").classList.add("show");
}

function closePopup() {
  popupOpen = false;
  $("popupOverlay").classList.remove("show");
}

// Solo el castigado ve este botón. El servidor no valida quién manda
// resolvePopup, así que nadie más debe poder reanudar la partida.
$("btnResolve").onclick = () => {
  closePopup();
  send("resolvePopup");
};

/* ---------------- Fin ---------------- */

function showGameOver(message) {
  $("overText").textContent = message;
  $("overOverlay").classList.add("show");
}

$("btnRestart").onclick = () => location.reload();

connect();
