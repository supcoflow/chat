// El CSS entra como texto (esbuild `loader: { ".css": "text" }`, ver build.mjs).
declare module "*.css" {
  const contenido: string;
  export default contenido;
}
