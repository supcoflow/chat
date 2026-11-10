import { describe, expect, it } from "vitest";
import { agruparMensajes, alEnviar, alNuevaConversacion, alReintentar, alResponder, alTerminarStream, estadoInicial, mostrarIndicador, mostrarInicio, reducir, reintentarSirve, textoDelError, type EstadoDelChat } from "./estado";
import type { EventoDelWidget } from "./protocolo";

const aplicar = (e: EstadoDelChat, ...evs: EventoDelWidget[]): EstadoDelChat => evs.reduce(reducir, e);
const textos = (e: EstadoDelChat) => e.mensajes.map((m) => (m.rol === "desenlace" ? `desenlace:${m.desenlace.que}` : `${m.rol}:${m.texto}${m.abierto ? "…" : ""}`));

describe("un turno completo", () => {
  it("alEnviar pone el mensaje optimista y ocupa; usuario lo confirma; texto acumula; asistente cierra; espera libera y guarda el cursor", () => {
    let e = alEnviar(estadoInicial(null), "hola");
    expect(e.ocupado).toBe(true);
    expect(textos(e)).toEqual(["usuario:hola…"]);
    e = aplicar(e,
      { v: 1, t: "sesion", id: "s1", indice: 0 },
      { v: 1, t: "usuario", texto: "hola" },
      { v: 1, t: "texto", delta: "Ho" },
      { v: 1, t: "texto", delta: "la." },
    );
    expect(textos(e)).toEqual(["usuario:hola", "asistente:Hola.…"]);
    e = aplicar(e, { v: 1, t: "asistente", texto: "Hola." }, { v: 1, t: "espera", indice: 6 });
    expect(textos(e)).toEqual(["usuario:hola", "asistente:Hola."]);
    expect(e.ocupado).toBe(false);
    expect(e.cursor).toEqual({ id: "s1", indice: 6 });
  });
  it("al recuperar (sin optimista) el usuario del stream se dibuja tal cual", () => {
    const e = aplicar(estadoInicial({ id: "s1", indice: 6 }), { v: 1, t: "usuario", texto: "hola" }, { v: 1, t: "asistente", texto: "Hola." }, { v: 1, t: "espera", indice: 6 });
    expect(textos(e)).toEqual(["usuario:hola", "asistente:Hola."]);
    expect(e.cursor).toEqual({ id: "s1", indice: 6 });
  });
  it("un mensaje de asistente cerrado por tool-calls y otro después son dos burbujas", () => {
    const e = aplicar(estadoInicial(null), { v: 1, t: "asistente", texto: "Déjame ver." }, { v: 1, t: "texto", delta: "Listo" });
    expect(textos(e)).toEqual(["asistente:Déjame ver.", "asistente:Listo…"]);
  });
});

describe("la copia de la confirmación del reporte (T6)", () => {
  it("el mensaje del asistente que sale de una `tool-approval` queda marcado como copia del reporte; el de una pregunta común, no", () => {
    const confirmacion: EventoDelWidget = { v: 1, t: "pregunta", requestId: "r1", kind: "tool-approval", prompt: "Esto es lo que mando", libre: false, opciones: [] };
    const comun: EventoDelWidget = { v: 1, t: "pregunta", requestId: "r2", kind: "question", prompt: "¿Qué navegador?", libre: true, opciones: [] };
    const copia = (e: EstadoDelChat) => e.mensajes.flatMap((m) => (m.rol === "asistente" ? [m.copiaDelReporte === true] : []));
    expect(copia(aplicar(estadoInicial(null), confirmacion))).toEqual([true]);
    expect(copia(aplicar(estadoInicial(null), comun))).toEqual([false]);
    // Contestada sigue marcada: el widget la dibuja como texto plano también entonces.
    expect(copia(aplicar(estadoInicial(null), confirmacion, { v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "approved", optionId: "approve" }, { v: 1, t: "asistente", texto: "Listo." }))).toEqual([true, false]);
  });
});

describe("la pregunta con botones", () => {
  const pregunta: EventoDelWidget = { v: 1, t: "pregunta", requestId: "r1", kind: "question", prompt: "¿Confirmás?", libre: false, opciones: [{ id: "si", label: "Sí, reportar", style: "primary" }, { id: "no", label: "No, quiero corregir algo", style: "default" }] };
  it("el prompt es un mensaje del asistente y los botones quedan pendientes", () => {
    const e = aplicar(estadoInicial(null), pregunta, { v: 1, t: "espera", indice: 3 });
    expect(textos(e)).toEqual(["asistente:¿Confirmás?"]);
    expect(e.pregunta).toEqual({ requestId: "r1", kind: "question", opciones: pregunta.opciones, libre: false });
  });
  it("pregunta_resuelta saca los botones y dibuja la etiqueta elegida como turno del usuario — también al recuperar", () => {
    const e = aplicar(estadoInicial(null), pregunta, { v: 1, t: "espera", indice: 3 }, { v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "answered", optionId: "si" });
    expect(e.pregunta).toBeNull();
    expect(textos(e)).toEqual(["asistente:¿Confirmás?", "usuario:Sí, reportar"]);
  });
  it("con texto libre dibuja el texto; ignorada o inválida, sólo saca los botones", () => {
    expect(textos(aplicar(estadoInicial(null), pregunta, { v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "answered", text: "otra cosa" }))).toEqual(["asistente:¿Confirmás?", "usuario:otra cosa"]);
    const e = aplicar(estadoInicial(null), pregunta, { v: 1, t: "pregunta_resuelta", requestId: "r1", outcome: "ignored" });
    expect(e.pregunta).toBeNull();
    expect(textos(e)).toEqual(["asistente:¿Confirmás?"]);
  });
  it("alResponder ocupa sin agregar mensaje: la etiqueta llega por pregunta_resuelta", () => {
    const e = alResponder(aplicar(estadoInicial(null), pregunta, { v: 1, t: "espera", indice: 3 }));
    expect(e.ocupado).toBe(true);
    expect(textos(e)).toEqual(["asistente:¿Confirmás?"]);
  });
});

describe("errores y fin", () => {
  it("un error no terminal se muestra y conserva todo (§2.4); alReintentar lo limpia", () => {
    let e = alEnviar(estadoInicial({ id: "s1", indice: 6 }), "otra");
    e = reducir(e, { v: 1, t: "error", codigo: "model_error", mensaje: "x", terminal: false });
    expect(e.error).toEqual({ codigo: "model_error", mensaje: "x", terminal: false });
    expect(e.cursor).toEqual({ id: "s1", indice: 6 });
    expect(textos(e)).toEqual(["usuario:otra…"]);
    e = alReintentar(e);
    expect(e.error).toBeNull();
    expect(e.ocupado).toBe(true);
  });
  it("un error terminal borra el cursor y libera: el próximo mensaje abre una sesión nueva", () => {
    const e = reducir(alEnviar(estadoInicial({ id: "s1", indice: 6 }), "x"), { v: 1, t: "error", codigo: "sesion_vencida", mensaje: "", terminal: true });
    expect(e.cursor).toBeNull();
    expect(e.ocupado).toBe(false);
  });
  it("fin libera y borra el cursor", () => {
    const e = reducir(alEnviar(estadoInicial({ id: "s1", indice: 6 }), "x"), { v: 1, t: "fin" });
    expect(e.cursor).toBeNull();
    expect(e.ocupado).toBe(false);
  });
  it("espera después de un error terminal no resucita el cursor", () => {
    const e = aplicar(estadoInicial({ id: "s1", indice: 6 }), { v: 1, t: "error", codigo: "limite_de_sesion", mensaje: "", terminal: true }, { v: 1, t: "espera", indice: 9 });
    expect(e.cursor).toBeNull();
  });
  it("alTerminarStream libera y cierra lo abierto: el cuerpo HTTP terminó, con o sin borde", () => {
    const e = alTerminarStream(aplicar(alEnviar(estadoInicial(null), "a"), { v: 1, t: "texto", delta: "b" }));
    expect(e.ocupado).toBe(false);
    expect(textos(e)).toEqual(["usuario:a", "asistente:b"]);
  });
  it("un evento desconocido (un v1 futuro) no rompe nada", () => {
    const e = estadoInicial(null);
    expect(reducir(e, { v: 1, t: "novedad" } as unknown as EventoDelWidget)).toBe(e);
  });
});

describe("mostrarIndicador", () => {
  it("se muestra mientras está ocupado y todavía no llegó texto del asistente; se apaga con el primer delta", () => {
    let e = alEnviar(estadoInicial(null), "hola");
    expect(mostrarIndicador(e)).toBe(true);
    e = reducir(e, { v: 1, t: "usuario", texto: "hola" });
    expect(mostrarIndicador(e)).toBe(true);
    e = reducir(e, { v: 1, t: "texto", delta: "H" });
    expect(mostrarIndicador(e)).toBe(false);
    expect(mostrarIndicador(alTerminarStream(e))).toBe(false);
  });
});

describe("2.2.0: la pantalla de inicio y los grupos", () => {
  it("mostrarInicio: sin cursor y sin mensajes → sí; con cursor guardado → no; con un optimista en vuelo → no", () => {
    expect(mostrarInicio(estadoInicial(null))).toBe(true);
    expect(mostrarInicio(estadoInicial({ id: "s1", indice: 3 }))).toBe(false);
    expect(mostrarInicio(alEnviar(estadoInicial(null), "hola"))).toBe(false);
  });
  it("mostrarInicio: después de `fin` (cursor null otra vez) con mensajes en pantalla → no; la charla terminada se sigue viendo", () => {
    const e = aplicar(alEnviar(estadoInicial(null), "hola"), { v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "asistente", texto: "Chau." }, { v: 1, t: "fin" });
    expect(e.cursor).toBeNull();
    expect(mostrarInicio(e)).toBe(false);
  });
  it("reducir ignora `herramienta`: es para el preview, no cambia la charla", () => {
    const e = alEnviar(estadoInicial(null), "hola");
    expect(reducir(e, { v: 1, t: "herramienta", nombre: "orientar", resumen: "Turnos" })).toBe(e);
  });
  it("agruparMensajes junta consecutivos del mismo rol, en orden", () => {
    const m = (clave: number, rol: "usuario" | "asistente", texto: string) => ({ clave, rol, texto, abierto: false });
    const grupos = agruparMensajes([m(1, "usuario", "a"), m(2, "asistente", "b"), m(3, "asistente", "c"), m(4, "usuario", "d")]);
    expect(grupos.map((g) => `${g.rol}:${g.mensajes.map((x) => ("texto" in x ? x.texto : "")).join("")}`)).toEqual(["usuario:a", "asistente:bc", "usuario:d"]);
    expect(agruparMensajes([])).toEqual([]);
  });
});

describe("textoDelError (T0.2): el idioma de un error no depende del backend", () => {
  it("cada código conocido tiene su texto propio en inglés", () => {
    expect(textoDelError("sesion_vencida")).toBe("The previous conversation expired. Write to start a new one.");
    expect(textoDelError("limite_de_sesion")).toBe("This conversation reached its limit. Write to start a new one.");
    expect(textoDelError("tope_de_mensajes")).toBe("The chat can't take more messages right now. Try again later.");
    expect(textoDelError("confirmacion_no_vigente")).toBe("That confirmation is out of date. Check the latest summary and answer that one.");
    for (const c of ["origen_no_admitido", "chat_deshabilitado", "proyecto_desconocido"]) {
      expect(textoDelError(c)).toBe("The chat isn't available on this site right now.");
    }
  });
  it("ia_no_disponible e ia_sin_configurar dicen lo mismo que la frase neutra del backend (agent/lib/errores-de-ia.ts, en inglés), nada de la clave ni de la plata", () => {
    for (const c of ["ia_no_disponible", "ia_sin_configurar"]) {
      expect(textoDelError(c)).toBe("The assistant isn't available right now. Please try again later.");
      expect(textoDelError(c)).not.toMatch(/key|balance|credit|billing|account|provider|payment/i);
    }
  });
  it("cualquier otro código (red, stream cortado, http_500, uno de eve, uno inventado) cae a «Couldn't send»", () => {
    for (const c of ["red", "stream_cortado", "traductor_fallo", "motor_inalcanzable", "http_500", "model_error", "cuerpo_invalido", "x", ""]) {
      expect(textoDelError(c)).toBe("Couldn't send. Try again.");
    }
  });
  it("el `mensaje` que manda el backend nunca se usa: sólo el código decide", () => {
    const e = reducir(estadoInicial(null), { v: 1, t: "error", codigo: "sesion_vencida", mensaje: "La sesión ya no está activa.", terminal: true });
    expect(textoDelError(e.error!.codigo)).not.toContain("sesión");
  });
});

describe("reintentarSirve: «Retry» sólo donde reintentar puede servir", () => {
  it("los dos códigos de la IA del cliente no ofrecen «Retry», aunque el error no sea terminal (el backend los manda con terminal:false)", () => {
    for (const codigo of ["ia_no_disponible", "ia_sin_configurar"]) expect(reintentarSirve({ codigo, mensaje: "", terminal: false })).toBe(false);
  });
  it("el resto sigue igual: un error no terminal ofrece «Retry», uno terminal no", () => {
    for (const codigo of ["red", "stream_cortado", "tope_de_mensajes", "confirmacion_no_vigente", "http_500", "chat_deshabilitado", "x"]) {
      expect(reintentarSirve({ codigo, mensaje: "", terminal: false }), codigo).toBe(true);
      expect(reintentarSirve({ codigo, mensaje: "", terminal: true }), codigo).toBe(false);
    }
  });
});

describe("2.3.0 (T0.3): actividad y desenlace (spec §6 de la etapa 1)", () => {
  const ocupado = () => alEnviar(estadoInicial(null), "how do I export?");
  it("actividad leyendo_la_guia queda hasta el próximo texto, y mientras tanto el indicador la dice", () => {
    let e = aplicar(ocupado(), { v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "usuario", texto: "how do I export?" }, { v: 1, t: "actividad", que: "leyendo_la_guia" });
    expect(e.actividad).toBe("leyendo_la_guia");
    expect(mostrarIndicador(e)).toBe(true);
    e = aplicar(e, { v: 1, t: "texto", delta: "Go to" });
    expect(e.actividad).toBeNull();
  });
  it("la actividad también se apaga con el texto final, una pregunta, la espera, el fin o un error", () => {
    const conActividad = aplicar(ocupado(), { v: 1, t: "actividad", que: "leyendo_la_guia" });
    const cierres: EventoDelWidget[] = [
      { v: 1, t: "asistente", texto: "Done." },
      { v: 1, t: "pregunta", requestId: "r", kind: "question", prompt: "?", opciones: [], libre: true },
      { v: 1, t: "espera", indice: 3 },
      { v: 1, t: "fin" },
      { v: 1, t: "error", codigo: "x", mensaje: "", terminal: false },
    ];
    for (const ev of cierres) expect(reducir(conActividad, ev).actividad).toBeNull();
  });
  it("una actividad de vocabulario desconocido se ignora (el vocabulario es cerrado)", () => {
    const e = aplicar(ocupado(), { v: 1, t: "actividad", que: "otra_cosa" } as unknown as EventoDelWidget);
    expect(e.actividad).toBeNull();
  });
  it("desenlace reportado con id: un ítem fijo de la conversación, después de los mensajes", () => {
    const e = aplicar(ocupado(), { v: 1, t: "asistente", texto: "Sent." }, { v: 1, t: "desenlace", que: "reportado", reporte: "rep_0123456789abcdef" }, { v: 1, t: "espera", indice: 9 });
    expect(e.mensajes.map((m) => m.rol)).toEqual(["usuario", "asistente", "desenlace"]);
    expect(e.mensajes[2]).toMatchObject({ rol: "desenlace", desenlace: { que: "reportado", reporte: "rep_0123456789abcdef" } });
  });
  it("desenlace reportado sin id (o con un id que no es texto corto) queda con reporte null: sólo la frase", () => {
    for (const reporte of [null, 42, "", "x".repeat(65)]) {
      const e = aplicar(ocupado(), { v: 1, t: "desenlace", que: "reportado", reporte } as unknown as EventoDelWidget);
      expect(e.mensajes[1]).toMatchObject({ rol: "desenlace", desenlace: { que: "reportado", reporte: null } });
    }
  });
  it("desenlace respondida: el chip", () => {
    const e = aplicar(ocupado(), { v: 1, t: "desenlace", que: "respondida" });
    expect(e.mensajes[1]).toMatchObject({ rol: "desenlace", desenlace: { que: "respondida" } });
  });
  it("un desenlace de vocabulario desconocido no agrega nada", () => {
    const antes = ocupado();
    expect(reducir(antes, { v: 1, t: "desenlace", que: "archivado" } as unknown as EventoDelWidget)).toBe(antes);
  });
  it("un desenlace cierra el texto abierto del asistente: lo que siga es otra burbuja", () => {
    const e = aplicar(ocupado(), { v: 1, t: "texto", delta: "Sending" }, { v: 1, t: "desenlace", que: "respondida" }, { v: 1, t: "texto", delta: "Anything else?" });
    expect(e.mensajes.map((m) => m.rol)).toEqual(["usuario", "asistente", "desenlace", "asistente"]);
  });
  it("el desenlace no cuenta como texto del asistente para el indicador", () => {
    const e = aplicar(ocupado(), { v: 1, t: "desenlace", que: "respondida" });
    expect(mostrarIndicador(e)).toBe(true);
  });
  it("un `t` desconocido se sigue ignorando", () => {
    const antes = ocupado();
    expect(reducir(antes, { v: 1, t: "futuro", algo: 1 } as unknown as EventoDelWidget)).toBe(antes);
  });
  it("agruparMensajes deja cada desenlace en su propio grupo", () => {
    const e = aplicar(ocupado(), { v: 1, t: "asistente", texto: "a" }, { v: 1, t: "desenlace", que: "respondida" }, { v: 1, t: "asistente", texto: "b" });
    expect(agruparMensajes(e.mensajes).map((g) => g.rol)).toEqual(["usuario", "asistente", "desenlace", "asistente"]);
  });
  it("revisión de F0 (1): un `t` desconocido con la actividad vigente deja el estado EXACTAMENTE igual", () => {
    const conActividad = aplicar(ocupado(), { v: 1, t: "actividad", que: "leyendo_la_guia" });
    expect(reducir(conActividad, { v: 1, t: "futuro" } as unknown as EventoDelWidget)).toBe(conActividad);
  });
  it("revisión de F0 (2): un stream que termina sin borde apaga la actividad, y un envío, respuesta o reintento nuevo arranca sin ella", () => {
    const conActividad = aplicar(ocupado(), { v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "actividad", que: "leyendo_la_guia" });
    expect(alTerminarStream(conActividad).actividad).toBeNull();
    expect(alEnviar(conActividad, "otra").actividad).toBeNull();
    expect(alResponder(conActividad).actividad).toBeNull();
    expect(alReintentar(conActividad).actividad).toBeNull();
  });
});

describe("T0.7 «New conversation» (D2): después de un reporte, otra sesión sin recargar", () => {
  const ocupado = () => alEnviar(estadoInicial(null), "the save button does nothing");
  const reportada = () =>
    aplicar(ocupado(), { v: 1, t: "sesion", id: "s1", indice: 0 }, { v: 1, t: "asistente", texto: "Sent." }, { v: 1, t: "desenlace", que: "reportado", reporte: "rep_1" }, { v: 1, t: "espera", indice: 5 });
  it("borra el cursor (que el widget guarda en sessionStorage) y deja los mensajes a la vista", () => {
    const antes = reportada();
    expect(antes.cursor).toEqual({ id: "s1", indice: 5 });
    const despues = alNuevaConversacion(antes);
    expect(despues.cursor).toBeNull();
    expect(despues.mensajes).toEqual(antes.mensajes);
    expect(despues.ocupado).toBe(false);
  });
  it("el próximo envío abre sesión nueva: ya no hay cursor con el que seguir", () => {
    const e = alEnviar(alNuevaConversacion(reportada()), "another problem");
    expect(e.cursor).toBeNull();
    expect(e.mensajes.at(-1)).toMatchObject({ rol: "usuario", texto: "another problem" });
  });
  it("limpia la pregunta, el error y la actividad de la sesión que termina", () => {
    const sucio = { ...reportada(), pregunta: { requestId: "r", kind: "question", opciones: [], libre: false }, error: { codigo: "x", mensaje: "", terminal: false }, actividad: "leyendo_la_guia" as const };
    const e = alNuevaConversacion(sucio);
    expect(e.pregunta).toBeNull();
    expect(e.error).toBeNull();
    expect(e.actividad).toBeNull();
  });
  it("sin cursor no hace nada nuevo y sigue siendo idempotente", () => {
    const e = alNuevaConversacion(alNuevaConversacion(reportada()));
    expect(e.cursor).toBeNull();
  });
});

// ─── Los pasos reales (tanda «chat-pasos-visibles») ───────────────────────────────────────────────────────
// El reducer REAL: un paso espera a la respuesta que sigue y se queda pegado a ella (así sobrevive a la recarga, que
// rebobina el mismo stream); no es un mensaje ni cambia quién habla.
describe("pasos reales", () => {
  const ocupado = () => alEnviar(estadoInicial(null), "where do I change the billing email?");
  const guia = (seccion = "Billing"): EventoDelWidget => ({ v: 1, t: "paso", que: "guia_leida", seccion });

  it("un paso se pega a la próxima respuesta del asistente (por deltas) y no crea un mensaje propio", () => {
    let e = aplicar(ocupado(), { v: 1, t: "usuario", texto: "where do I change the billing email?" }, guia());
    expect(e.mensajes).toHaveLength(1);
    e = aplicar(e, { v: 1, t: "texto", delta: "Go to " }, { v: 1, t: "texto", delta: "Settings." });
    expect(e.mensajes).toHaveLength(2);
    expect(e.mensajes[1]).toMatchObject({ rol: "asistente", texto: "Go to Settings.", pasos: [{ que: "guia_leida", seccion: "Billing" }] });
    expect(e.pasos).toEqual([]);
  });
  it("también se pega a la respuesta que llega entera (recarga) y a una pregunta", () => {
    const a = aplicar(ocupado(), guia(), { v: 1, t: "asistente", texto: "Go to Settings." });
    expect(a.mensajes[1]).toMatchObject({ pasos: [{ que: "guia_leida", seccion: "Billing" }] });
    const q = aplicar(ocupado(), { v: 1, t: "paso", que: "resumen_preparado" }, { v: 1, t: "pregunta", requestId: "r", kind: "tool-approval", prompt: "This is what I'll send", opciones: [], libre: false });
    expect(q.mensajes[1]).toMatchObject({ rol: "asistente", pasos: [{ que: "resumen_preparado" }] });
  });
  it("varios pasos del mismo turno quedan en orden; el mismo paso repetido se dice una vez", () => {
    const e = aplicar(ocupado(), guia("Billing"), guia("Billing"), guia("Plans"), { v: 1, t: "asistente", texto: "ok" });
    expect(e.mensajes[1]).toMatchObject({ pasos: [{ que: "guia_leida", seccion: "Billing" }, { que: "guia_leida", seccion: "Plans" }] });
  });
  it("el mensaje siguiente no hereda pasos que ya se dibujaron", () => {
    const e = aplicar(ocupado(), guia(), { v: 1, t: "asistente", texto: "uno" }, { v: 1, t: "asistente", texto: "dos" });
    expect(e.mensajes[1]).toHaveProperty("pasos");
    expect(e.mensajes[2]).not.toHaveProperty("pasos");
  });
  it("un paso que llega con una burbuja ya abierta espera a la próxima (no se cuela en lo que ya se leía)", () => {
    const e = aplicar(ocupado(), { v: 1, t: "texto", delta: "Let me check" }, guia(), { v: 1, t: "asistente", texto: "Let me check" }, { v: 1, t: "asistente", texto: "Go to Settings." });
    expect(e.mensajes[1]).not.toHaveProperty("pasos");
    expect(e.mensajes[2]).toMatchObject({ pasos: [{ que: "guia_leida", seccion: "Billing" }] });
  });
  it("un paso sin respuesta que lo siga no se arrastra al turno de después (espera, fin, error terminal, mensaje nuevo, nueva conversación)", () => {
    for (const cierre of [{ v: 1, t: "espera", indice: 3 }, { v: 1, t: "fin" }, { v: 1, t: "error", codigo: "x", mensaje: "", terminal: true }, { v: 1, t: "usuario", texto: "otra" }] as EventoDelWidget[]) {
      expect(reducir(aplicar(ocupado(), guia()), cierre).pasos, cierre.t).toEqual([]);
    }
    expect(alNuevaConversacion(aplicar(ocupado(), guia())).pasos).toEqual([]);
    expect(alEnviar(aplicar(ocupado(), guia()), "otra").pasos).toEqual([]);
    expect(alTerminarStream(aplicar(ocupado(), guia())).pasos).toEqual([]);
  });
  it("un paso de vocabulario desconocido, o una sección que no es texto, se ignora", () => {
    for (const ev of [{ v: 1, t: "paso", que: "otra_cosa" }, { v: 1, t: "paso", que: "guia_leida", seccion: 7 }, { v: 1, t: "paso", que: "guia_leida", seccion: "" }, { v: 1, t: "paso", que: "guia_leida" }] as unknown as EventoDelWidget[]) {
      expect(aplicar(ocupado(), ev).pasos, JSON.stringify(ev)).toEqual([]);
    }
  });
  it("la sección se acota a 60 caracteres también acá (un backend viejo o ajeno no rompe la línea)", () => {
    const e = aplicar(ocupado(), guia("x".repeat(500)), { v: 1, t: "asistente", texto: "ok" });
    const m = e.mensajes[1]!;
    expect(m.rol === "asistente" && Array.from(m.pasos?.[0]?.que === "guia_leida" ? m.pasos[0].seccion : "").length).toBeLessThanOrEqual(60);
  });
  it("el paso no apaga la actividad «leyendo la guía» ni el indicador de trabajo", () => {
    const e = aplicar(ocupado(), { v: 1, t: "actividad", que: "leyendo_la_guia" }, guia());
    expect(e.actividad).toBe("leyendo_la_guia");
    expect(mostrarIndicador(e)).toBe(true);
  });
  it("un paso entre un texto y su cierre no cambia los grupos: agruparMensajes no ve pasos como mensajes", () => {
    const e = aplicar(ocupado(), guia(), { v: 1, t: "asistente", texto: "ok" });
    expect(agruparMensajes(e.mensajes).map((g) => g.rol)).toEqual(["usuario", "asistente"]);
  });
  it("la lista pasa de 5 pasos pendientes: se queda con los 5 primeros (acotada)", () => {
    const e = aplicar(ocupado(), ...Array.from({ length: 9 }, (_, i) => guia(`S${i}`)), { v: 1, t: "asistente", texto: "ok" });
    const m = e.mensajes[1]!;
    expect(m.rol === "asistente" && m.pasos).toHaveLength(5);
  });
  // Revisión vuelta 1 (P2-1): si el paso llega DESPUÉS de la burbuja (el modelo escribe y recién ahí anota), al cerrar el turno se pega a ella.
  it("un paso que llegó después de la respuesta se pega a la última burbuja del turno al cerrarse (espera o fin)", () => {
    for (const cierre of [{ v: 1, t: "espera", indice: 3 }, { v: 1, t: "fin" }] as EventoDelWidget[]) {
      const e = aplicar(ocupado(), { v: 1, t: "usuario", texto: "where do I change the billing email?" }, { v: 1, t: "asistente", texto: "The guide doesn't cover that." }, { v: 1, t: "paso", que: "pregunta_anotada" }, cierre);
      expect(e.mensajes[1], cierre.t).toMatchObject({ rol: "asistente", pasos: [{ que: "pregunta_anotada" }] });
      expect(e.pasos).toEqual([]);
    }
  });
  it("se suma a los pasos que la burbuja ya tenía, sin repetir ni pasar de 5", () => {
    const e = aplicar(ocupado(), guia("Billing"), { v: 1, t: "asistente", texto: "ok" }, guia("Billing"), { v: 1, t: "paso", que: "pregunta_anotada" }, { v: 1, t: "espera", indice: 3 });
    expect(e.mensajes[1]).toMatchObject({ pasos: [{ que: "guia_leida", seccion: "Billing" }, { que: "pregunta_anotada" }] });
  });
  it("sólo la burbuja DE ESTE turno: si el turno no tuvo ninguna, el paso se descarta y no toca el turno anterior", () => {
    const antes = aplicar(estadoInicial(null), { v: 1, t: "usuario", texto: "a" }, { v: 1, t: "asistente", texto: "uno" }, { v: 1, t: "espera", indice: 1 });
    const e = aplicar(antes, { v: 1, t: "usuario", texto: "b" }, { v: 1, t: "paso", que: "pregunta_anotada" }, { v: 1, t: "espera", indice: 2 });
    expect(e.mensajes[1]).not.toHaveProperty("pasos");
    expect(e.pasos).toEqual([]);
  });
  it("un error terminal sigue descartando (no hay respuesta que lo cuente)", () => {
    const e = aplicar(ocupado(), { v: 1, t: "asistente", texto: "ok" }, { v: 1, t: "paso", que: "pregunta_anotada" }, { v: 1, t: "error", codigo: "x", mensaje: "", terminal: true });
    expect(e.mensajes[1]).not.toHaveProperty("pasos");
    expect(e.pasos).toEqual([]);
  });
});

describe("reportado (2.3.1): la sesión actual ya tiene su reporte", () => {
  it("el desenlace `reportado` lo prende; `respondida` no", () => {
    expect(estadoInicial(null).reportado).toBe(false);
    expect(aplicar(estadoInicial(null), { v: 1, t: "desenlace", que: "reportado", reporte: "rep_1" }).reportado).toBe(true);
    expect(aplicar(estadoInicial(null), { v: 1, t: "desenlace", que: "respondida" }).reportado).toBe(false);
  });
  it("una sesión NUEVA (`sesion` con otro id) y «New conversation» lo apagan; recuperar la misma sesión no", () => {
    const con = aplicar(estadoInicial({ id: "s1", indice: 3 }), { v: 1, t: "desenlace", que: "reportado", reporte: "rep_1" });
    expect(aplicar(con, { v: 1, t: "sesion", id: "s1", indice: 4 }).reportado).toBe(true);
    expect(aplicar(con, { v: 1, t: "sesion", id: "s2", indice: 0 }).reportado).toBe(false);
    expect(alNuevaConversacion(con).reportado).toBe(false);
  });
});
