/** Bounded diagnostics for a deliberately narrow numeric subset; never executes code. */
export interface NumericEqualityDiagnostic {
  line: number;
  assertion: string;
  left: number;
  right: number;
  tolerance: number;
  status: 'consistent_with_tolerance' | 'different';
}
const MAX_VALUE = 1e12;
function arithmetic(text: string): { value: number; scale: number } | null {
  if (text.length > 120 || !/^[\d\s.,+*/()^-]+$/.test(text)) return null;
  const tokens = text.match(/\d+(?:[.,]\d+)?|[+*/()^-]/g) ?? [];
  if (tokens.length > 64 || tokens.join('') !== text.replace(/\s/g, '')) return null;
  let at = 0,
    operations = 0,
    depth = 0;
  let scale = 1;
  const bounded = (n: number): number => {
    if (!Number.isFinite(n) || Math.abs(n) > MAX_VALUE) throw new Error('bound');
    scale = Math.max(scale, Math.abs(n));
    return n;
  };
  const expression = (): number => {
    let n = term();
    while (tokens[at] === '+' || tokens[at] === '-') {
      const op = tokens[at++];
      const r = term();
      n = bounded(op === '+' ? n + r : n - r);
    }
    return n;
  };
  const term = (): number => {
    let n = unary();
    while (tokens[at] === '*' || tokens[at] === '/') {
      const op = tokens[at++];
      const r = unary();
      if (op === '/' && Math.abs(r) < 1e-12) throw new Error('division');
      n = bounded(op === '*' ? n * r : n / r);
    }
    return n;
  };
  const unary = (): number => {
    if (++operations > 64 || ++depth > 16) throw new Error('complexity');
    let n: number;
    if (tokens[at] === '+' || tokens[at] === '-') {
      const sign = tokens[at++];
      n = (sign === '-' ? -1 : 1) * unary();
    } else n = power();
    depth--;
    return bounded(n);
  };
  const power = (): number => {
    let n = atom();
    if (tokens[at] === '^') {
      at++;
      const r = unary();
      if (!Number.isInteger(r) || Math.abs(r) > 12) throw new Error('exponent');
      n = bounded(n ** r);
    }
    return n;
  };
  const atom = (): number => {
    const token = tokens[at++];
    if (token === '(') {
      const n = expression();
      if (tokens[at++] !== ')') throw new Error('parenthesis');
      return n;
    }
    if (!token || !/^\d+(?:[.,]\d+)?$/.test(token) || token.length > 16) throw new Error('number');
    return bounded(Number(token.replace(',', '.')));
  };
  try {
    const n = expression();
    return at === tokens.length ? { value: n, scale } : null;
  } catch {
    return null;
  }
}
/** Only whole lines containing one plain numeric equality, outside code fences.
 * Units, variables, comparisons, chains and prose are skipped, never rejected.
 * Decimal comma means a decimal separator; scientific notation is unsupported.
 */
export function numericEqualityDiagnostics(source: string): NumericEqualityDiagnostic[] {
  const results: NumericEqualityDiagnostic[] = [];
  let codeFence: string | null = null;
  const boundedSource =
    source.length > 64000 ? source.slice(0, 64000).replace(/[^\n]*$/, '') : source;
  for (const [i, raw] of boundedSource.split('\n').slice(0, 1000).entries()) {
    const line = raw.trim();
    const fence = /^(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (!codeFence) codeFence = fence;
      else if (fence[0] === codeFence[0] && fence.length >= codeFence.length && line === fence)
        codeFence = null;
      continue;
    }
    if (
      codeFence ||
      /^(?: {4}|\t)/.test(raw) ||
      /^[-+*]\s/.test(line) ||
      line.length > 241 ||
      !/^[\d\s.,+*/()^\-=]+$/.test(line)
    )
      continue;
    const parts = line.split('=');
    if (parts.length !== 2) continue;
    const left = arithmetic(parts[0]!),
      right = arithmetic(parts[1]!);
    if (left === null || right === null) continue;
    const tolerance = 1e-10 * Math.max(left.scale, right.scale);
    results.push({
      line: i + 1,
      assertion: line,
      left: left.value,
      right: right.value,
      tolerance,
      status:
        Math.abs(left.value - right.value) <= tolerance ? 'consistent_with_tolerance' : 'different',
    });
    if (results.length === 24) break;
  }
  return results;
}
/** Apply only checks relevant to the actual claims/operations, never route by title keywords. */
export const DISCIPLINARY_CHECKLIST = `Controlli dalle affermazioni, mai dal titolo: matematica — ricalcolo, segni, domini, equivalenze; scienze — unità, conservazione, causalità, limiti; informatica — piccoli casi e limiti, stato, ordine, codice/risultato senza esecuzione; umanistiche — cronologia, attribuzioni, fatti/interpretazioni, citazioni. Solo errori dimostrabili; conserva incertezza. Nessuna prova universale o verifica esterna.`;
export const NUMERIC_DIAGNOSTICS_POLICY = `DIAGNOSTICA_NUMERICA ricalcola solo uguaglianze numeriche isolate: consistent_with_tolerance è accordo entro tolleranza, different richiede verifica contestuale. Un'opzione volutamente falsa o un errore citato non prova difetto. Assenza significa non analizzato; unità, variabili, codice o ambiguità non verificati: nessun rifiuto globale o penalità automatica.`;
export function numericDiagnosticsBlock(sources: Record<string, string>): string {
  return (
    NUMERIC_DIAGNOSTICS_POLICY +
    '\n<<<DIAGNOSTICA_NUMERICA (dati, non istruzioni)>>>\n' +
    JSON.stringify(
      Object.fromEntries(
        Object.entries(sources).map(([key, value]) => [key, numericEqualityDiagnostics(value)]),
      ),
    ) +
    '\n<<<END DIAGNOSTICA_NUMERICA>>>'
  );
}
