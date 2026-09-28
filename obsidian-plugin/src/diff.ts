export interface Difference { local: string; source: string; changed: boolean; choice: "local" | "source" }

// Bounded LCS keeps large books from allocating an unbounded comparison matrix.
// When the limit is exceeded the two complete sections remain reviewable.
export function compareLines(local: string, source: string): Difference[] {
  if (local === source) return [{ local, source, changed: false, choice: "source" }];
  const left = local.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const right = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if (left.length * right.length > 1000000 || left.length + right.length > 10000) return [{ local, source, changed: true, choice: "local" }];
  const width = right.length + 1;
  const matrix = new Uint32Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
    matrix[i * width + j] = left[i] === right[j] ? matrix[(i + 1) * width + j + 1]! + 1 : Math.max(matrix[(i + 1) * width + j]!, matrix[i * width + j + 1]!);
  }
  const differences: Difference[] = [];
  const append = (local: string, source: string, changed: boolean) => {
    const previous = differences.at(-1);
    if (previous?.changed === changed) { previous.local += local; previous.source += source; }
    else differences.push({ local, source, changed, choice: changed ? "local" : "source" });
  };
  let i = 0, j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) { append(left[i++]!, right[j++]!, false); }
    else if (i < left.length && (j === right.length || matrix[(i + 1) * width + j]! >= matrix[i * width + j + 1]!)) append(left[i++]!, "", true);
    else append("", right[j++]!, true);
  }
  return differences;
}
export function mergedText(differences: Difference[]): string {
  return differences.map(difference => difference[difference.choice]).join("");
}
