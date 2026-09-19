declare module '*.html' {
  const htmlBundle: unknown;
  export default htmlBundle;
}

declare module '*.css' {
  const cssBundle: string;
  export default cssBundle;
}
