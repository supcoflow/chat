/** El `package-lock.json` que bloquea las dependencias del paquete: el primero que se encuentra subiendo desde su carpeta, o `undefined`. Ver `huella-del-build.mjs`. */
export function buscarLockfile(dirDelPaquete: string): string | undefined;
/** Ocho caracteres hexadecimales que identifican lo que entra al widget publicado: su fuente, la configuración del build y las versiones bloqueadas de sus dependencias. Ver `huella-del-build.mjs`. */
export function huellaDelBuild(dirDelPaquete: string, rutaDelLockfile?: string): string;
