// Type declarations for non-TypeScript files
declare module '*.css' {
  const styles: Record<string, string>;
  export default styles;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
declare module '*.png' {
  const src: string;
  export default src;
}
