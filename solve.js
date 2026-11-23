// A faster drop-in for makefun-site 1.0.0: run(input) returns exactly what
// makefun-site 1.0.0's build returns for the same input, with the same rules
// (front matter, template dialect, Markdown subset, slug rule, report) and the
// same output tree, byte for byte.

// ---------------------------------------------------------------- text rules

const AMP = 38, LT = 60, GT = 62, QUOT = 34, APOS = 39;
const NEEDS_ESCAPE = /[&<>"']/;

/** `text` with & < > " and ' escaped, in the reference's order. */
function escapeHtml(text) {
  if (!NEEDS_ESCAPE.test(text)) return text;
  let out = '';
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let rep;
    if (c === AMP) rep = '&amp;';
    else if (c === LT) rep = '&lt;';
    else if (c === GT) rep = '&gt;';
    else if (c === QUOT) rep = '&quot;';
    else if (c === APOS) rep = '&#39;';
    else continue;
    out += text.slice(last, i) + rep;
    last = i + 1;
  }
  return last === 0 ? text : out + text.slice(last);
}

/** Whether a UTF-16 code unit is whitespace in JavaScript's \s sense. */
function isWsCode(c) {
  if (c === 32 || (c >= 9 && c <= 13)) return true;
  if (c < 128) return false;
  return c === 160 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}

const SLUG_MAX = 64;

/** The slug of `text`, as makefun-site's slug rule states it. */
function slugify(text) {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

/** slugify memoised: the rule is pure, and tag names repeat across a site. */
const slugCache = new Map();
function slugifyCached(text) {
  let s = slugCache.get(text);
  if (s === undefined) {
    s = slugify(text);
    slugCache.set(text, s);
  }
  return s;
}

/** `slug` made unique against `taken` (and added to it). */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, memoised (the same dates repeat across a site). */
const dateCache = new Map();
function longDate(date) {
  let out = dateCache.get(date);
  if (out === undefined) {
    const [y, m, d] = date.split('-');
    out = `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
    dateCache.set(date, out);
  }
  return out;
}

// ---------------------------------------------------------------- front matter

const KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME = /^[a-z0-9-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === QUOT) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== QUOT) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

const LINE = /^([a-z_]+):(?: (.*))?$/;
const EMPTY_LINES = [];
const BLANK_LINE = /^[ \t]*$/;

/** A source's front matter and body, or the first reason it is refused. */
function parseFrontMatter(text) {
  const n = text.length;
  if (n < 3 || text.charCodeAt(0) !== 45 || text.charCodeAt(1) !== 45 || text.charCodeAt(2) !== 45 || (n > 3 && text.charCodeAt(3) !== 10)) {
    return { error: 'no front matter' };
  }
  // The first line that is exactly "---" closes the front matter.
  let q = -1;
  for (let from = 3; ; ) {
    const k = text.indexOf('\n---', from);
    if (k === -1) break;
    if (k + 4 === n || text.charCodeAt(k + 4) === 10) {
      q = k;
      break;
    }
    from = k + 1;
  }
  if (q === -1) return { error: 'the front matter is not closed' };
  const fmText = text.slice(4, q + 1);
  const fmLines = fmText === '' ? EMPTY_LINES : fmText.split('\n');
  const data = {};
  for (let j = 0; j < fmLines.length; j++) {
    const line = fmLines[j];
    if (BLANK_LINE.test(line) || line.charCodeAt(0) === 35) continue;
    const m = LINE.exec(line);
    if (!m) return { error: `line ${j + 2} is not "key: value"` };
    const key = m[1];
    const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
    if (!KEYS.has(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  const body = q + 4 === n ? '' : text.slice(q + 5);
  return { data, body };
}


// ---------------------------------------------------------------- markdown

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const INLINE_SPECIAL = /[\\`*\[]/;

function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/** `s`'s code units from `from` to `to`, & < > " ' escaped, pushed into `out`. */
function escapeRange(s, from, to, out) {
  let last = from;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    let rep;
    if (c === AMP) rep = '&amp;';
    else if (c === LT) rep = '&lt;';
    else if (c === GT) rep = '&gt;';
    else if (c === QUOT) rep = '&quot;';
    else if (c === APOS) rep = '&#39;';
    else continue;
    if (i > last) out.push(s.slice(last, i));
    out.push(rep);
    last = i + 1;
  }
  if (last < to) out.push(s.slice(last, to));
}

const SPECIAL_G = /[\\`*\[]/g;

/** `s` rendered inline; `env.link(target)` is a link's href. */
function inline(s, env) {
  if (!INLINE_SPECIAL.test(s)) return escapeHtml(s);
  const out = [];
  inlineInto(s, env, out);
  return out.join('');
}

/** `s` rendered inline, its pieces pushed into `out`. */
function inlineInto(s, env, out) {
  let last = 0;
  const n = s.length;
  SPECIAL_G.lastIndex = 0;
  let m;
  while ((m = SPECIAL_G.exec(s)) !== null) {
    const i = m.index;
    if (i > last) escapeRange(s, last, i, out);
    const c = s.charCodeAt(i);
    if (c === 92) {
      if (i + 1 < n && ESCAPABLE.has(s[i + 1])) {
        out.push(escapeHtml(s[i + 1]));
        last = i + 2;
      } else {
        out.push('\\');
        last = i + 1;
      }
    } else if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        out.push('<code>');
        escapeRange(s, i + 1, j, out);
        out.push('</code>');
        last = j + 1;
      } else {
        out.push('`');
        last = i + 1;
      }
    } else if (c === 42) {
      if (s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          out.push('<strong>');
          inlineInto(s.slice(i + 2, j), env, out);
          out.push('</strong>');
          last = j + 2;
        } else {
          out.push('**');
          last = i + 2;
        }
      } else {
        const j = findSingleStar(s, i + 1);
        if (j > i + 1) {
          out.push('<em>');
          inlineInto(s.slice(i + 1, j), env, out);
          out.push('</em>');
          last = j + 1;
        } else {
          out.push('*');
          last = i + 1;
        }
      }
    } else {
      // '['
      const k = findUnescaped(s, ']', i + 1);
      const mm = k !== -1 && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      const target = mm === -1 ? '' : s.slice(k + 2, mm);
      if (target !== '' && !/\s/.test(target)) {
        out.push('<a href="');
        out.push(escapeHtml(env.link(target)));
        out.push('">');
        inlineInto(s.slice(i + 1, k), env, out);
        out.push('</a>');
        last = mm + 1;
      } else {
        out.push('[');
        last = i + 1;
      }
    }
    SPECIAL_G.lastIndex = last;
  }
  if (last < n) escapeRange(s, last, n, out);
}

/** Whether `line` is only spaces and tabs (a blank line). */
function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A fence line's language (`""` for a bare fence), or null when the line does not open a fence. */
function fenceOpen(line) {
  if (line.length < 3 || line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  const n = line.length;
  let j = 3;
  while (j < n) {
    const c = line.charCodeAt(j);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) j++;
    else break;
  }
  const lang = line.slice(3, j);
  while (j < n) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return null;
    j++;
  }
  return lang;
}

/** A heading line's level and text, or null (a heading's text is never empty). */
function headingOf(line) {
  if (line.charCodeAt(0) !== 35) return null;
  const n = line.length;
  let d = 0;
  while (d < n && line.charCodeAt(d) === 35) {
    d++;
    if (d > 6) return null;
  }
  if (d >= n) return null;
  const c = line.charCodeAt(d);
  if (c !== 32 && c !== 9) return null;
  let a = d;
  while (a < n && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  let b = n;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  if (b <= a) return null;
  return { depth: d, text: line.slice(a, b) };
}

/** Whether `line` is a thematic break: "---" or "***" and spaces or tabs. */
function isHr(line) {
  const c = line.charCodeAt(0);
  if (c !== 45 && c !== 42) return false;
  if (line.charCodeAt(1) !== c || line.charCodeAt(2) !== c) return false;
  for (let i = 3; i < line.length; i++) {
    const d = line.charCodeAt(i);
    if (d !== 32 && d !== 9) return false;
  }
  return true;
}

/** A paragraph line as it is rendered: spaces and tabs at either end dropped. */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b) {
    const c = line.charCodeAt(a);
    if (c !== 32 && c !== 9) break;
    a++;
  }
  while (b > a) {
    const c = line.charCodeAt(b - 1);
    if (c !== 32 && c !== 9) break;
    b--;
  }
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

/** A bullet list item's text, or null when the line is no bullet item. */
function bulletOf(line) {
  const c = line.charCodeAt(0);
  if ((c === 45 || c === 42) && line.charCodeAt(1) === 32) return line.slice(2);
  return null;
}

/** An ordered list item's start number and text, or null. */
function orderedOf(line) {
  const n = line.length;
  let j = 0;
  while (j < n) {
    const c = line.charCodeAt(j);
    if (c < 48 || c > 57) break;
    j++;
    if (j > 9) return null;
  }
  if (j === 0) return null;
  if (line.charCodeAt(j) !== 46 || line.charCodeAt(j + 1) !== 32) return null;
  return { start: Number(line.slice(0, j)), text: line.slice(j + 2) };
}

/** Whether `line` continues a list item: two spaces and a non-space. */
function isContinued(line) {
  if (line.charCodeAt(0) !== 32 || line.charCodeAt(1) !== 32 || line.length <= 2) return false;
  const c = line.charCodeAt(2);
  return c === 32 || (c >= 9 && c <= 13) ? false : c < 128 ? true : !isWsCode(c);
}

/** Whether `line` ends a paragraph: a blank line, a fence, a heading or a thematic break. */
function endsParagraph(line) {
  return isBlank(line) || fenceOpen(line) !== null || headingOf(line) !== null || isHr(line);
}

/** `src` rendered: its HTML, its table of contents and its excerpt. */
function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const L = lines.length;
  const ids = new Set();
  const toc = [];
  let excerpt = null;
  let html = '';
  let i = 0;
  while (i < L) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const lang = fenceOpen(line);
    if (lang !== null) {
      i++;
      let body = '';
      while (i < L && fenceOpen(lines[i]) !== '') {
        body += `${escapeHtml(lines[i])}\n`;
        i++;
      }
      i++;
      const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
      html += `<pre><code${cls}>${body}</code></pre>\n`;
      continue;
    }
    const h = headingOf(line);
    if (h !== null) {
      const id = uniqueSlug(slugifyCached(h.text), ids);
      const inner = inline(h.text, env);
      html += `<h${h.depth} id="${id}">${inner}</h${h.depth}>\n`;
      if (h.depth === 2 || h.depth === 3) toc.push({ level: h.depth, id, html: inner });
      i++;
      continue;
    }
    if (isHr(line)) {
      html += '<hr>\n';
      i++;
      continue;
    }
    if (line.charCodeAt(0) === 62) {
      const body = [];
      while (i < L && lines[i].charCodeAt(0) === 62) {
        let q = lines[i].slice(1);
        if (q.charCodeAt(0) === 32) q = q.slice(1);
        q = trimLine(q);
        if (q !== '') body.push(q);
        i++;
      }
      html += (body.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(body.join('\n'), env)}</p>\n</blockquote>`) + '\n';
      continue;
    }
    const firstBullet = bulletOf(line);
    const firstOrdered = firstBullet === null ? orderedOf(line) : null;
    if (firstBullet !== null || firstOrdered !== null) {
      const isOrdered = firstOrdered !== null;
      const start = isOrdered ? firstOrdered.start : 1;
      const items = [];
      while (i < L) {
        const ln = lines[i];
        const m = isOrdered ? orderedOf(ln) : bulletOf(ln);
        if (m !== null) {
          items.push(trimLine(isOrdered ? m.text : m));
          i++;
        } else if (isContinued(ln)) {
          items[items.length - 1] += `\n${trimLine(ln)}`;
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
      let body = '';
      for (let k = 0; k < items.length; k++) body += `<li>${inline(items[k], env)}</li>\n`;
      html += `${open}\n${body}</${tag}>\n`;
      continue;
    }
    let text = trimLine(line);
    i++;
    while (i < L && !endsParagraph(lines[i])) {
      text += `\n${trimLine(lines[i])}`;
      i++;
    }
    const inner = inline(text, env);
    if (excerpt === null) excerpt = inner;
    html += `<p>${inner}</p>\n`;
  }
  return { html, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

const INCLUDE_DEPTH = 8;

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

function lookup(scope, path) {
  if (!Object.hasOwn(scope, path[0])) return undefined;
  let v = scope[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

// The renderer pushes strings into `out` and keeps one flat scope object: a for
// saves its variable and `loop` before its body and restores them after, so an
// iteration costs no scope object. (A `for loop in ...` collides with `loop`
// exactly as the reference's object literal does: the loop object wins.)
function renderNodes(nodes, scope, ctx, depth, out) {
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    switch (n.kind) {
      case 'text':
        out.push(n.text);
        break;
      case 'var':
        out.push(ctx.escape(textOf(lookup(scope, n.path))));
        break;
      case 'raw':
        out.push(textOf(lookup(scope, n.path)));
        break;
      case 'if': {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) renderNodes(branch, scope, ctx, depth, out);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        const name = n.name;
        const hadName = Object.hasOwn(scope, name);
        const oldName = scope[name];
        const hadLoop = Object.hasOwn(scope, 'loop');
        const oldLoop = scope.loop;
        for (let j = 0; j < xs.length; j++) {
          scope[name] = xs[j];
          scope.loop = { index: j + 1, first: j === 0, last: j === xs.length - 1, length: xs.length };
          renderNodes(n.body, scope, ctx, depth, out);
        }
        if (hadName) scope[name] = oldName; else delete scope[name];
        if (hadLoop) scope.loop = oldLoop; else delete scope.loop;
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) renderNodes(t, scope, ctx, depth + 1, out);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- the build

const REPORT_FILE = 'build-report.txt';
const RESERVED = Object.freeze(['posts', 'tags', 'page']);
const RESERVED_SET = new Set(RESERVED);

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The words of a body: its runs of characters other than whitespace. */
function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const ws = c === 32 || (c >= 9 && c <= 13) ? true : c < 128 ? false : isWsCode(c);
    if (ws) inWord = false;
    else if (!inWord) { n++; inWord = true; }
  }
  return n;
}

function resolvePath(dir, rel) {
  if (rel.indexOf('.') === -1 && rel.indexOf('//') === -1) return dir === '' ? rel : `${dir}/${rel}`;
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function readSources(b) {
  const files = b.input.files.slice().sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    if (f.path.endsWith('.md')) b.sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else b.statics.push({ path: f.path, content: f.content });
  }
}

function frontMatter(b) {
  const kept = [];
  for (const s of b.sources) {
    const fm = parseFrontMatter(s.text);
    if (fm.error !== undefined) {
      b.report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own;
    for (let i = 1; i < RESERVED.length; i++) {
      if (s.path.startsWith(`${RESERVED[i]}/`)) { own = RESERVED[i]; break; }
    }
    if (own !== undefined) {
      b.report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      b.report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!b.templates.has(layout)) {
      b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      b.report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  b.sources = kept;
}

function permalinks(b) {
  const taken = new Map();
  const takenIn = (dir) => {
    if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : []));
    return taken.get(dir);
  };
  for (const s of b.sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugifyCached(s.data.title), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${b.base}/${s.outDir}/`;
    b.bySource.set(s.path, s);
  }
}

function markdown(b) {
  const staticPaths = new Set(b.statics.map((f) => f.path));
  // A target's href depends only on the source's directory and the build, so a
  // build keeps one resolution per (dir, target); a broken target still records
  // one report line per source that names it.
  const linkCache = new Map();
  const resolveLink = (dir, path, target) => {
    const key = `${dir}\u0000${target}`;
    let r = linkCache.get(key);
    if (r === undefined) {
      const c0 = target.charCodeAt(0);
      if ((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122)) {
        // a scheme like "https:" or a plain relative path: check the scheme
        const m = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(target);
        if (m !== null) {
          linkCache.set(key, { href: target });
          return target;
        }
      }
      if (c0 === 47 || c0 === 35) {
        linkCache.set(key, { href: target });
        return target;
      }
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const p = rel === '' ? null : resolvePath(dir, rel);
      if (p !== null && b.bySource.has(p)) {
        r = { href: `${b.bySource.get(p).url}${frag}` };
      } else if (p !== null && staticPaths.has(p)) {
        r = { href: `${b.base}/${p}${frag}` };
      } else {
        r = { href: target, broken: true };
      }
      linkCache.set(key, r);
    }
    if (r.broken) b.broken.add(`broken-link ${path} -> ${target}`);
    return r.href;
  };
  for (const s of b.sources) {
    const dir = dirOf(s.path);
    const env = { link: (target) => resolveLink(dir, s.path, target) };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }
}

function collections(b) {
  const posts = b.sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  b.posts = posts;
  for (let k = 0; k < posts.length; k++) {
    const p = posts[k];
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  }
}

function tags(b) {
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    const list = s.data.tags ?? [];
    for (let i = 0; i < list.length; i++) {
      const name = list[i];
      const slug = slugifyCached(name);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of b.posts) {
    p.tagRefs = [];
    const names = ownTags(p);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const slug = slugifyCached(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of b.sources) {
    if (s.post) continue;
    const names = ownTags(s);
    const refs = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const slug = slugifyCached(name);
      refs.push(bySlug.get(slug) ?? { name, slug, url: '', posts: [] });
    }
    s.tagRefs = refs;
  }
  b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
}

const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });

const tagOf = (b, t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => b.cards.get(p)) });

/** A source's card, as lists show it (built once: pageOf and the lists share it). */
function cardOf(s) {
  let card = s.card;
  if (card !== undefined) return card;
  card = {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
  s.card = card;
  return card;
}

function pageOf(s) {
  return {
    ...cardOf(s),
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  };
}

function layouts(b) {
  b.cards = new Map(b.posts.map((p) => [p, cardOf(p)]));
  const site = { title: b.input.site.title, base_url: b.base };
  const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = b.posts.slice(0, b.input.site.recent).map((p) => b.cards.get(p));
  const ctx = { templates: b.templates, escape: escapeHtml };
  const render = (name, vars) => {
    const nodes = b.templates.get(name);
    if (nodes === undefined) return null;
    const scope = Object.assign(Object.create(null), { site, tags: allTags, recent }, vars);
    const out = [];
    renderNodes(nodes, scope, ctx, 0, out);
    return out.join('');
  };
  for (const s of b.sources) b.output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = b.input.site.per_page;
  const pages = Math.max(1, Math.ceil(b.posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${b.base}/` : `${b.base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: b.posts.slice((k - 1) * per, k * per).map((p) => b.cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) b.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of b.tags) {
    const html = render('tag', { tag: tagOf(b, t) });
    if (html !== null) b.output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
  for (const f of b.statics) {
    if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
    else b.output[f.path] = f.content;
  }
}

function report(b) {
  const lines = [...b.report, ...b.broken].sort(byCodeUnits);
  const pages = b.sources.filter((s) => !s.post).length;
  lines.push(`built ${pages} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
  b.output[REPORT_FILE] = `${lines.join('\n')}\n`;
}

/** One site's output tree: path -> text. */
export function run(input) {
  const prof = typeof process !== 'undefined' && process.env.SOLVE_PROF === '1';
  let t = 0;
  const lap = (label) => {
    if (!prof) return;
    const u = process.cpuUsage();
    const n = (u.user + u.system) / 1000;
    if (t !== 0) console.error(`prof ${label} ${(n - t).toFixed(0)}`);
    t = n;
  };
  if (prof) lap('start');
  const templates = new Map();
  const reportLines = [];
  const names = Object.keys(input.templates).sort(byCodeUnits);
  for (const name of names) {
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      reportLines.push(err.message);
    }
  }
  lap('templates');
  const b = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    templates,
    sources: [],
    statics: [],
    bySource: new Map(),
    broken: new Set(),
    report: reportLines,
    posts: [],
    tags: [],
    cards: new Map(),
    output: {},
  };
  readSources(b);
  lap('readSources');
  frontMatter(b);
  lap('frontMatter');
  permalinks(b);
  lap('permalinks');
  markdown(b);
  lap('markdown');
  collections(b);
  lap('collections');
  tags(b);
  lap('tags');
  layouts(b);
  lap('layouts');
  report(b);
  lap('report');
  return b.output;
}
