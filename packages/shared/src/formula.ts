type Value = string | number | boolean | null | Record<string, unknown> | unknown[];
type Token = {
  kind: 'number' | 'string' | 'identifier' | 'operator' | 'paren' | 'comma';
  value: string;
};
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let s = '';
      i++;
      while (i < source.length && source[i] !== quote) {
        s += source[i++];
      }
      if (source[i] !== quote) throw new Error('Unclosed string');
      i++;
      tokens.push({ kind: 'string', value: s });
      continue;
    }
    const num = source.slice(i).match(/^(?:\d+(?:\.\d+)?|\.\d+)/);
    if (num) {
      tokens.push({ kind: 'number', value: num[0]! });
      i += num[0]!.length;
      continue;
    }
    const id = source.slice(i).match(/^[A-Za-z_][\w ]*?(?=\s*(?:\(|\}|$|[<>=!+\-*/%,]))/);
    if (id) {
      tokens.push({ kind: 'identifier', value: id[0]!.trim() });
      i += id[0]!.length;
      continue;
    }
    if (source.startsWith('{{', i)) {
      const end = source.indexOf('}}', i + 2);
      if (end < 0) throw new Error('Unclosed column reference');
      tokens.push({ kind: 'identifier', value: source.slice(i + 2, end).trim() });
      i = end + 2;
      continue;
    }
    const op = source.slice(i).match(/^(===|!==|==|!=|>=|<=|&&|\|\||[+\-*/%><!])/);
    if (op) {
      tokens.push({ kind: 'operator', value: op[0]! });
      i += op[0]!.length;
      continue;
    }
    if (c === '(' || c === ')') {
      tokens.push({ kind: 'paren', value: c });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ kind: 'comma', value: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected token ${c}`);
  }
  return tokens;
}
export function evaluateFormula(expression: string, row: Record<string, unknown>): Value {
  const tokens = tokenize(expression);
  let pos = 0;
  const value = (v: unknown): Value => {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v === null)
      return v;
    if (Array.isArray(v)) return v;
    if (typeof v === 'object') return v as Record<string, unknown>;
    return String(v);
  };
  const truth = (v: Value): boolean => Boolean(v);
  const primary = (): Value => {
    const t = tokens[pos++];
    if (!t) throw new Error('Expected value');
    if (t.kind === 'number') return Number(t.value);
    if (t.kind === 'string') return t.value;
    if (t.kind === 'identifier') {
      if (tokens[pos]?.value === '(') {
        pos++;
        const args: Value[] = [];
        if (tokens[pos]?.value !== ')')
          while (true) {
            args.push(or());
            if (tokens[pos]?.kind !== 'comma') break;
            pos++;
          }
        if (tokens[pos]?.value !== ')') throw new Error('Expected )');
        pos++;
        return call(t.value, args);
      }
      return value(row[t.value] ?? '');
    }
    if (t.value === '(') {
      const x = or();
      if (tokens[pos++]?.value !== ')') throw new Error('Expected )');
      return x;
    }
    throw new Error('Expected value');
  };
  const call = (name: string, args: Value[]): Value => {
    const a = args[0] ?? null;
    switch (name.toLowerCase()) {
      case 'if':
        return truth(a) ? (args[1] ?? null) : (args[2] ?? null);
      case 'lower':
        return String(a ?? '').toLowerCase();
      case 'upper':
        return String(a ?? '').toUpperCase();
      case 'trim':
        return String(a ?? '').trim();
      case 'concat':
        return args.map((x) => String(x ?? '')).join('');
      case 'contains':
        return String(a ?? '').includes(String(args[1] ?? ''));
      case 'len':
        return String(a ?? '').length;
      case 'coalesce':
        return args.find((x) => x !== null && x !== '') ?? null;
      case 'get': {
        const path = String(args[1] ?? '');
        let current: unknown = args[0];
        for (const segment of path.split('.')) {
          if (Array.isArray(current) && /^\d+$/.test(segment)) {
            current = current[Number(segment)];
          } else if (current && typeof current === 'object') {
            current = (current as Record<string, unknown>)[segment];
          } else {
            return null;
          }
          if (current === undefined) return null;
        }
        return current === undefined ? null : value(current);
      }
      default:
        throw new Error(`Unknown function ${name}`);
    }
  };
  const unary = (): Value => {
    if (tokens[pos]?.value === '!') {
      pos++;
      return !truth(unary());
    }
    if (tokens[pos]?.value === '-') {
      pos++;
      return -Number(unary());
    }
    return primary();
  };
  const multiply = (): Value => {
    let left = unary();
    while (['*', '/', '%'].includes(tokens[pos]?.value ?? '')) {
      const op = tokens[pos++]!.value;
      const right = unary();
      if (op === '*') left = Number(left) * Number(right);
      else if (op === '/') left = Number(left) / Number(right);
      else left = Number(left) % Number(right);
    }
    return left;
  };
  const arithmetic = (): Value => {
    let left = multiply();
    while (['+', '-'].includes(tokens[pos]?.value ?? '')) {
      const op = tokens[pos++]!.value;
      const right = multiply();
      if (op === '+') {
        left =
          typeof left === 'string' || typeof right === 'string'
            ? String(left) + String(right)
            : Number(left) + Number(right);
      } else {
        left = Number(left) - Number(right);
      }
    }
    return left;
  };
  const compare = (): Value => {
    let left = arithmetic();
    while (['==', '===', '!=', '!==', '>', '<', '>=', '<='].includes(tokens[pos]?.value ?? '')) {
      const op = tokens[pos++]!.value;
      const right = arithmetic();
      left =
        op.includes('=') && op.includes('!')
          ? left !== right
          : op.includes('=')
            ? left === right
            : op === '>'
              ? Number(left) > Number(right)
              : op === '<'
                ? Number(left) < Number(right)
                : op === '>='
                  ? Number(left) >= Number(right)
                  : Number(left) <= Number(right);
    }
    return left;
  };
  const and = (): Value => {
    let left = compare();
    while (tokens[pos]?.value === '&&') {
      pos++;
      left = truth(left) && truth(compare());
    }
    return left;
  };
  const or = (): Value => {
    let left = and();
    while (tokens[pos]?.value === '||') {
      pos++;
      left = truth(left) || truth(and());
    }
    return left;
  };
  const result = or();
  if (pos !== tokens.length) throw new Error('Unexpected trailing expression');
  return result;
}
