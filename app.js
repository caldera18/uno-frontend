"use strict";

const WS_URL =
  location.protocol === "file:" ||
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1"
    ? "ws://localhost:3000"
    : "wss://uno-backend-3lop.onrender.com";

const IS_REMOTE = WS_URL.startsWith("wss:");
const WAKE_URL = WS_URL.replace(/^wss:/, "https:");

// El servidor habla español; los archivos de assets/ están en inglés.
const COLOR_CLASS = { Rojo: "rojo", Amarillo: "amarillo", Verde: "verde", Azul: "azul" };
const COLOR_FILE  = { Rojo: "Red", Amarillo: "Yellow", Verde: "Green", Azul: "Blue" };
const VALUE_FILE = {
  "0": "Zero", "1": "One",   "2": "Two",   "3": "Three", "4": "Four",
  "5": "Five", "6": "Six",   "7": "Seven", "8": "Eight", "9": "Nine",
  "Bloqueo": "SkipTurn", "CambioSentido": "Reverse", "+2": "DrawTwo"
};
const WILD_FILE = { "CambiaColor": "Wild_ChangeColor", "+4": "Wild_DrawFour" };

// Se detecta por value: al jugarse, el servidor le reescribe el color al elegido,
// así que "Comodín" solo aparece mientras la carta está en la mano.
const isWild = card => card.value === "CambiaColor" || card.value === "+4";
const colorClass = card => COLOR_CLASS[card.color] || "wild";

// Los comodines no tienen archivo por color: hay uno solo para los cuatro.
const cardImage = card =>
  isWild(card)
    ? `assets/${WILD_FILE[card.value]}.png`
    : `assets/${COLOR_FILE[card.color]}_${VALUE_FILE[card.value]}.png`;

const cardAlt = card => isWild(card) ? card.value : `${card.color} ${card.value}`;

const $ = id => document.getElementById(id);

let socket = null;
let state = null;
let pendingWildIndex = null;   // carta esperando elección de color
let popupOpen = false;         // hay una penalización sin aceptar
let connected = false;

/* ---------------- Conexión ---------------- */

const setStatus = text => { $("status").textContent = text; };

// El plan gratuito de Render duerme el servicio, y un upgrade de WebSocket no lo
// despierta: responde 404 y corta. Solo una petición HTTP normal lo levanta.
// La respuesta no nos interesa (no-cors la vuelve opaca), sí que el pedido llegue.
async function wakeBackend() {
  setStatus("Despertando el servidor, puede tardar hasta un minuto…");
  try {
    await fetch(WAKE_URL, { mode: "no-cors", cache: "no-store" });
  } catch {
    // Si falla igual intentamos: quizá ya estaba despierto.
  }
}

async function connect() {
  $("btnJoin").disabled = true;
  if (IS_REMOTE) await wakeBackend();

  setStatus("Conectando…");
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    connected = true;
    setStatus("");
    $("btnJoin").disabled = false;
  };

  socket.onmessage = event => {
    const { type, data } = JSON.parse(event.data);

    if (type === "waitingRoom")   renderWaiting(data);
    else if (type === "gameState") onGameState(data);
    else if (type === "showPopup") showPopup(data);
    else if (type === "errorMsg")  alert(data);
    else if (type === "gameOver")  showGameOver(data);
  };

  socket.onclose = () => {
    if (!connected) {
      setStatus("No se pudo conectar. Reintentando…");
      setTimeout(connect, 3000);
      return;
    }
    showGameOver("Se perdió la conexión con el servidor.");
  };
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

  // Un comodín siempre usa la misma imagen, así que el color activo que eligió
  // el jugador solo se ve por el halo que le pone la clase de color.
  const top = $("topCard");
  top.className = "card " + colorClass(state.topCard);
  top.src = cardImage(state.topCard);
  top.alt = cardAlt(state.topCard);

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
    const el = document.createElement("img");
    el.className = "card";
    el.src = cardImage(card);
    el.alt = cardAlt(card);
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
