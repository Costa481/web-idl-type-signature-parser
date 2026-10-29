/**
 * Core parser for Web IDL interface definitions.
 *
 * Decision: this library intentionally parses ONE interface at a time.
 * A full Web IDL document can contain dictionaries, enums, callbacks,
 * partial interfaces, and includes statements — handling all of them reliably
 * without dependencies would balloon the surface area. By accepting a single
 * interface block we can use a pragmatic tokenizer instead of a grammar
 * engine, which keeps the code small and the behaviour predictable.
 */

/**
 * Strip /* ... *​/ comments from source text.
 *
 * We remove comments before tokenizing so that a type name inside a comment
 * can never leak into the parsed members. Line comments (//) are not part of
 * the Web IDL grammar we target, so we deliberately do not touch them.
 */
function stripBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Find the opening brace of `interface Identifier`.
 *
 * `interface Identifier : Parent` is valid, so we scan forward until we hit
 * the opening brace rather than assuming the name is the only thing before
 * the brace.
 */
function extractInterfaceName(src) {
  const m = src.match(/\binterface\s+([A-Za-z_][A-Za-z0-9_]*)/);
  if (!m) return null;
  return m[1];
}

/**
 * Return the text between the opening brace that starts the interface body
 * and the matching closing brace. Handles nested braces so that map-like
 * types or annotations inside the body do not confuse the scanner.
 */
function extractBody(src) {
  const open = src.indexOf('{');
  if (open === -1) return '';

  let depth = 0;
  let inStr = false;
  let strCh = '';
  let i = open;

  for (; i < src.length; i++) {
    const ch = src[i];

    if (inStr) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === strCh) {
        inStr = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inStr = true;
      strCh = ch;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(open + 1, i);
      }
    }
  }

  return src.slice(open + 1);
}

/**
 * Collapse runs of whitespace into single spaces. We keep newlines as
 * spaces because the tokenizer splits on semicolons, not on lines.
 */
function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Remove the leading extended-attribute list `[Attr, Attr=val]` from a
 * member declaration. We need to strip this because attributes like
 * `[Exposed=Window]` would otherwise look like part of the type.
 */
function stripExtendedAttributes(decl) {
  const trimmed = decl.trim();
  if (!trimmed.startsWith('[')) return trimmed;

  let depth = 0;
  let inStr = false;
  let strCh = '';

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (inStr) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === strCh) inStr = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inStr = true;
      strCh = ch;
      continue;
    }

    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return trimmed.slice(i + 1).trim();
      }
    }
  }

  return trimmed;
}

/**
 * Split a parameter list on commas that are at brace depth 0 and not inside
 * a string. Commas inside `sequence<...>` or `record<...>` must not split.
 */
function splitParameters(paramSrc) {
  const trimmed = paramSrc.trim();
  if (!trimmed) return [];

  const parts = [];
  let depth = 0;
  let inStr = false;
  let strCh = '';
  let start = 0;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (inStr) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === strCh) inStr = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inStr = true;
      strCh = ch;
      continue;
    }

    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(trimmed.slice(start, i).trim());
      start = i + 1;
    }
  }

  parts.push(trimmed.slice(start).trim());
  return parts;
}

/**
 * Parse a single parameter string like `long x` or `DOMString name = ""`.
 *
 * The last identifier (before any `= default`) is the parameter name;
 * everything before it is the type. This is a simplification — Web IDL
 * allows identifiers like `callback` — but it covers every parameter shape
 * encountered in the common interface definitions this library targets.
 */
function parseParameter(paramStr) {
  const trimmed = paramStr.trim();
  if (!trimmed) return null;

  const eqIdx = trimmed.indexOf('=');
  const head = eqIdx >= 0 ? trimmed.slice(0, eqIdx).trim() : trimmed;

  let isOptional = false;
  let work = head;
  if (work.startsWith('optional ')) {
    isOptional = true;
    work = work.slice('optional '.length).trim();
  }

  const tokens = work.split(/\s+/);
  if (tokens.length === 0) return null;

  const name = tokens[tokens.length - 1];
  const type = tokens.slice(0, -1).join(' ').trim();

  return { name, type, optional: isOptional };
}

/**
 * Parse an attribute declaration of the form
 *   [readonly] attribute Type identifier;
 *
 * `readonly` and `attribute` are optional modifiers; if present we record
 * `readonly` and strip both keywords so the remaining tokens are cleanly
 * type + name.
 */
function parseAttribute(decl) {
  const clean = stripExtendedAttributes(decl);
  if (!clean) return null;

  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  let i = 0;
  let readonly = false;

  if (tokens[i] === 'readonly') {
    readonly = true;
    i++;
  }

  if (tokens[i] === 'attribute') {
    i++;
  }

  if (i >= tokens.length - 1) return null;

  const name = tokens[tokens.length - 1];
  const type = tokens.slice(i, -1).join(' ');

  return { kind: 'attribute', name, type, readonly };
}

/**
 * Parse a method declaration of the form
 *   returnType identifier(Type p1, Type p2, ...);
 *
 * We scan for the first `(`, everything before it minus modifiers is the
 * return type + name; the last token before `(` is the method name. The text
 * between the first `(` and the matching `)` is the parameter list.
 */
function parseMethod(decl) {
  const clean = stripExtendedAttributes(decl);
  const openParen = clean.indexOf('(');
  if (openParen === -1) return null;

  const head = clean.slice(0, openParen).trim();
  const headTokens = head.split(/\s+/).filter(Boolean);
  if (headTokens.length < 2) return null;

  const methodName = headTokens[headTokens.length - 1];
  const returnType = headTokens.slice(0, -1).join(' ');

  // Find the matching close paren starting from openParen.
  let depth = 0;
  let closeParen = -1;
  for (let i = openParen; i < clean.length; i++) {
    if (clean[i] === '(') depth++;
    else if (clean[i] === ')') {
      depth--;
      if (depth === 0) {
        closeParen = i;
        break;
      }
    }
  }
  if (closeParen === -1) return null;

  const paramSrc = clean.slice(openParen + 1, closeParen);
  const rawParams = splitParameters(paramSrc);
  const params = rawParams.map(parseParameter).filter(Boolean);

  return { kind: 'method', name: methodName, returnType, parameters: params };
}

/**
 * Decide whether a declaration is a method or an attribute.
 *
 * A declaration with a `(` before any `;` is treated as a method; otherwise
 * we try it as an attribute. We check for `(` first because attribute names
 * cannot contain parentheses in valid Web IDL.
 */
function classifyAndParse(decl) {
  const semi = decl.indexOf(';');
  const paren = decl.indexOf('(');

  if (paren >= 0 && (semi < 0 || paren < semi)) {
    return parseMethod(decl);
  }
  return parseAttribute(decl);
}

/**
 * Public entry point. Parse a single Web IDL interface definition and return
 * its name, attribute members, and method members.
 *
 * @param {string} source - Raw Web IDL text containing an interface block.
 * @returns {{name: string|null, attributes: Array, methods: Array}}
 */
export function parseInterface(source) {
  if (typeof source !== 'string') {
    return { name: null, attributes: [], methods: [] };
  }

  const noComments = stripBlockComments(source);
  const name = extractInterfaceName(noComments);
  if (!name) {
    return { name: null, attributes: [], methods: [] };
  }

  const body = extractBody(noComments);
  const normalized = normalizeWhitespace(body);

  // Split on semicolons; each non-empty fragment is a member declaration.
  // Trailing text without a semicolon is still attempted so that un-terminated
  // interfaces do not silently drop their last member.
  const fragments = normalized.split(';');

  const attributes = [];
  const methods = [];

  for (const frag of fragments) {
    const t = frag.trim();
    if (!t) continue;

    const member = classifyAndParse(t);
    if (!member) continue;

    if (member.kind === 'attribute') {
      attributes.push({ name: member.name, type: member.type, readonly: member.readonly });
    } else if (member.kind === 'method') {
      methods.push({
        name: member.name,
        returnType: member.returnType,
        parameters: member.parameters,
      });
    }
  }

  return { name, attributes, methods };
}
