/* App de Hyrox de Alex. Lee el programa y las sesiones del repositorio privado y guarda sesiones nuevas en él.
   El Excel lo rehace GitHub (Actions) cada vez que entra una sesión. */
"use strict";

const DIAS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO"];
const DIAS_CORTO = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MODO_LOCAL = new URLSearchParams(location.search).has("local");

/* ---------- almacenamiento del navegador (siempre con try/catch) ---------- */
const guarda = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
const lee = (k, def) => { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } };
const borra = (k) => { try { localStorage.removeItem(k); } catch (e) { /* nada */ } };

const E = {
  cfg: lee("cfg", { token: "", owner: "diawenecom", repo: "entrenamiento-hyrox" }),
  datos: lee("datos_cache", null),
  vista: "plan",
  sel: null,              // {meso, semana, dia}
  apunte: null,           // sesión que se está apuntando
  cargando: false,
  error: "",
  ejProgreso: "",
};

/* ---------- utilidades ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (s, el = document) => el.querySelector(s);
function aviso(txt, ms = 2600) {
  const a = $("#aviso"); a.textContent = txt; a.classList.add("visible");
  clearTimeout(aviso.t); aviso.t = setTimeout(() => a.classList.remove("visible"), ms);
}
function fecha(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function iso(f) { return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`; }
function hoyIso() { return iso(new Date()); }
function sumaDias(isoTxt, n) { const f = fecha(isoTxt); f.setDate(f.getDate() + n); return iso(f); }
function corta(isoTxt) { const f = fecha(isoTxt); return `${f.getDate()} ${MESES[f.getMonth()]}`; }
function diaSemana(isoTxt) { return DIAS[(fecha(isoTxt).getDay() + 6) % 7]; }
function bonito(n) {
  const s = String(n).toLowerCase();
  return (s.charAt(0).toUpperCase() + s.slice(1)).replace(/\bmp\b/g, "MP").replace(/\brir\b/g, "RIR").replace(/\bt\b/g, "T");
}
function num(v) {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  const t = String(v).trim().replace(",", ".");
  if (/^fallo$/i.test(t) || /^f$/i.test(t)) return "fallo";
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}
function fmt(v) { return v === undefined || v === null ? "" : (typeof v === "number" ? String(v).replace(".", ",") : String(v)); }

/* ---------- programa ---------- */
const mesos = () => (E.datos ? E.datos.mesociclos : []);
function finMeso(m) { return sumaDias(m.inicio, 7 * m.semanas - 1); }
function situar(isoTxt) {
  for (const m of mesos()) {
    if (isoTxt >= m.inicio && isoTxt <= finMeso(m)) {
      const dias = Math.round((fecha(isoTxt) - fecha(m.inicio)) / 86400000);
      return { meso: m, semana: Math.floor(dias / 7) + 1, dia: diaSemana(isoTxt) };
    }
  }
  return null;
}
function fechaDe(m, semana, dia) { return sumaDias(m.inicio, (semana - 1) * 7 + DIAS.indexOf(dia)); }
function diaPrograma(m, dia) { return m.dias.find((d) => d.dia === dia) || { dia, titulo: dia, ejercicios: [] }; }
function sesionesDe(isoTxt) { return (E.datos?.sesiones || []).filter((s) => s.fecha === isoTxt); }
function sesionDia(m, semana, dia) {
  return (E.datos?.sesiones || []).find((s) => s.meso === m.id && s.semana === semana && s.dia === dia);
}
function ultimaVez(nombre, antesDe) {
  const ss = (E.datos?.sesiones || []).filter((s) => !s.cancelada && s.fecha < antesDe).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  for (const s of ss) {
    const e = s.ejercicios.find((x) => x.nombre === nombre);
    if (e) return { fecha: s.fecha, e };
  }
  return null;
}
function resumen(e) {
  if (!e) return "";
  const p = [];
  if (e.series && e.series.length) {
    p.push(e.series.map((s) => `${fmt(s.peso) || "?"}×${fmt(s.reps) || "?"}${s.rir !== undefined ? ` (${s.rir === "fallo" ? "F" : "RIR " + s.rir})` : ""}`).join(" · "));
  }
  if (e.min !== undefined) p.push(`${fmt(e.min)} min`);
  if (e.dist) p.push(e.dist);
  if (e.rpe && e.rpe.length) p.push(`RPE ${e.rpe.join("/")}`);
  if (e.gemelo_durante !== undefined) p.push(`gemelo ${e.gemelo_durante}/10`);
  if (e.gemelo_manana !== undefined) p.push(`mañana ${e.gemelo_manana}/10`);
  if (e.hecho_en_vez) p.push(`en vez: ${e.hecho_en_vez}`);
  if (!p.length && e.notas) p.push(e.notas);
  return p.join(" · ");
}
function icono(bloque) {
  return { Fuerza: "🏋", Gemelo: "♡", Cardio: "🚲", Movilidad: "🧘", Core: "◎", "Técnica": "⛷" }[bloque] || "•";
}
const esFuerza = (ej) => ej.bloque === "Fuerza";

/* ---------- GitHub ---------- */
function api(ruta) { return `https://api.github.com/repos/${E.cfg.owner}/${E.cfg.repo}/contents/${ruta}`; }
function cab(raw) {
  return { Authorization: `Bearer ${E.cfg.token}`, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28" };
}
function b64(str) {
  const bytes = new TextEncoder().encode(str); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function deb64(b) { const bin = atob(b.replace(/\n/g, "")); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); }

async function cargarDatos() {
  E.cargando = true; E.error = ""; pinta();
  try {
    let d;
    if (MODO_LOCAL) {
      d = await (await fetch("datos.json", { cache: "no-store" })).json();
    } else {
      if (!E.cfg.token) { E.error = "falta-llave"; return; }
      const r = await fetch(api("app/datos.json") + "?ref=main&t=" + Date.now(), { headers: cab(true), cache: "no-store" });
      if (r.status === 401) throw new Error("La llave no es válida o ha caducado. Revísala en Ajustes.");
      if (r.status === 404) throw new Error("No encuentro el repositorio o la llave no tiene acceso a él. Revísalo en Ajustes.");
      if (!r.ok) throw new Error(`GitHub respondió ${r.status}.`);
      d = await r.json();
    }
    // sesiones guardadas desde aquí que GitHub aún no ha procesado; se olvidan en cuanto los datos ya las traen
    const generado = new Date(d.generado);
    const locales = lee("pendientes", []).filter((p) =>
      !((d.sesiones || []).some((s) => s.fecha === p.fecha) && generado > new Date(p._guardado || 0)));
    guarda("pendientes", locales);
    E.datos = d;
    for (const p of locales) fusionaLocal(p);
    guarda("datos_cache", d);
    if (!E.sel) irAHoy();
  } catch (e) {
    E.error = e.message || "No he podido cargar los datos.";
  } finally {
    E.cargando = false; pinta();
  }
}

async function leerSesion(isoTxt) {
  if (MODO_LOCAL || !E.cfg.token) return null;
  const r = await fetch(api(`sesiones/${isoTxt}.json`) + "?ref=main&t=" + Date.now(), { headers: cab(false), cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} al leer la sesión.`);
  const j = await r.json();
  return { json: JSON.parse(deb64(j.content)), sha: j.sha };
}

async function escribirSesion(isoTxt, obj, mensaje) {
  const texto = JSON.stringify(obj, null, 1) + "\n";
  if (MODO_LOCAL) { console.log("MODO PRUEBA, no se sube:", isoTxt, obj); return "local"; }
  for (let intento = 0; intento < 2; intento++) {
    const previa = await leerSesion(isoTxt);
    const cuerpo = { message: mensaje, content: b64(texto), branch: "main" };
    if (previa) cuerpo.sha = previa.sha;
    const r = await fetch(api(`sesiones/${isoTxt}.json`), { method: "PUT", headers: cab(false), body: JSON.stringify(cuerpo) });
    if (r.ok) return "ok";
    if (r.status === 409 || r.status === 422) continue;
    if (r.status === 403 || r.status === 401) throw new Error("La llave no tiene permiso para escribir. Revisa en Ajustes que tenga «Contents: Read and write».");
    throw new Error(`GitHub respondió ${r.status} al guardar.`);
  }
  throw new Error("No he podido guardar: el archivo cambió a la vez. Prueba otra vez.");
}

/* convierte una sesión guardada al formato de datos.json y la mete en el estado */
function fusionaLocal(ses) {
  if (!E.datos) return;
  const sit = situar(ses.fecha); if (!sit) return;
  const dia = ses.dia || sit.dia;
  const reg = { archivo: ses.fecha + ".json", fecha: ses.fecha, meso: sit.meso.id, semana: sit.semana, dia,
    cancelada: !!ses.cancelada, motivo: ses.motivo || "", ejercicios: (ses.ejercicios || []).map((e) => {
      const r = { ...e, nombre: e.ejercicio }; delete r.ejercicio; return r; }), tests: ses.tests || {}, local: true };
  E.datos.sesiones = (E.datos.sesiones || []).filter((s) => s.fecha !== ses.fecha).concat([reg]);
}

/* ---------- navegación ---------- */
function irAHoy() {
  const s = situar(hoyIso());
  if (s) E.sel = { meso: s.meso.id, semana: s.semana, dia: s.dia };
  else if (mesos().length) { const m = mesos()[mesos().length - 1]; E.sel = { meso: m.id, semana: 1, dia: "LUNES" }; }
}
const mesoSel = () => mesos().find((m) => m.id === E.sel?.meso) || mesos()[0];

/* ---------- pintado ---------- */
function pinta() {
  document.querySelectorAll(".barra button").forEach((b) => b.classList.toggle("activo", b.dataset.vista === E.vista));
  const p = $("#principal");
  if (E.vista === "ajustes") { p.innerHTML = vAjustes(); return; }
  if (E.error === "falta-llave") { p.innerHTML = vBienvenida(); return; }
  if (!E.datos) { p.innerHTML = E.cargando ? `<p class="texto-suave">Cargando tu plan…</p>` : vError(); return; }
  const errorBanda = E.error ? `<div class="banda roja">${esc(E.error)}</div>` : "";
  const fallos = (E.datos.errores || []).length
    ? `<div class="banda amarilla">Hay sesiones que no se han podido pasar al Excel: ${E.datos.errores.map((x) => esc(x.archivo)).join(", ")}. Díselo a Claude.</div>` : "";
  const html = { plan: vPlan, apuntar: vApuntar, gemelo: vGemelo, tecnica: vTecnica, progreso: vProgreso }[E.vista]();
  p.innerHTML = errorBanda + (E.vista === "plan" ? fallos : "") + html;
}

function vBienvenida() {
  return `<div class="heroe"><div class="etiqueta">Primera vez</div><h1>Conecta la app con tu repositorio</h1>
    <p>Necesita una llave de GitHub para leer tu plan y guardar las sesiones. Solo se pide una vez en este móvil.</p></div>
    <button class="boton" data-accion="vista" data-vista="ajustes">Poner la llave</button>`;
}
function vError() {
  return `<div class="banda roja">${esc(E.error || "No hay datos.")}</div>
    <button class="boton" data-accion="recargar">Reintentar</button>
    <button class="boton sec" data-accion="vista" data-vista="ajustes">Ajustes</button>`;
}

function heroe(m, semana) {
  const i = semana - 1;
  return `<div class="heroe"><div class="etiqueta">${esc(m.id)} · ${esc(m.nombre)} · ${corta(m.inicio)} - ${corta(finMeso(m))}</div>
    <h1>${esc(m.resumen_app || m.nombre)}</h1>
    <p>Gemelo: ${esc(m.gemelo_semana?.[i] || "—")} · ${esc(m.correr_semana?.[i] || "")}</p></div>`;
}

function vPlan() {
  const m = mesoSel(); if (!m) return `<p class="texto-suave">No hay mesociclos en el programa.</p>`;
  const { semana, dia } = E.sel;
  const opciones = mesos().map((mm) => Array.from({ length: mm.semanas }, (_, k) =>
    `<option value="${mm.id}|${k + 1}" ${mm.id === m.id && k + 1 === semana ? "selected" : ""}>${mm.id} · Semana ${k + 1}</option>`).join("")).join("");
  const conEj = m.dias.filter((d) => d.ejercicios.length);
  const hechas = conEj.filter((d) => { const s = sesionDia(m, semana, d.dia); return s && !s.cancelada; }).length;
  const chips = DIAS.map((d, k) => {
    const f = fechaDe(m, semana, d); const s = sesionDia(m, semana, d);
    const est = s ? (s.cancelada ? "✕" : "✓") : (f === hoyIso() ? "•" : "");
    return `<button class="dia ${d === dia ? "activo" : ""} ${s && !s.cancelada ? "hecho" : ""} ${s?.cancelada ? "cancelado" : ""}"
      data-accion="dia" data-dia="${d}">${DIAS_CORTO[k]}<b>${fecha(f).getDate()}</b><span class="est">${est}</span></button>`;
  }).join("");
  const dp = diaPrograma(m, dia);
  const f = fechaDe(m, semana, dia);
  const ses = sesionDia(m, semana, dia);
  const titulo = dp.titulo.includes(" · ") ? dp.titulo.split(" · ").slice(1).join(" · ") : dp.titulo;
  let estado = "";
  if (ses?.cancelada) estado = `<div class="banda gris">No entrenado${ses.motivo ? ": " + esc(ses.motivo) : ""}.</div>`;
  else if (ses) estado = `<div class="banda verde">Sesión apuntada${ses.local ? " (pasando al Excel…)" : ""}.</div>`;
  const ejs = dp.ejercicios.map((e) => {
    const obj = m.objetivos[e.tipo]?.[semana - 1] || "";
    const hecho = ses && !ses.cancelada ? ses.ejercicios.find((x) => x.nombre === e.nombre) : null;
    const ult = ultimaVez(e.nombre, f);
    return `<div class="ej ${hecho ? "hecho" : ""}"><div class="icono">${icono(e.bloque)}</div><div>
      <div class="nombre">${esc(bonito(e.nombre))}</div>
      <div class="datos">${e.series ? `<span class="pastilla gris">${e.series} series</span>` : ""}<span class="pastilla gris">${esc(e.rango || "")}</span>
        ${obj ? `<span class="pastilla amarilla">${esc(obj)}</span>` : ""}</div>
      ${e.nota ? `<div class="nota">${esc(e.nota)}</div>` : ""}
      ${hecho ? `<div class="ultima">Hecho: ${esc(resumen(hecho))}</div>` : ult ? `<div class="ultima">Última vez (${corta(ult.fecha)}): ${esc(resumen(ult.e))}</div>` : ""}
    </div></div>`;
  }).join("");
  return heroe(m, semana) + `
    <div class="fila"><div><h2>Tu semana</h2><span class="pastilla">${esc(m.fase_semana?.[semana - 1] || "")}</span></div>
      <select class="selector" data-accion="semana" aria-label="Semana">${opciones}</select></div>
    <div class="meta"><span>${hechas}/${conEj.length} sesiones apuntadas</span><span>Semana ${semana} de ${m.semanas}</span></div>
    <div class="progreso"><div style="width:${conEj.length ? (100 * hechas) / conEj.length : 0}%"></div></div>
    <div class="dias">${chips}</div>
    <div class="tarjeta"><div class="fila"><span class="pastilla">${esc(DIAS_CORTO[DIAS.indexOf(dia)])} ${corta(f)}</span>
      ${f === hoyIso() ? `<span class="pastilla amarilla">Hoy</span>` : ""}</div>
      <h2>${esc(bonito(titulo))}</h2>${estado}
      ${dp.ejercicios.length ? `<div class="subt">Ejercicios · dosis de esta semana</div>${ejs}
        <button class="boton" data-accion="apuntar" data-fecha="${f}">${ses && !ses.cancelada ? "Ver o corregir la sesión" : "Apuntar esta sesión"}</button>
        ${ses ? "" : `<button class="boton sec" data-accion="cancelar" data-fecha="${f}">No entrené este día</button>`}`
        : `<p class="texto-suave">Descanso.</p>`}
    </div>`;
}

/* ---------- apuntar ---------- */
function nuevoApunte(isoTxt) {
  return { fecha: isoTxt, dia: "", ejercicios: {}, marcas: {}, notas: "", sha: null, cancelada: false, motivo: "",
    historial: [], sinAsignar: [], anterior: null, cargada: false };
}
async function abrirApunte(isoTxt) {
  const borrador = lee("borrador:" + isoTxt, null);
  E.apunte = borrador || nuevoApunte(isoTxt);
  E.vista = "apuntar"; pinta();
  if (borrador) { aviso("Recuperado lo que tenías sin guardar."); return; }
  try {
    const previa = await leerSesion(isoTxt);
    const src = previa ? previa.json : (() => {   // sin llave o modo prueba: lo que haya en datos.json
      const s = sesionesDe(isoTxt)[0]; if (!s) return null;
      return { fecha: s.fecha, cancelada: s.cancelada, motivo: s.motivo, ejercicios: s.ejercicios.map((e) => ({ ...e, ejercicio: e.nombre })) };
    })();
    if (src && E.apunte.fecha === isoTxt) {
      const a = E.apunte;
      a.cancelada = !!src.cancelada; a.motivo = src.motivo || ""; a.notas = src.notas || ""; a.dia = src.dia || "";
      a.sha = previa?.sha || null; a.cargada = true; a.original = src;
      for (const e of src.ejercicios || []) {
        const x = { ...e }; delete x.ejercicio; delete x.nombre;
        a.ejercicios[e.ejercicio] = x;
      }
      pinta();
    }
  } catch (e) { aviso(e.message); }
}
function guardaBorrador() { if (E.apunte) guarda("borrador:" + E.apunte.fecha, E.apunte); }
function situarApunte() {
  const a = E.apunte; const sit = situar(a.fecha); if (!sit) return null;
  const dia = a.dia || sit.dia;
  return { ...sit, dia, dp: diaPrograma(sit.meso, dia) };
}
function datosEj(nombre) { const a = E.apunte; if (!a.ejercicios[nombre]) a.ejercicios[nombre] = {}; return a.ejercicios[nombre]; }
function tieneDatos(x) {
  if (!x) return false;
  return (x.series || []).some((s) => s.peso !== undefined || s.reps !== undefined || s.rir !== undefined)
    || ["min", "dist", "gemelo_durante", "gemelo_manana", "notas", "hecho_en_vez"].some((k) => x[k] !== undefined && x[k] !== "")
    || (x.rpe && x.rpe.length);
}
function faltan(ej, x) {
  if (!x || !esFuerza(ej)) return [];
  const f = [];
  (x.series || []).forEach((s, i) => {
    const algo = s.peso !== undefined || s.reps !== undefined || s.rir !== undefined;
    if (!algo) return;
    if (s.peso === undefined) f.push(`${i}|peso`);
    if (s.reps === undefined) f.push(`${i}|reps`);
    if (s.rir === undefined) f.push(`${i}|rir`);
  });
  return f;
}

function vApuntar() {
  const a = E.apunte;
  if (!a) {
    return `<div class="tarjeta"><h2>Apuntar una sesión</h2><p class="texto-suave">Elige el día.</p>
      <input type="date" value="${hoyIso()}" data-accion="fecha-nueva">
      <button class="boton" data-accion="apuntar" data-fecha="${hoyIso()}">Apuntar hoy</button></div>`;
  }
  const sit = situarApunte();
  const cabecera = `<div class="tarjeta"><div class="fila"><input type="date" value="${a.fecha}" data-accion="fecha-apunte" style="max-width:170px">
      ${a.cargada ? `<span class="pastilla">Guardada</span>` : `<span class="pastilla gris">Nueva</span>`}</div>
    ${sit ? `<div class="mini" style="margin-top:6px">${sit.meso.id} · semana ${sit.semana} · ${esc(sit.dp.titulo)}</div>
      <label class="mini" style="display:block;margin-top:6px">¿Hiciste la sesión de otro día?
        <select data-accion="dia-otro"><option value="">No, la que tocaba (${esc(DIAS[(fecha(a.fecha).getDay() + 6) % 7].toLowerCase())})</option>
        ${sit.meso.dias.filter((d) => d.ejercicios.length).map((d) => `<option value="${d.dia}" ${a.dia === d.dia ? "selected" : ""}>${esc(d.titulo)}</option>`).join("")}</select></label>`
      : `<div class="banda roja">Esta fecha no cae en ningún mesociclo del programa.</div>`}</div>`;
  if (!sit) return cabecera;
  if (a.cancelada) {
    return cabecera + `<div class="tarjeta"><div class="banda gris">Marcado como no entrenado${a.motivo ? ": " + esc(a.motivo) : ""}.</div>
      <label class="campo">Motivo<input data-campo="motivo" value="${esc(a.motivo)}"></label>
      <button class="boton" data-accion="guardar">Guardar</button>
      <button class="boton sec" data-accion="descancelar">Al final sí entrené</button></div>`;
  }
  const tarjetas = sit.dp.ejercicios.map((ej) => tarjetaEj(ej, sit)).join("");
  const sinAsig = a.sinAsignar.map((t, k) => `<div class="tarjeta"><div class="banda amarilla">No sé a qué ejercicio va: «${esc(t)}»</div>
      <div class="fila"><select data-sin="${k}">${sit.dp.ejercicios.map((e) => `<option>${esc(e.nombre)}</option>`).join("")}</select>
      <button class="boton peq" data-accion="asignar" data-k="${k}">Asignar</button><button class="enlace" data-accion="descartar" data-k="${k}">Quitar</button></div></div>`).join("");
  return cabecera + sinAsig + tarjetas + `
    <div class="tarjeta"><label class="campo">Nota de la sesión<textarea data-campo="notas" rows="2">${esc(a.notas)}</textarea></label></div>
    <div class="chat">
      ${a.historial.length ? `<div class="historial">${a.historial.slice(-2).map((h) => `<div>«${esc(h)}»</div>`).join("")}</div>` : ""}
      <div class="entrada"><textarea id="dictado" rows="1" placeholder="Dicta el ejercicio: «Prensa, serie 1, 120 kilos, 12 repes, RIR 3…»"></textarea>
        <button class="enviar" data-accion="dictar" aria-label="Rellenar">➤</button></div>
      <div class="pie-chat"><button class="boton" data-accion="guardar">Guardar sesión</button>
        <button class="enlace" data-accion="cancelar-apunte">Hoy no entreno</button></div>
    </div>`;
}

function tarjetaEj(ej, sit) {
  const a = E.apunte; const x = a.ejercicios[ej.nombre]; const n = ej.nombre;
  const faltas = faltan(ej, x);
  const est = faltas.length ? `<span class="estado falta">Falta ${faltas.length} dato${faltas.length > 1 ? "s" : ""}</span>`
    : tieneDatos(x) ? `<span class="estado ok">✓ Apuntado</span>` : `<span class="estado vacio">Sin apuntar</span>`;
  const ult = ultimaVez(n, a.fecha);
  const obj = sit.meso.objetivos[ej.tipo]?.[sit.semana - 1] || "";
  const cls = (clave) => (a.marcas[`${n}|${clave}`] ? "dictado" : "") + (faltas.includes(clave) ? " falta" : "");
  let cuerpo = "";
  if (esFuerza(ej) || (x?.series || []).length) {
    const series = (x?.series && x.series.length) ? x.series : Array.from({ length: ej.series || 1 }, () => ({}));
    cuerpo = `<div class="series"><span class="cab"></span><span class="cab">kg</span><span class="cab">repes</span><span class="cab">RIR</span><span></span>
      ${series.map((s, i) => `<span class="mini">Serie ${i + 1}</span>
        <input inputmode="decimal" class="${cls(i + "|peso")}" data-serie="${i}" data-k="peso" data-ej="${esc(n)}" value="${fmt(s.peso)}" placeholder="${fmt(ult?.e.series?.[i]?.peso)}">
        <input inputmode="numeric" class="${cls(i + "|reps")}" data-serie="${i}" data-k="reps" data-ej="${esc(n)}" value="${fmt(s.reps)}" placeholder="${fmt(ult?.e.series?.[i]?.reps)}">
        <input inputmode="text" class="${cls(i + "|rir")}" data-serie="${i}" data-k="rir" data-ej="${esc(n)}" value="${s.rir === "fallo" ? "F" : fmt(s.rir)}" placeholder="${ult?.e.series?.[i]?.rir === "fallo" ? "F" : fmt(ult?.e.series?.[i]?.rir)}">
        <button class="quitar" data-accion="quitar-serie" data-ej="${esc(n)}" data-i="${i}" aria-label="Quitar serie">×</button>`).join("")}</div>
      <div class="fila" style="margin-top:6px"><button class="enlace" data-accion="mas-serie" data-ej="${esc(n)}">+ serie</button>
        ${ult?.e.series?.length ? `<button class="enlace" data-accion="copiar-ultima" data-ej="${esc(n)}">Igual que la última vez</button>` : ""}</div>`;
  } else if (ej.bloque === "Gemelo") {
    cuerpo = `<div class="rejilla2"><label class="campo">Dolor durante (0-10)<input inputmode="numeric" class="${cls("gemelo_durante")}" data-campo-ej="gemelo_durante" data-ej="${esc(n)}" value="${fmt(x?.gemelo_durante)}"></label>
      <label class="campo">A la mañana siguiente<input inputmode="numeric" class="${cls("gemelo_manana")}" data-campo-ej="gemelo_manana" data-ej="${esc(n)}" value="${fmt(x?.gemelo_manana)}"></label></div>`;
  } else {
    cuerpo = `<div class="rejilla3"><label class="campo">Minutos<input inputmode="decimal" class="${cls("min")}" data-campo-ej="min" data-ej="${esc(n)}" value="${fmt(x?.min)}" placeholder="${fmt(ult?.e.min)}"></label>
      <label class="campo">Dist. / vatios<input class="${cls("dist")}" data-campo-ej="dist" data-ej="${esc(n)}" value="${fmt(x?.dist)}" placeholder="${fmt(ult?.e.dist)}"></label>
      <label class="campo">RPE<input inputmode="numeric" class="${cls("rpe")}" data-campo-ej="rpe" data-ej="${esc(n)}" value="${fmt(x?.rpe?.[0])}"></label></div>`;
  }
  const abierto = x?.notas || x?.hecho_en_vez || ej.bloque === "Gemelo" || ej.bloque === "Movilidad" || ej.bloque === "Core";
  return `<div class="ej" style="display:block"><div class="fila"><span class="nombre">${esc(bonito(n))}</span>${est}</div>
    <div class="mini">${obj ? "Objetivo: " + esc(obj) : ""}${ult ? ` · Última vez: ${esc(resumen(ult.e))}` : ""}</div>
    ${cuerpo}
    <div class="${abierto ? "" : "oculto"}" data-extra="${esc(n)}"><div class="rejilla2">
      <label class="campo">Nota<input class="${cls("notas")}" data-campo-ej="notas" data-ej="${esc(n)}" value="${esc(x?.notas || "")}"></label>
      <label class="campo">Lo cambié por<input data-campo-ej="hecho_en_vez" data-ej="${esc(n)}" value="${esc(x?.hecho_en_vez || "")}"></label></div></div>
    ${abierto ? "" : `<button class="enlace" data-accion="extra" data-ej="${esc(n)}">Nota o cambio de ejercicio</button>`}
  </div>`;
}

function aplicaDictado(texto) {
  const a = E.apunte; const sit = situarApunte(); if (!sit) return;
  const nombres = sit.dp.ejercicios.map((e) => e.nombre);
  const r = Lector.lee(texto, nombres, a.anterior);
  a.historial.push(texto);
  if (r.cancelar) {
    a.cancelada = true; a.motivo = r.motivo || a.motivo;
    aviso("Lo marco como no entrenado. Pulsa Guardar para confirmarlo.");
    return;
  }
  for (const t of r.sinEntender) a.sinAsignar.push(t);
  let rellenados = 0;
  for (const e of r.ejercicios) {
    const x = datosEj(e.ejercicio);
    a.anterior = e.ejercicio;
    if (e.series.length) {
      x.series = (x.series || []).filter((s) => s.peso !== undefined || s.reps !== undefined || s.rir !== undefined);
      for (const s of e.series) {
        const pos = s.n ? s.n - 1 : x.series.length;
        const previa = x.series[pos] || {};
        const nueva = { ...previa };
        for (const k of ["peso", "reps", "rir"]) if (s[k] !== undefined) { nueva[k] = s[k]; a.marcas[`${e.ejercicio}|${pos}|${k}`] = 1; }
        if (nueva.peso === undefined && pos > 0 && x.series[pos - 1]?.peso !== undefined) { nueva.peso = x.series[pos - 1].peso; a.marcas[`${e.ejercicio}|${pos}|peso`] = 1; }
        while (x.series.length < pos) x.series.push({});
        x.series[pos] = nueva;
      }
    }
    for (const k of ["min", "dist", "gemelo_durante", "gemelo_manana", "notas"]) {
      if (e[k] !== undefined) { x[k] = e[k]; a.marcas[`${e.ejercicio}|${k}`] = 1; }
    }
    if (e.rpe) { x.rpe = e.rpe; a.marcas[`${e.ejercicio}|rpe`] = 1; }
    rellenados++;
  }
  if (rellenados) aviso(`Rellenado: ${r.ejercicios.map((e) => bonito(e.ejercicio)).join(", ")}. Revísalo en amarillo.`);
  else if (r.sinEntender.length) aviso("No he entendido a qué ejercicio va. Elígelo arriba.");
}

function construyeSesion() {
  const a = E.apunte;
  if (a.cancelada) return { fecha: a.fecha, cancelada: true, motivo: a.motivo || "", fuente: "app" };
  const sit = situarApunte();
  const ejercicios = [];
  for (const ej of sit.dp.ejercicios) {
    const x = a.ejercicios[ej.nombre]; if (!tieneDatos(x)) continue;
    const out = { ejercicio: ej.nombre };
    const series = (x.series || []).filter((s) => s.peso !== undefined || s.reps !== undefined || s.rir !== undefined)
      .map((s) => { const o = {}; for (const k of ["peso", "reps", "rir"]) if (s[k] !== undefined) o[k] = s[k]; return o; });
    if (series.length) out.series = series;
    for (const k of ["min", "dist", "gemelo_durante", "gemelo_manana", "notas", "hecho_en_vez"]) if (x[k] !== undefined && x[k] !== "") out[k] = x[k];
    if (x.rpe && x.rpe.length) out.rpe = x.rpe;
    ejercicios.push(out);
  }
  const s = { fecha: a.fecha };
  if (a.dia) s.dia = a.dia;
  s.ejercicios = ejercicios;
  if (a.notas) s.notas = a.notas;
  if (a.original?.tests) s.tests = a.original.tests;
  if (a.historial.length) s.dictado = a.historial.join("\n");
  s.fuente = "app";
  return s;
}

async function guardarApunte() {
  const a = E.apunte; const s = construyeSesion();
  if (!s.cancelada && !s.ejercicios.length) { aviso("No hay nada apuntado todavía."); return; }
  const faltasTot = s.cancelada ? 0 : situarApunte().dp.ejercicios.reduce((n, ej) => n + faltan(ej, a.ejercicios[ej.nombre]).length, 0);
  if (faltasTot && !confirm(`Faltan ${faltasTot} datos (en rojo). ¿Guardar igualmente?`)) return;
  try {
    aviso("Guardando…", 8000);
    const r = await escribirSesion(a.fecha, s, `Sesión ${a.fecha} (app)`);
    borra("borrador:" + a.fecha);
    const pend = lee("pendientes", []).filter((p) => p.fecha !== a.fecha);
    pend.push({ ...s, _guardado: new Date().toISOString() }); guarda("pendientes", pend);
    fusionaLocal(s);
    a.cargada = true; a.marcas = {};
    aviso(r === "local" ? "Modo prueba: no se ha subido nada." : "Guardado. El Excel se actualiza en un minuto.", 3500);
    pinta();
  } catch (e) { aviso(e.message, 6000); }
}

/* ---------- gemelo, técnica, progreso, ajustes ---------- */
function vGemelo() {
  const m = mesoSel(); const sem = E.sel?.semana || 1;
  const secciones = {}; let actual = null;
  for (const p of E.datos.portada || []) {
    if (p.tipo === "seccion") { actual = p.titulo; secciones[actual] = []; } else if (actual) secciones[actual].push(p);
  }
  const bloque = (clave) => { const k = Object.keys(secciones).find((s) => s.startsWith(clave)); if (!k) return "";
    return `<div class="tarjeta"><h3>${esc(bonito(k.split(" · ")[0].split(" (")[0]))}</h3><table class="tabla">${secciones[k].map((p) =>
      `<tr><td style="width:34%"><b>${esc(p.titulo)}</b></td><td>${esc(p.texto)}</td></tr>`).join("")}</table></div>`; };
  const etiquetaActual = `${m.id} · `;
  const cal = (E.datos.calendario || []).map((c) => {
    const esAct = c.meso.startsWith(m.id) && (c.semana === String(sem) || c.semana.includes("-") && m.id !== "M1");
    return `<tr class="${esAct ? "actual" : ""}"><td>${esc(c.meso.split(" · ")[0])} s${esc(c.semana)}<div class="mini">${esc(c.fechas)}</div></td>
      <td>${esc(c.gemelo)}</td><td>${esc(c.correr)}</td><td class="mini">${esc(c.avanzar)}</td></tr>`; }).join("");
  const conDolor = (E.datos.sesiones || []).filter((s) => !s.cancelada).map((s) => {
    const g = s.ejercicios.find((e) => e.gemelo_durante !== undefined || e.gemelo_manana !== undefined);
    return g ? { f: s.fecha, d: g.gemelo_durante, m: g.gemelo_manana } : null; }).filter(Boolean).sort((a, b) => (a.f < b.f ? -1 : 1)).slice(-21);
  const graf = conDolor.length ? (() => {
    const w = 320, h = 120, paso = w / Math.max(conDolor.length, 1);
    const barras = conDolor.map((p, i) => {
      const x = i * paso + paso * 0.2, bw = paso * 0.6;
      const d = p.d !== undefined ? `<rect x="${x}" y="${h - 18 - (p.d / 10) * (h - 30)}" width="${bw}" height="${(p.d / 10) * (h - 30)}" rx="3" fill="${p.d > 3 ? "#B42318" : "#1F8A6B"}"/>` : "";
      const mm = p.m !== undefined ? `<circle cx="${x + bw / 2}" cy="${h - 18 - (p.m / 10) * (h - 30)}" r="3.5" fill="#0B3B35"/>` : "";
      return d + mm + `<text x="${x + bw / 2}" y="${h - 4}" text-anchor="middle">${fecha(p.f).getDate()}</text>`;
    }).join("");
    const linea3 = h - 18 - 0.3 * (h - 30);
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Dolor del gemelo por sesión">
      <line x1="0" x2="${w}" y1="${linea3}" y2="${linea3}" stroke="#E0A800" stroke-dasharray="4 4"/><text x="${w - 2}" y="${linea3 - 3}" text-anchor="end">3</text>${barras}</svg>
      <div class="mini">Barra: dolor durante (rojo si pasa de 3). Punto: a la mañana siguiente.</div>`;
  })() : `<p class="texto-suave">Todavía no hay dolor apuntado.</p>`;
  return heroe(m, sem) + `<div class="tarjeta"><h3>Dolor del gemelo</h3>${graf}</div>
    ${bloque("REGLA DEL DOLOR")}${bloque("PROTOCOLO DEL GEMELO")}
    <div class="tarjeta"><h3>Calendario previsto</h3><p class="mini">Las fechas son previsión: manda el criterio de la última columna.</p>
      <table class="tabla"><tr><th>Semana</th><th>Gemelo</th><th>Correr</th><th>Para avanzar</th></tr>${cal}</table></div>
    ${bloque("CORRER")}`;
}

function vTecnica() {
  const t = E.datos.tecnica || [];
  return `<div class="tarjeta"><div class="subt" style="margin-top:0">Biblioteca de técnica</div><h2>Una idea clara por estación</h2>
    <p class="texto-suave">Los vídeos se abren en YouTube. Para añadir uno, pásale el enlace a Claude.</p></div>` +
    t.map((e, i) => `<div class="tarjeta"><div class="fila"><span class="mini">${String(i + 1).padStart(2, "0")}</span><span class="pastilla">${esc(e.distancia)}</span></div>
      <h3 style="margin-top:4px">${esc(e.nombre)}</h3><p class="texto-suave" style="margin:0 0 8px">${esc(e.claves)}</p>
      ${e.video ? `<a class="boton peq" href="${esc(e.video)}" target="_blank" rel="noopener">▶ Ver demostración</a>` : `<span class="pastilla gris">Vídeo pendiente</span>`}
      ${e.guia ? ` <a class="boton peq sec" href="${esc(e.guia)}" target="_blank" rel="noopener">Guía visual</a>` : ""}</div>`).join("");
}

function vProgreso() {
  const ses = (E.datos.sesiones || []).filter((s) => !s.cancelada).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const tests = mesos().map((m) => {
    const filas = m.tests.map((t) => {
      const vals = ses.filter((s) => s.meso === m.id && s.tests && s.tests[t.nombre] !== undefined).map((s) => `${corta(s.fecha)}: <b>${esc(s.tests[t.nombre])}</b>`);
      return `<tr><td>${esc(t.nombre)}<div class="mini">${esc(t.unidad)} · meta ${esc(t.meta)}</div></td><td>${vals.join("<br>") || `<span class="mini">—</span>`}</td></tr>`;
    }).join("");
    return `<div class="tarjeta"><h3>Tests de ${esc(m.id)}</h3><table class="tabla">${filas}</table></div>`;
  }).join("");
  const nombres = [...new Set(ses.flatMap((s) => s.ejercicios.filter((e) => e.series?.length).map((e) => e.nombre)))].sort();
  if (!E.ejProgreso || !nombres.includes(E.ejProgreso)) E.ejProgreso = nombres[0] || "";
  let evol = `<p class="texto-suave">Cuando apuntes sesiones de fuerza, aquí verás cómo sube cada ejercicio.</p>`;
  if (E.ejProgreso) {
    const puntos = ses.map((s) => ({ f: s.fecha, e: s.ejercicios.find((e) => e.nombre === E.ejProgreso) })).filter((p) => p.e);
    const max = (e) => Math.max(...e.series.map((s) => (typeof s.peso === "number" ? s.peso : 0)));
    const ps = puntos.map((p) => max(p.e)); const top = Math.max(...ps, 1), bajo = Math.min(...ps);
    const w = 320, h = 110;
    const xy = ps.map((v, i) => [ps.length === 1 ? w / 2 : 16 + (i * (w - 32)) / (ps.length - 1), h - 20 - ((v - bajo) / Math.max(top - bajo, 1)) * (h - 40)]);
    const svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Peso máximo por sesión">
      <polyline points="${xy.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#0F5A4E" stroke-width="2"/>
      ${xy.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#0F5A4E"/><text x="${p[0]}" y="${p[1] - 7}" text-anchor="middle">${fmt(ps[i])}</text>`).join("")}</svg>`;
    evol = `<select class="selector" data-accion="ej-progreso" style="width:100%">${nombres.map((n) => `<option ${n === E.ejProgreso ? "selected" : ""} value="${esc(n)}">${esc(bonito(n))}</option>`).join("")}</select>
      ${svg}<table class="tabla">${puntos.slice().reverse().map((p) => `<tr><td style="width:64px">${corta(p.f)}</td><td>${esc(resumen(p.e))}</td></tr>`).join("")}</table>`;
  }
  return `<div class="tarjeta"><h3>Evolución por ejercicio</h3><p class="mini">Peso más alto de cada sesión.</p>${evol}</div>` + tests;
}

function vAjustes() {
  const c = E.cfg;
  return `<div class="tarjeta"><h2>Ajustes</h2>
    <p class="texto-suave">La llave de GitHub se guarda solo en este móvil. Debe poder leer y escribir únicamente el repositorio del entrenamiento.</p>
    <label class="campo">Llave de GitHub<input type="password" id="cfg-token" value="${esc(c.token)}" autocomplete="off" placeholder="github_pat_…"></label>
    <div class="rejilla2"><label class="campo">Cuenta<input id="cfg-owner" value="${esc(c.owner)}"></label>
      <label class="campo">Repositorio<input id="cfg-repo" value="${esc(c.repo)}"></label></div>
    <button class="boton" data-accion="guardar-cfg">Guardar y probar</button>
    <button class="boton sec" data-accion="borrar-llave">Borrar la llave de este móvil</button>
    <div class="mini" style="margin-top:10px">${E.datos ? `Datos generados: ${esc(new Date(E.datos.generado).toLocaleString("es-ES"))}` : ""}</div></div>
    <div class="tarjeta"><h3>Cómo crear la llave</h3><ol class="texto-suave" style="padding-left:18px;margin:0">
      <li>En GitHub: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Settings → Developer settings → Fine-grained tokens → Generate new token</a>.</li>
      <li>Repository access: <b>Only select repositories</b> → entrenamiento-hyrox.</li>
      <li>Permissions → Repository permissions → <b>Contents: Read and write</b>. Nada más.</li>
      <li>Generar, copiarla y pegarla aquí arriba.</li></ol></div>
    <button class="boton sec" data-accion="vista" data-vista="plan">Volver</button>`;
}

/* ---------- eventos ---------- */
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-accion]"); if (!b || b.tagName === "SELECT" || b.tagName === "INPUT") return;
  const acc = b.dataset.accion;
  if (acc === "vista") { E.vista = b.dataset.vista; if (E.vista === "apuntar" && !E.apunte && E.datos) await abrirApunte(hoyIso()); pinta(); window.scrollTo(0, 0); }
  else if (acc === "recargar") { await cargarDatos(); aviso("Datos actualizados."); }
  else if (acc === "dia") { E.sel.dia = b.dataset.dia; pinta(); }
  else if (acc === "apuntar") { await abrirApunte(b.dataset.fecha); window.scrollTo(0, 0); }
  else if (acc === "cancelar") {
    const motivo = prompt("¿Por qué no entrenaste? (opcional)", "");
    if (motivo === null) return;
    E.apunte = nuevoApunte(b.dataset.fecha); E.apunte.cancelada = true; E.apunte.motivo = motivo;
    await guardarApunte(); E.vista = "plan"; pinta();
  }
  else if (acc === "cancelar-apunte") { E.apunte.cancelada = true; guardaBorrador(); pinta(); }
  else if (acc === "descancelar") { E.apunte.cancelada = false; E.apunte.motivo = ""; guardaBorrador(); pinta(); }
  else if (acc === "dictar") {
    const t = $("#dictado").value.trim(); if (!t) { aviso("Escribe o dicta algo primero."); return; }
    aplicaDictado(t); guardaBorrador(); pinta();
    const d = $("#dictado"); if (d) d.focus();
  }
  else if (acc === "guardar") { await guardarApunte(); }
  else if (acc === "mas-serie") { const x = datosEj(b.dataset.ej); x.series = x.series && x.series.length ? x.series : [{}]; x.series.push({}); guardaBorrador(); pinta(); }
  else if (acc === "quitar-serie") { const x = datosEj(b.dataset.ej); if (x.series) x.series.splice(+b.dataset.i, 1); guardaBorrador(); pinta(); }
  else if (acc === "copiar-ultima") {
    const u = ultimaVez(b.dataset.ej, E.apunte.fecha); if (!u) return;
    const x = datosEj(b.dataset.ej); x.series = u.e.series.map((s) => ({ ...s }));
    x.series.forEach((s, i) => ["peso", "reps", "rir"].forEach((k) => (E.apunte.marcas[`${b.dataset.ej}|${i}|${k}`] = 1)));
    guardaBorrador(); pinta();
  }
  else if (acc === "extra") { const d = document.querySelector(`[data-extra="${CSS.escape(b.dataset.ej)}"]`); if (d) d.classList.remove("oculto"); b.remove(); }
  else if (acc === "asignar") {
    const k = +b.dataset.k; const sel = document.querySelector(`[data-sin="${k}"]`);
    const texto = E.apunte.sinAsignar[k]; E.apunte.sinAsignar.splice(k, 1);
    aplicaDictado(sel.value + ": " + texto.replace(/^[^:\d]*?(?=\d|serie|:)/, "")); E.apunte.historial.pop(); guardaBorrador(); pinta();
  }
  else if (acc === "descartar") { E.apunte.sinAsignar.splice(+b.dataset.k, 1); guardaBorrador(); pinta(); }
  else if (acc === "guardar-cfg") {
    E.cfg = { token: $("#cfg-token").value.trim(), owner: $("#cfg-owner").value.trim(), repo: $("#cfg-repo").value.trim() };
    guarda("cfg", E.cfg); E.vista = "plan"; await cargarDatos();
    if (!E.error) aviso("Conectado. Ya tienes tu plan.");
  }
  else if (acc === "borrar-llave") { E.cfg.token = ""; guarda("cfg", E.cfg); borra("datos_cache"); E.datos = null; E.error = "falta-llave"; aviso("Llave borrada de este móvil."); pinta(); }
});

document.addEventListener("change", async (ev) => {
  const t = ev.target; const acc = t.dataset.accion;
  if (acc === "semana") { const [m, s] = t.value.split("|"); E.sel = { meso: m, semana: +s, dia: E.sel.dia }; pinta(); }
  else if (acc === "fecha-apunte" || acc === "fecha-nueva") { if (t.value) await abrirApunte(t.value); }
  else if (acc === "dia-otro") { E.apunte.dia = t.value; guardaBorrador(); pinta(); }
  else if (acc === "ej-progreso") { E.ejProgreso = t.value; pinta(); }
});

document.addEventListener("input", (ev) => {
  const t = ev.target; const a = E.apunte; if (!a) return;
  if (t.dataset.serie !== undefined) {
    const x = datosEj(t.dataset.ej); const i = +t.dataset.serie;
    x.series = x.series && x.series.length ? x.series : [];
    while (x.series.length <= i) x.series.push({});
    const v = num(t.value); if (v === undefined) delete x.series[i][t.dataset.k]; else x.series[i][t.dataset.k] = v;
    delete a.marcas[`${t.dataset.ej}|${i}|${t.dataset.k}`]; t.classList.remove("dictado", "falta");
  } else if (t.dataset.campoEj) {
    const x = datosEj(t.dataset.ej); const k = t.dataset.campoEj;
    let v = ["notas", "hecho_en_vez", "dist"].includes(k) ? t.value : num(t.value);
    if (k === "rpe") v = v === undefined ? undefined : [v];
    if (v === undefined || v === "") delete x[k]; else x[k] = v;
    delete a.marcas[`${t.dataset.ej}|${k}`]; t.classList.remove("dictado");
  } else if (t.dataset.campo) {
    a[t.dataset.campo] = t.value;
  } else return;
  guardaBorrador();
});

/* el dictado con Intro también rellena */
document.addEventListener("keydown", (ev) => {
  if (ev.target.id === "dictado" && ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); $('[data-accion="dictar"]').click(); }
});

/* ---------- arranque ---------- */
if (E.datos && !E.sel) irAHoy();
pinta();
cargarDatos();
