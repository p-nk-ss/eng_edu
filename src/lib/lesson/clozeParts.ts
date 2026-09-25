/** Split a gapped text at every "___"; n gaps give n + 1 segments. */
export function splitGaps(text: string): string[] {
  return text.split("___");
}
