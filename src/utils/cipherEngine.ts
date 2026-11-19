import { parseFlexibleCoordinateInput } from './geoMath';

export type CipherType =
  | 'caesar'
  | 'rot13'
  | 'morse'
  | 'a1z26'
  | 'base64'
  | 'reverse'
  | 'atbash'
  | 'coord'
  | 'manual';

export interface DetectedCoord {
  lat: number;
  lon: number;
  format: string;
}

export interface CaesarCandidate {
  shift: number;
  encryptShift: number;
  output: string;
  score: number;
  isLikely: boolean;
  coord: DetectedCoord | null;
}

export interface SolvedCipherEntry {
  id: string;
  title: string;
  cipherType: CipherType;
  rawInput: string;
  output: string;
  createdAt: number;
  coord?: DetectedCoord;
}

const CIPHER_HISTORY_KEY = 'dinh_solved_ciphers_v1';

export const MORSE_TABLE: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  '!': '-.-.--',
  '/': '-..-.',
  '-': '-....-',
  '+': '.-.-.',
  '=': '-...-',
  ':': '---...',
  '@': '.--.-.',
  '(': '-.--.',
  ')': '-.--.-'
};

const REVERSE_MORSE_TABLE: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE_TABLE).map(([ch, code]) => [code, ch])
);

const TACTICAL_HINT_WORDS = [
  'TRAM',
  'DINH',
  'NUI',
  'SUOI',
  'CHUA',
  'HANG',
  'BAC',
  'NAM',
  'DONG',
  'TAY',
  'BUOC',
  'MET',
  'CAY',
  'DA',
  'MAT',
  'THU',
  'TIM',
  'DUONG',
  'NGUOC',
  'LA',
  'BAN',
  'BAO',
  'QUAN',
  'TIEN',
  'XANH',
  'HO',
  'TO',
  'PHUONG',
  'MAI',
  'HUONG',
  'DI',
  'DEN',
  'TOI',
  'RE',
  'TRAI',
  'PHAI',
  'THANG',
  'DOC',
  'CAU',
  'MON',
  'MOC',
  'GOC',
  'CHECK',
  'POINT',
  'NORTH',
  'SOUTH',
  'EAST',
  'WEST',
  'WATER',
  'CAMP',
  'ROCK',
  'TRAIL',
  'GO',
  'TO',
  'THE',
  'AND',
  'FIND',
  'KEY',
  'CODE',
  'FLAG'
];

export function caesarTransform(text: string, shift: number): string {
  const norm = ((Math.trunc(shift) % 26) + 26) % 26;
  if (norm === 0) return text;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      out += String.fromCharCode(((code - 65 + norm) % 26) + 65);
    } else if (code >= 97 && code <= 122) {
      out += String.fromCharCode(((code - 97 + norm) % 26) + 97);
    } else {
      out += text[i];
    }
  }
  return out;
}

export function decodeRot13(text: string): string {
  return caesarTransform(text, 13);
}

export function decodeAtbash(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      out += String.fromCharCode(90 - (code - 65));
    } else if (code >= 97 && code <= 122) {
      out += String.fromCharCode(122 - (code - 97));
    } else {
      out += text[i];
    }
  }
  return out;
}

export function reverseText(text: string): { full: string; words: string } {
  const full = Array.from(text).reverse().join('');
  const words = text
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : Array.from(part).reverse().join('')))
    .join('');
  return { full, words };
}

export function scorePlaintextLikelihood(text: string): { score: number; coord: DetectedCoord | null } {
  const coord = detectCoordinateInText(text);
  const upper = text.toUpperCase();
  const tokens = upper.split(/[^A-Z0-9]+/).filter(Boolean);
  let score = coord ? 40 : 0;

  for (const tok of tokens) {
    if (TACTICAL_HINT_WORDS.includes(tok)) {
      score += 18;
    } else if (tok.length >= 4 && TACTICAL_HINT_WORDS.some((w) => w.length >= 3 && tok.includes(w))) {
      score += 6;
    }
  }

  const letters = upper.replace(/[^A-Z]/g, '');
  if (letters.length > 0) {
    const vowels = letters.match(/[AEIOU]/g)?.length ?? 0;
    const ratio = vowels / letters.length;
    if (ratio >= 0.24 && ratio <= 0.56) score += 8;
    const commonPairs = (letters.match(/(TH|CH|NG|NH|TR|PH|AN|ON|IN|EN|ER|RE|TO|AT)/g) || []).length;
    score += commonPairs * 2;
  }

  return { score, coord };
}

export function bruteForceCaesar25(text: string): CaesarCandidate[] {
  const list: CaesarCandidate[] = [];
  for (let shift = 1; shift <= 25; shift++) {
    const output = caesarTransform(text, -shift);
    const { score, coord } = scorePlaintextLikelihood(output);
    list.push({
      shift,
      encryptShift: 26 - shift,
      output,
      score,
      isLikely: false,
      coord
    });
  }
  const topScore = Math.max(...list.map((c) => c.score));
  if (topScore >= 14) {
    for (const item of list) {
      if (item.score >= Math.max(14, topScore - 4)) {
        item.isLikely = true;
      }
    }
  }
  return list;
}

export function decodeMorse(text: string): string {
  const normalized = text
    .trim()
    .replace(/[·•*]/g, '.')
    .replace(/[–—_]/g, '-');
  if (!normalized || !/[.-]/.test(normalized)) return '';

  const words = normalized.split(/\s*(?:\/|\||\n|\s{3,})\s*/);
  return words
    .map((word) =>
      word
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((sym) => REVERSE_MORSE_TABLE[sym] ?? '?')
        .join('')
    )
    .filter(Boolean)
    .join(' ');
}

export function encodeMorse(text: string): string {
  const clean = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd')
    .toUpperCase()
    .trim();
  if (!clean) return '';
  return clean
    .split(/\s+/)
    .map((word) =>
      Array.from(word)
        .map((ch) => MORSE_TABLE[ch] ?? '')
        .filter(Boolean)
        .join(' ')
    )
    .filter(Boolean)
    .join(' / ');
}

export function decodeA1Z26(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || !/\d/.test(trimmed)) return '';
  const words = trimmed.split(/\s*(?:\/|;|\||\n|\s{2,})\s*/);
  const decodedWords = words
    .map((word) => {
      const nums = word.match(/\d+/g);
      if (!nums || nums.length === 0) return '';
      return nums
        .map((token) => {
          const n = parseInt(token, 10);
          if (n >= 1 && n <= 26) return String.fromCharCode(64 + n);
          return `[${token}]`;
        })
        .join('');
    })
    .filter(Boolean);
  return decodedWords.join(' ');
}

export function encodeA1Z26(text: string): string {
  const clean = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd')
    .toUpperCase()
    .trim();
  if (!clean || !/[A-Z]/.test(clean)) return '';
  return clean
    .split(/\s+/)
    .map((word) =>
      Array.from(word)
        .map((ch) => {
          const c = ch.charCodeAt(0);
          if (c >= 65 && c <= 90) return String(c - 64);
          return '';
        })
        .filter(Boolean)
        .join('-')
    )
    .filter(Boolean)
    .join(' / ');
}

export function decodeBase64(text: string): string | null {
  const compact = text.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (compact.length < 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  const padLen = (4 - (compact.length % 4)) % 4;
  if (padLen === 3) return null;
  const padded = compact + '='.repeat(padLen);
  try {
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!decoded || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function encodeBase64(text: string): string {
  if (!text) return '';
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

export function detectCoordinateInText(text: string): DetectedCoord | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const direct = parseFlexibleCoordinateInput(trimmed);
  if (direct) return direct;

  const patterns = [
    /https?:\/\/[^\s]+/gi,
    /\d{1,2}\s*[°º]\s*\d{1,2}\s*['′]\s*\d{1,2}(?:\.\d+)?\s*["″]?\s*[NSns][,\s]+\d{1,3}\s*[°º]\s*\d{1,2}\s*['′]\s*\d{1,2}(?:\.\d+)?\s*["″]?\s*[EWew]/g,
    /\d{1,2}\s*[°º]\s*\d{1,2}\.\d+\s*['′]?\s*[NSns][,\s]+\d{1,3}\s*[°º]\s*\d{1,2}\.\d+\s*['′]?\s*[EWew]/g,
    /-?\d{1,3}\.\d{3,}[,\s]+-?\d{1,3}\.\d{3,}/g,
    /\b[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3}\b/gi
  ];

  for (const re of patterns) {
    const matches = trimmed.match(re);
    if (!matches) continue;
    for (const candidate of matches) {
      const parsed = parseFlexibleCoordinateInput(candidate);
      if (parsed) return parsed;
    }
  }
  return null;
}

export function playMorseAudio(morseText: string): void {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  const ctx = new AudioCtx();
  const unit = 0.068;
  let t = ctx.currentTime + 0.03;

  const normalized = morseText.replace(/[·•*]/g, '.').replace(/[–—_]/g, '-');
  for (const ch of normalized) {
    if (ch === '.' || ch === '-') {
      const dur = ch === '.' ? unit : unit * 3;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 700;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.008);
      gain.gain.setValueAtTime(0.18, Math.max(t + 0.008, t + dur - 0.008));
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.01);
      t += dur + unit;
    } else if (ch === ' ') {
      t += unit * 2.5;
    } else if (ch === '/' || ch === '|') {
      t += unit * 5;
    }
  }
  window.setTimeout(() => ctx.close().catch(() => {}), Math.ceil((t - ctx.currentTime) * 1000) + 200);
}

export function loadSolvedCiphers(): SolvedCipherEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CIPHER_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SolvedCipherEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveSolvedCipher(
  entry: Omit<SolvedCipherEntry, 'id' | 'createdAt'>
): SolvedCipherEntry[] {
  const next: SolvedCipherEntry = {
    ...entry,
    id: `ciph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now()
  };
  const updated = [next, ...loadSolvedCiphers()].slice(0, 60);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(CIPHER_HISTORY_KEY, JSON.stringify(updated));
    } catch {
      // ignore storage quota errors
    }
  }
  return updated;
}

export function deleteSolvedCipher(id: string): SolvedCipherEntry[] {
  const updated = loadSolvedCiphers().filter((item) => item.id !== id);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(CIPHER_HISTORY_KEY, JSON.stringify(updated));
    } catch {
      // ignore storage errors
    }
  }
  return updated;
}

export function clearSolvedCiphers(): SolvedCipherEntry[] {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(CIPHER_HISTORY_KEY);
    } catch {
      // ignore
    }
  }
  return [];
}

/**
 * Safe recursive-descent mathematical expression evaluator (degrees for trig functions).
 */
export function evaluateMathExpression(rawExpr: string): number | null {
  const expr = rawExpr
    .trim()
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/π/gi, 'pi');
  if (!expr) return null;

  type Token =
    | { type: 'num'; val: number }
    | { type: 'id'; val: string }
    | { type: 'op'; val: string };

  const tokens: Token[] = [];
  let idx = 0;
  while (idx < expr.length) {
    const ch = expr[idx];
    if (/\s/.test(ch)) {
      idx++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = '';
      while (idx < expr.length && /[0-9.]/.test(expr[idx])) {
        numStr += expr[idx++];
      }
      const val = Number(numStr);
      if (!Number.isFinite(val)) return null;
      tokens.push({ type: 'num', val });
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      let idStr = '';
      while (idx < expr.length && /[a-zA-Z0-9]/.test(expr[idx])) {
        idStr += expr[idx++];
      }
      const lower = idStr.toLowerCase();
      const prev = tokens[tokens.length - 1];
      if (prev && (prev.type === 'num' || (prev.type === 'op' && prev.val === ')'))) {
        tokens.push({ type: 'op', val: '*' });
      }
      if (lower === 'pi') {
        tokens.push({ type: 'num', val: Math.PI });
      } else if (lower === 'e') {
        tokens.push({ type: 'num', val: Math.E });
      } else {
        tokens.push({ type: 'id', val: lower });
      }
      continue;
    }
    if ('+-*/^%()'.includes(ch)) {
      const prev = tokens[tokens.length - 1];
      if (ch === '(' && prev && (prev.type === 'num' || (prev.type === 'op' && prev.val === ')'))) {
        tokens.push({ type: 'op', val: '*' });
      }
      tokens.push({ type: 'op', val: ch });
      idx++;
      continue;
    }
    return null;
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  const parseAddSub = (): number | null => {
    let left = parseMulDiv();
    if (left === null) return null;
    while (peek()?.type === 'op' && (peek()!.val === '+' || peek()!.val === '-')) {
      const op = consume().val;
      const right = parseMulDiv();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const parseMulDiv = (): number | null => {
    let left = parsePow();
    if (left === null) return null;
    while (peek()?.type === 'op' && (peek()!.val === '*' || peek()!.val === '/' || peek()!.val === '%')) {
      const op = consume().val;
      const right = parsePow();
      if (right === null) return null;
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) return null;
        left /= right;
      } else {
        if (right === 0) return null;
        left %= right;
      }
    }
    return left;
  };

  const parsePow = (): number | null => {
    const base = parseUnary();
    if (base === null) return null;
    if (peek()?.type === 'op' && peek()!.val === '^') {
      consume();
      const exp = parsePow();
      if (exp === null) return null;
      return Math.pow(base, exp);
    }
    return base;
  };

  const parseUnary = (): number | null => {
    if (peek()?.type === 'op' && (peek()!.val === '+' || peek()!.val === '-')) {
      const op = consume().val;
      const inner = parseUnary();
      if (inner === null) return null;
      return op === '-' ? -inner : inner;
    }
    return parsePrimary();
  };

  const parsePrimary = (): number | null => {
    const tok = peek();
    if (!tok) return null;
    if (tok.type === 'num') {
      consume();
      return tok.val;
    }
    if (tok.type === 'op' && tok.val === '(') {
      consume();
      const inside = parseAddSub();
      if (inside === null || peek()?.type !== 'op' || peek()!.val !== ')') return null;
      consume();
      return inside;
    }
    if (tok.type === 'id') {
      const fn = consume().val as string;
      if (peek()?.type !== 'op' || peek()!.val !== '(') return null;
      consume();
      const arg = parseAddSub();
      if (arg === null || peek()?.type !== 'op' || peek()!.val !== ')') return null;
      consume();
      const degToRad = Math.PI / 180;
      const radToDeg = 180 / Math.PI;
      switch (fn) {
        case 'sin':
          return Math.sin(arg * degToRad);
        case 'cos':
          return Math.cos(arg * degToRad);
        case 'tan':
          return Math.tan(arg * degToRad);
        case 'asin':
          return Math.asin(arg) * radToDeg;
        case 'acos':
          return Math.acos(arg) * radToDeg;
        case 'atan':
          return Math.atan(arg) * radToDeg;
        case 'sqrt':
          return arg < 0 ? null : Math.sqrt(arg);
        case 'abs':
          return Math.abs(arg);
        case 'log':
          return arg <= 0 ? null : Math.log10(arg);
        case 'ln':
          return arg <= 0 ? null : Math.log(arg);
        default:
          return null;
      }
    }
    return null;
  };

  const result = parseAddSub();
  if (result === null || pos !== tokens.length || !Number.isFinite(result)) return null;
  return result;
}
