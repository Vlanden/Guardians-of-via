/* ===========================================================
   Guardianes de la Vía — "Carril Correcto"
   Juego extra: disciplina de carriles al girar.
   Pixel art sobre <canvas>, sin dependencias externas.
   =========================================================== */
(function () {
  'use strict';

  const canvas = document.getElementById('carrilCanvas');
  if (!canvas) return; // si el canvas no existe, no hacemos nada
  const ctx = canvas.getContext('2d');

  /* ---------- Resolución virtual (pixel art) ---------- */
  const VW = 180, VH = 240, S = 2;        // lienzo interno 360x480
  canvas.width = VW * S;
  canvas.height = VH * S;
  ctx.setTransform(S, 0, 0, S, 0, 0);     // dibujamos en coordenadas 180x240
  ctx.imageSmoothingEnabled = false;

  const reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Paleta ---------- */
  const C = {
    walk:   '#3b4054', curb: '#565d78',
    asph:   '#262a3a', asph2: '#2d3245',
    edge:   '#d9e0e8', dash: '#f4d35e', zebra: '#e9eef5',
    outline:'#0c0f17',
    player: '#2ec4b6', playerDark: '#1f8e83',
    npc:    '#ff9f1c',
    glass:  '#bfe9ff', head: '#fff3c4', tail: '#ff5252',
    amber:  '#ffb703', green: '#06d6a0', red: '#ef476f',
    shadow: 'rgba(0,0,0,0.30)'
  };

  /* ---------- Geometría de la carretera ---------- */
  const ROAD_L = 30, ROAD_R = 150;        // bordes del asfalto
  const LANE_X = [50, 90, 130];           // centro de cada carril (izq/centro/der)
  const PLAYER_Y = 190;                   // posición fija del coche del jugador

  /* ---------- Estado del juego ---------- */
  const ST = { INTRO: 'intro', PLAY: 'play', FEEDBACK: 'feedback', RESULTS: 'results' };
  const TOTAL = 10;          // rondas
  const APPROACH = reduceMotion ? 4.2 : 3.4; // segundos para llegar al cruce

  let state = ST.INTRO;
  let round = 0, score = 0;
  let playerLane = 1;        // 0 izq, 1 centro, 2 der
  let playerX = LANE_X[1];   // x animada
  let turnAngle = 0;         // ángulo del coche (para animar el giro)
  let maneuver = 1;          // 0 izq, 1 frente, 2 der
  let approach = 0;          // 0..1 progreso del cruce hacia el coche
  let scroll = 0;            // desplazamiento del asfalto (sensación de avance)
  let fbTimer = 0, fbOk = false;
  let introT = 0;
  let startStr = '';         // marca de tiempo de inicio (para el backend)

  /* ---------- Textos de cada maniobra ---------- */
  const MAN = [
    { arrow: '\u25C0', dir: 'IZQUIERDA', lane: 'IZQUIERDO' },  // 0
    { arrow: '\u25B2', dir: 'DE FRENTE', lane: 'CENTRAL'  },    // 1
    { arrow: '\u25B6', dir: 'DERECHA',   lane: 'DERECHO'  }     // 2
  ];

  /* ---------- Referencias del HUD (DOM) ---------- */
  const $ = (id) => document.getElementById(id);
  const elRound = $('cg-round'), elScore = $('cg-score');
  const elArrow = $('cg-arrow'), elManeuver = $('cg-maneuver');
  const elApproach = $('cg-approach'), elFeedback = $('cg-feedback');
  const elIntro = $('cg-overlay-intro'), elResults = $('cg-overlay-results');
  const elFinal = $('cg-final'), elFinalMsg = $('cg-final-msg');
  const btns = { 0: $('cg-left'), 1: $('cg-center'), 2: $('cg-right') };

  /* ===========================================================
     ENTRADA (teclado, botones, toque)
     =========================================================== */
  function setLane(n) {
    if (state !== ST.PLAY) return;
    playerLane = Math.max(0, Math.min(2, n));
    highlightLane();
  }
  function highlightLane() {
    for (let i = 0; i < 3; i++) {
      if (btns[i]) btns[i].classList.toggle('is-active', i === playerLane && state === ST.PLAY);
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') setLane(playerLane - 1);
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') setLane(playerLane + 1);
    else if (e.key === '1') setLane(0);
    else if (e.key === '2') setLane(1);
    else if (e.key === '3') setLane(2);
    else if ((e.key === 'Enter' || e.key === ' ') && state === ST.INTRO) startGame();
  });
  Object.keys(btns).forEach((k) => {
    if (btns[k]) btns[k].addEventListener('click', () => setLane(Number(k)));
  });
  const btnStart = $('cg-start'); if (btnStart) btnStart.addEventListener('click', startGame);
  const btnAgain = $('cg-again'); if (btnAgain) btnAgain.addEventListener('click', startGame);

  /* ===========================================================
     FLUJO DE PARTIDA
     =========================================================== */
  function startGame() {
    round = 0; score = 0;
    playerLane = 1; playerX = LANE_X[1]; turnAngle = 0;
    startStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (elIntro) elIntro.classList.add('cg-hidden');
    if (elResults) elResults.classList.add('cg-hidden');
    updateScore();
    nextRound();
  }

  function nextRound() {
    round++;
    if (round > TOTAL) { endGame(); return; }
    maneuver = Math.floor(Math.random() * 3);
    approach = 0; turnAngle = 0;
    state = ST.PLAY;
    if (elRound) elRound.textContent = 'Ronda ' + round + '/' + TOTAL;
    if (elArrow) { elArrow.textContent = MAN[maneuver].arrow; elArrow.className = 'cg-arrow'; }
    if (elManeuver) elManeuver.textContent = 'Gira a la ' + MAN[maneuver].dir;
    if (maneuver === 1 && elManeuver) elManeuver.textContent = 'Sigue ' + MAN[maneuver].dir;
    if (elFeedback) elFeedback.className = 'cg-feedback';
    highlightLane();
  }

  function evaluate() {
    fbOk = (playerLane === maneuver);
    if (fbOk) score += 10;
    updateScore();
    state = ST.FEEDBACK;
    fbTimer = fbOk ? 1.3 : 2.1;

    if (elFeedback) {
      if (fbOk) {
        elFeedback.textContent = '\u2705 \u00a1Correcto! Carril ' + MAN[maneuver].lane.toLowerCase();
        elFeedback.className = 'cg-feedback cg-ok show';
      } else {
        elFeedback.textContent = '\u274C Para ir ' +
          (maneuver === 1 ? 'de frente' : 'a la ' + MAN[maneuver].dir.toLowerCase()) +
          ' usa el carril ' + MAN[maneuver].lane.toLowerCase();
        elFeedback.className = 'cg-feedback cg-bad show';
      }
    }
    highlightLane();
  }

  function endGame() {
    state = ST.RESULTS;
    if (elFeedback) elFeedback.className = 'cg-feedback';
    const pct = Math.round((score / (TOTAL * 10)) * 100);
    if (elFinal) elFinal.textContent = pct + ' / 100';
    if (elFinalMsg) {
      let msg = 'Sigue practicando la disciplina de carriles.';
      if (pct === 100) msg = '\u00a1Perfecto! Eres un verdadero Guardián de la Vía.';
      else if (pct >= 70) msg = '\u00a1Muy bien! Dominas casi todos los giros.';
      else if (pct >= 40) msg = 'Vas por buen camino, repasa los giros que fallaste.';
      elFinalMsg.textContent = msg;
    }
    if (elResults) elResults.classList.remove('cg-hidden');
    submitScore(pct);
  }

  function updateScore() { if (elScore) elScore.textContent = score + ' pts'; }

  /* ---------- Envío de puntuación al backend (best-effort) ----------
     Coincide con /games/guardar-puntuacion. En modo standalone (sin
     etiqueta csrf-token ni data-juego-id) simplemente se omite. */
  async function submitScore(pct) {
    const root = $('carril-game');
    const juegoId = root && root.dataset ? root.dataset.juegoId : null;
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (!juegoId || !meta) return; // jugando fuera de Flask: no enviamos
    try {
      await fetch('/games/guardar-puntuacion', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': meta.content,
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          juego_id: juegoId,
          puntuacion: pct,
          fecha_inicio: startStr,
          fecha_fin: new Date().toISOString().slice(0, 19).replace('T', ' ')
        })
      });
    } catch (err) {
      console.warn('No se pudo enviar la puntuación:', err);
    }
  }

  /* ===========================================================
     ACTUALIZACIÓN (lógica por frame)
     =========================================================== */
  function update(dt) {
    const speed = reduceMotion ? 40 : 70;     // px/seg de avance visual
    scroll = (scroll + speed * dt) % 20;

    if (state === ST.INTRO) {
      introT += dt;
      if (introT > 4.8) introT = 0;            // bucle de la demo
      return;
    }

    if (state === ST.PLAY) {
      // el coche se desliza suavemente hacia el carril elegido
      playerX += (LANE_X[playerLane] - playerX) * Math.min(1, dt * 10);
      approach += dt / APPROACH;
      if (approach >= 1) { approach = 1; evaluate(); }
      // barra de aproximación
      if (elApproach) elApproach.style.width = Math.round(approach * 100) + '%';
      return;
    }

    if (state === ST.FEEDBACK) {
      playerX += (LANE_X[playerLane] - playerX) * Math.min(1, dt * 10);
      // si acertó, animamos el giro del coche en la dirección de la maniobra
      if (fbOk && maneuver !== 1) {
        const target = maneuver === 0 ? -1.15 : 1.15;
        turnAngle += (target - turnAngle) * Math.min(1, dt * 6);
      }
      fbTimer -= dt;
      if (fbTimer <= 0) { if (elApproach) elApproach.style.width = '0%'; nextRound(); }
      return;
    }
  }

  /* ===========================================================
     DIBUJO
     =========================================================== */
  function clear() {
    ctx.fillStyle = C.walk;
    ctx.fillRect(0, 0, VW, VH);
  }

  function drawRoad() {
    // acera / banqueta a los lados
    ctx.fillStyle = C.walk; ctx.fillRect(0, 0, VW, VH);
    // textura de losetas en la acera (líneas que se desplazan)
    ctx.fillStyle = C.curb;
    for (let y = -((scroll * 1.2) % 24); y < VH; y += 24) {
      ctx.fillRect(0, y, ROAD_L - 2, 1);
      ctx.fillRect(ROAD_R + 2, y, VW - ROAD_R - 2, 1);
    }
    // bordillo
    ctx.fillStyle = C.curb;
    ctx.fillRect(ROAD_L - 2, 0, 2, VH);
    ctx.fillRect(ROAD_R, 0, 2, VH);
    // asfalto
    ctx.fillStyle = C.asph; ctx.fillRect(ROAD_L, 0, ROAD_R - ROAD_L, VH);
    // líneas de borde
    ctx.fillStyle = C.edge;
    ctx.fillRect(ROAD_L, 0, 2, VH);
    ctx.fillRect(ROAD_R - 2, 0, 2, VH);
    // líneas discontinuas entre carriles
    ctx.fillStyle = C.dash;
    for (let y = -20 + (scroll % 20); y < VH; y += 20) {
      ctx.fillRect(70 - 1, y, 2, 10);
      ctx.fillRect(110 - 1, y, 2, 10);
    }
  }

  // Cruce que se aproxima (calle transversal + paso de cebra + línea de alto)
  function drawIntersection() {
    const y = -30 + approach * (PLAYER_Y - 8 + 30); // baja hasta el coche
    const h = 46;
    // calle transversal (cubre también las aceras = 4 vías)
    ctx.fillStyle = C.asph2; ctx.fillRect(0, y, VW, h);
    ctx.fillStyle = C.asph;  ctx.fillRect(0, y + 4, VW, h - 8);
    // flecha-guía en el asfalto, justo antes del cruce
    drawGuideArrow(maneuver, 90, y + h + 22);
    // paso de cebra (franjas perpendiculares al avance)
    ctx.fillStyle = C.zebra;
    for (let i = 0; i < 4; i++) ctx.fillRect(ROAD_L + 4, y + h + 2 + i * 5, ROAD_R - ROAD_L - 8, 3);
    // línea de alto
    ctx.fillStyle = C.edge; ctx.fillRect(ROAD_L + 2, y + h + 24, ROAD_R - ROAD_L - 4, 3);
  }

  function drawGuideArrow(dir, cx, cy) {
    if (cy < -20 || cy > VH + 10) return;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = state === ST.FEEDBACK ? (fbOk ? C.green : C.red) : C.amber;
    ctx.translate(cx, cy);
    if (dir === 0) ctx.rotate(-Math.PI / 2);
    else if (dir === 2) ctx.rotate(Math.PI / 2);
    // flecha apuntando hacia arriba (stem + cabeza)
    ctx.fillRect(-2, -2, 4, 12);          // tallo
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(-8, -2); ctx.lineTo(8, -2); ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Coche visto desde arriba (procedural, estilo pixel)
  function drawCar(cx, cy, color, colorDark, angle) {
    ctx.save();
    ctx.translate(cx, cy);
    // sombra
    ctx.fillStyle = C.shadow;
    ctx.fillRect(-9, -12, 18, 28);
    ctx.rotate(angle || 0);
    // ruedas
    ctx.fillStyle = C.outline;
    ctx.fillRect(-10, -11, 3, 7); ctx.fillRect(7, -11, 3, 7);
    ctx.fillRect(-10, 4, 3, 7);   ctx.fillRect(7, 4, 3, 7);
    // carrocería
    ctx.fillStyle = C.outline; ctx.fillRect(-9, -14, 18, 28);
    ctx.fillStyle = color;      ctx.fillRect(-8, -13, 16, 26);
    ctx.fillStyle = colorDark;  ctx.fillRect(-8, -13, 16, 4); // capó
    // cristales
    ctx.fillStyle = C.glass;
    ctx.fillRect(-6, -9, 12, 6);   // parabrisas
    ctx.fillRect(-6, 5, 12, 5);    // luneta trasera
    // luces
    ctx.fillStyle = C.head; ctx.fillRect(-7, -14, 3, 2); ctx.fillRect(4, -14, 3, 2);
    ctx.fillStyle = C.tail; ctx.fillRect(-7, 12, 3, 2);  ctx.fillRect(4, 12, 3, 2);
    ctx.restore();
  }

  // Escena de la intro: coche girando MAL desde el carril central
  function drawIntro() {
    drawRoad();
    const t = introT;
    let x = 90, y = 200, a = 0;
    if (t < 1.7) {                          // sube por el carril central
      y = 210 - (t / 1.7) * 95;             // 210 -> 115
    } else if (t < 3.2) {                   // gira a la izquierda cruzando carriles
      const p = (t - 1.7) / 1.5;
      x = 90 - p * 56;                      // 90 -> 34
      y = 115 - p * 18;
      a = -p * 1.25;
    } else {                                // sale ya girado
      x = 34; y = 97; a = -1.25;
    }
    // destello rojo cuando empieza el giro indebido
    const flashing = t > 1.7 && t < 3.4;
    drawCar(x, y, C.npc, '#cc7e16', a);
    if (flashing && (Math.floor(t * 6) % 2 === 0)) {
      // X roja sobre el coche
      ctx.strokeStyle = C.red; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 13, y - 13); ctx.lineTo(x + 13, y + 13);
      ctx.moveTo(x + 13, y - 13); ctx.lineTo(x - 13, y + 13);
      ctx.stroke();
    }
  }

  function drawPlay() {
    drawRoad();
    drawIntersection();
    const c = (state === ST.FEEDBACK)
      ? (fbOk ? [C.green, '#05a87e'] : [C.red, '#b8324f'])
      : [C.player, C.playerDark];
    drawCar(playerX, PLAYER_Y, c[0], c[1], turnAngle);
  }

  function render() {
    clear();
    if (state === ST.INTRO) drawIntro();
    else if (state === ST.RESULTS) { drawRoad(); drawCar(LANE_X[1], PLAYER_Y, C.player, C.playerDark, 0); }
    else drawPlay();
  }

  /* ===========================================================
     BUCLE PRINCIPAL
     =========================================================== */
  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // evita saltos si la pestaña estuvo inactiva
    update(dt);
    render();
    requestAnimationFrame(loop);
  }
  highlightLane();
  requestAnimationFrame(loop);
})();
