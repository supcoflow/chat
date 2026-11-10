// El orden de «Capturar pantalla» en el widget, sin React para poder testearlo (2.3.1). El chat se oculta SÓLO mientras se toma el
// frame —la captura es de la página, no del chat— y SIEMPRE vuelve a mostrarse, pase lo que pase: antes se ocultaba antes de pedir
// el permiso y sólo volvía si esa promesa terminaba, así que en un navegador que no contesta el diálogo (Chrome headless) el chat
// quedaba oculto hasta recargar.

export interface DependenciasDeLaCaptura<I> {
  ocultar(): void;
  mostrar(): void;
  /** Hay una captura en curso: un segundo toque no abre otro diálogo del navegador. */
  enCurso: { current: boolean };
  /** Corre la captura; llama a `antesDelFrame` cuando ya hay permiso y falta tomar el frame. */
  capturar(opciones: { antesDelFrame: () => void }): Promise<I | null>;
}

export async function capturarOcultando<I>(d: DependenciasDeLaCaptura<I>): Promise<{ tipo: "ocupado" } | { tipo: "listo"; imagen: I | null }> {
  if (d.enCurso.current) return { tipo: "ocupado" };
  d.enCurso.current = true;
  try {
    const imagen = await d.capturar({ antesDelFrame: () => d.ocultar() });
    return { tipo: "listo", imagen };
  } finally {
    d.enCurso.current = false;
    d.mostrar();
  }
}
