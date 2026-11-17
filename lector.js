/* Lector del dictado: convierte lo que Alex dicta en series para los ejercicios del día.
   Sin IA: reglas fijas pensadas para su forma de dictar. Funciona en el navegador y en Node (pruebas). */
(function (raiz) {
  const NUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
    dieciocho: 18, diecinueve: 19, veinte: 20, cero: 0 };

  function norm(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/·/g, " ").replace(/\s+/g, " ").trim();
  }

  function prepara(texto) {
    let t = norm(texto)
      .replace(/(\d),(\d)/g, "$1.$2")                 // 17,5 -> 17.5
      .replace(/(\d+)\s+y\s+medio/g, (_, n) => String(+n + 0.5))
      .replace(/\bmultipower\b/g, "mp")
      .replace(/[—–]/g, " ");
    t = t.replace(/\b([a-z]+)\b/g, (p) => (p in NUM ? String(NUM[p]) : p));
    return t;
  }

  function nombreNorm(n) {
    return norm(n).replace(/\bmultipower\b/g, "mp").replace(/[()\-:,]/g, " ").replace(/\s+/g, " ").trim();
  }

  /* candidatos: lista de nombres del día. Devuelve el nombre o null (no encaja o hay empate). */
  function emparejar(nombre, candidatos) {
    const n = nombreNorm(nombre);
    if (!n) return null;
    const res = candidatos.map((c) => {
      const t = nombreNorm(c);
      const pal = n.split(" ").filter((w) => w.length > 3 && t.split(" ").includes(w));
      return { c, igual: n === t, sub: t.includes(n) || n.includes(t), comunes: pal.length };
    });
    const igual = res.find((r) => r.igual);
    if (igual) return igual.c;
    const sub = res.filter((r) => r.sub);
    if (sub.length === 1) return sub[0].c;
    if (sub.length > 1) {
      sub.sort((a, b) => b.comunes - a.comunes);
      return sub[0].comunes > sub[1].comunes ? sub[0].c : null;
    }
    const com = res.filter((r) => r.comunes > 0).sort((a, b) => b.comunes - a.comunes);
    if (com.length === 1 || (com.length > 1 && com[0].comunes > com[1].comunes)) return com[0].c;
    return null;
  }

  function numero(re, t) {
    const m = t.match(re);
    return m ? parseFloat(m[1]) : null;
  }

  function leeSerie(t) {
    const s = {};
    const peso = numero(/(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilos?|k)\b/, t);
    const reps = numero(/(\d+)\s*(?:rep\w*|veces)\b/, t) ?? numero(/\b(?:rep\w*)\s*(\d+)/, t);
    const rir = numero(/\brir\s*(\d+)/, t);
    if (peso !== null) s.peso = peso;
    if (reps !== null) s.reps = reps;
    if (rir !== null) s.rir = rir;
    if (/\bfallo\b/.test(t)) s.rir = "fallo";
    return s;
  }

  function leeExtras(t, r) {
    const min = numero(/(\d+(?:\.\d+)?)\s*(?:min|minutos?)\b/, t);
    const rpe = numero(/\brpe\s*(\d+)/, t);
    const dolor = numero(/\bdolor\s*(?:de\s*)?(\d+)/, t);
    const manana = numero(/\b(?:manana|al levantarme)\D{0,15}(\d+)/, t);
    const km = numero(/(\d+(?:\.\d+)?)\s*(?:km|kilometros?)\b/, t);
    const metros = numero(/(\d+)\s*(?:m|metros)\b/, t);
    const vatios = numero(/(\d+)\s*(?:w|vatios)\b/, t);
    if (min !== null) r.min = min;
    if (rpe !== null) r.rpe = [rpe];
    if (dolor !== null) r.gemelo_durante = dolor;
    if (manana !== null) r.gemelo_manana = manana;
    if (km !== null) r.dist = km + " km";
    else if (metros !== null) r.dist = metros + " m";
    else if (vatios !== null) r.dist = vatios + " W";
  }

  const CANCELA = /\b(no (he )?entren\w*|cancel\w*|hoy no (entreno|voy)|no (voy|fui) al gimnasio|descanso total)\b/;

  /* texto: lo dictado. candidatos: nombres de ejercicios del día. anterior: último ejercicio dictado (para «serie 3…»).
     Devuelve { cancelar, motivo, ejercicios: [{ejercicio, series, min, ..., faltan:[], inferido:[]}], sinEntender: [] } */
  function lee(texto, candidatos, anterior) {
    const out = { cancelar: false, motivo: "", ejercicios: [], sinEntender: [] };
    const bruto = norm(texto);
    if (CANCELA.test(bruto)) {
      out.cancelar = true;
      const m = String(texto).match(/(?:porque|por)\s+(.+)$/i);
      out.motivo = m ? m[1].trim() : "";
      return out;
    }
    const t = prepara(texto);
    const trozos = t.split(/\n+|\.(?!\d)/).map((x) => x.trim()).filter(Boolean);
    let actual = anterior || null;
    for (const trozo of trozos) {
      const corte = trozo.search(/:|\b(?:series?|dolor|rpe|rir|fallo)\b|\d/);
      let nombre = (corte === -1 ? trozo : trozo.slice(0, corte)).replace(/[,;]+$/, "").trim();
      const datos = corte === -1 ? "" : trozo.slice(corte);
      let ej = null;
      if (nombre) {
        ej = emparejar(nombre, candidatos);
        if (!ej) { out.sinEntender.push(trozo); continue; }
        actual = ej;
      } else if (actual) {
        ej = actual;
      } else { out.sinEntender.push(trozo); continue; }

      const r = { ejercicio: ej, series: [], faltan: [], inferido: [] };
      let partes = [];
      const multi = datos.match(/(\d+)\s*series?\s*de\s*(\d+)\s*(?:rep\w*)?(.*)$/);
      const enSegundos = multi && /\bseg\w*\b/.test(multi[3] || "");
      if (/\bserie\s*\d*/.test(datos) && !multi) {
        const nums = [...datos.matchAll(/\bserie\s*(\d*)/g)].map((m) => (m[1] ? +m[1] : null));
        partes = datos.split(/\bserie\s*\d*\s*:?/).slice(1).map((x, i) => ({ texto: x, n: nums[i] }));
      } else if (enSegundos) {
        partes = [];
      } else if (multi) {
        const base = leeSerie(multi[3] || "");
        for (let i = 0; i < +multi[1]; i++) partes.push({ ...base, reps: +multi[2] });
      } else if (datos) {
        partes = [datos];
      }
      for (const p of partes) {
        let s;
        if (typeof p === "string") s = leeSerie(p);
        else if (p.texto !== undefined) { s = leeSerie(p.texto); if (p.n) s.n = p.n; }
        else s = p;
        if (Object.keys(s).filter((k) => k !== "n").length) r.series.push(s);
      }
      leeExtras(datos.replace(/\bserie\s*\d+/g, ""), r);
      const esFuerza = r.series.length > 0;
      r.series.forEach((s, i) => {
        if (s.peso === undefined && i > 0 && r.series[i - 1].peso !== undefined) {
          s.peso = r.series[i - 1].peso; r.inferido.push(`serie ${i + 1}: peso`);
        }
        const n = s.n || i + 1;
        if (s.peso === undefined) r.faltan.push(`serie ${n}: kilos`);
        if (s.reps === undefined) r.faltan.push(`serie ${n}: repes`);
        if (s.rir === undefined) r.faltan.push(`serie ${n}: RIR`);
      });
      if (!esFuerza && r.min === undefined && r.dist === undefined) {
        const resto = trozo.replace(/\bdolor\s*(?:de\s*)?\d+/g, "").replace(/\brpe\s*\d+/g, "")
          .replace(/^[\s,;:]+|[\s,;:]+$/g, "");
        if (datos.replace(/\bdolor\s*(?:de\s*)?\d+/g, "").trim().replace(/^[\s,;:]+|[\s,;:]+$/g, "")) r.notas = resto;
      }
      out.ejercicios.push(r);
    }
    return out;
  }

  const api = { lee, emparejar, norm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.Lector = api;
})(typeof window !== "undefined" ? window : globalThis);
