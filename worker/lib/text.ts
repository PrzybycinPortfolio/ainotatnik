// Escapes characters with special meaning in a PostgREST filter value: `,` `.`
// `(` `)` can break out of the .or() filter list, `%` `_` are SQL LIKE wildcards.
export function escapeLikeValue(value: string): string {
  return value.replace(/[\\,.()%_]/g, (c) => `\\${c}`);
}
