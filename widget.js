/**
 * Grist Search Plus Widget - v3 Modern UX
 * Copyright 2026 Said Hamadou (isaytoo)
 * Licensed under the Apache License, Version 2.0
 * https://github.com/isaytoo/grist-search-plus
 */

// ══════════════════════════════════════════════════════════════
// APP STATE
// ══════════════════════════════════════════════════════════════
const APP = {
  records: [],
  columns: [],
  activeCols: new Set(),
  query: '',
  matchMode: 'contains',
  logicMode: 'or',
  ready: false,
  gristReady: false,
  selectedTable: '',
  linkedRecords: [],
  lastMatchedRecords: [],
  sessEnabled: false,
  availableTables: [],
  dateFormat: 'fr',
};

// ══════════════════════════════════════════════════════════════
// DOM ELEMENTS
// ══════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const searchInput = $('searchInput');
const searchClear = $('searchClear');
const colTags = $('colTags');
const tableSelect = $('tableSelect');
const tokenList = $('tokenList');
const modeBadge = $('modeBadge');
const countBadge = $('countBadge');
const resultsArea = $('resultsArea');
const emptyState = $('emptyState');
const resultsTable = $('resultsTable');
const resultsHead = $('resultsHead');
const resultsBody = $('resultsBody');
const loadingState = $('loadingState');
const settingsOverlay = $('settingsOverlay');
const settingsPanel = $('settingsPanel');
const columnsList = $('columnsList');
const helpPanel = $('helpPanel');

// ══════════════════════════════════════════════════════════════
// SEARCH ENGINE
// ══════════════════════════════════════════════════════════════
function parseQuery(raw) {
  const tokens = [];
  let mode = APP.logicMode;
  let s = raw.trim();
  
  // Mode prefix
  if (s.startsWith('&&')) { mode = 'and2'; s = s.slice(2).trim(); }
  else if (s.startsWith('&')) { mode = 'and'; s = s.slice(1).trim(); }
  
  // Tokenize
  const rx = /("([^"]+)"|'(\S+)|\/([^/]+)\/|(\S+))/g;
  let m;
  while ((m = rx.exec(s)) !== null) {
    const rawTok = m[0];
    let word = m[2] || m[3] || m[4] || m[5] || '';
    let negate = false, mod = '', isRx = false, phrase = false, whole = false, cols = [];
    let fuzzy = false, wildcard = false, dateMatch = null, numRange = null;
    
    if (m[2]) phrase = true;
    if (m[3]) { whole = true; word = m[3]; }
    if (m[4]) { isRx = true; word = m[4]; }
    
    // Prefixes
    if (word.startsWith('!')) { negate = true; word = word.slice(1); }
    if (word.startsWith('~')) { fuzzy = true; word = word.slice(1); }
    else if (word.startsWith('=')) { mod = '='; word = word.slice(1); }
    else if (word.startsWith('<') && !word.match(/^<=?\d/)) { mod = '<'; word = word.slice(1); }
    else if (word.startsWith('>') && !word.match(/^>=?\d/)) { mod = '>'; word = word.slice(1); }
    
    // Column scope (but not for @today, @week, etc.)
    const atIdx = word.indexOf('@');
    if (atIdx > 0 && !word.startsWith('@')) {
      cols = word.slice(atIdx + 1).split(',').filter(Boolean);
      word = word.slice(0, atIdx);
    }
    
    // Check for date keywords (@today, @week, @month, @year, @yesterday)
    // Also supports EN (YYYY-MM-DD) and FR (DD-MM-YYYY, DD/MM/YYYY) formats
    const isDatePattern = word.startsWith('@') ||
      word.match(/^[><]=?\d{4}-\d{2}-\d{2}$/) ||  // EN: >2024-01-01
      word.match(/^[><]=?\d{2}[-\/]\d{2}[-\/]\d{4}$/) ||  // FR: >01-01-2024 or >01/01/2024
      word.match(/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/) ||  // EN range
      word.match(/^\d{2}[-\/]\d{2}[-\/]\d{4}\.\.\d{2}[-\/]\d{2}[-\/]\d{4}$/);  // FR range
    if (isDatePattern) {
      dateMatch = parseDateKeyword(word);
    }
    
    // Check for numeric range (10..100, >50, <100, >=50, <=100)
    if (!dateMatch && (word.match(/^\d+(\.\d+)?\.\./) || word.match(/^[><]=?\d/))) {
      numRange = parseNumericRange(word);
    }
    
    // Check for wildcard patterns (* or ?)
    if (!isRx && !dateMatch && !numRange && (word.includes('*') || word.includes('?'))) {
      wildcard = true;
    }
    
    if (word) {
      tokens.push({ raw: rawTok, word, negate, mod, rx: isRx, phrase, whole, cols, fuzzy, wildcard, dateMatch, numRange });
    }
  }
  
  return { tokens, mode };
}

function matchVal(val, tok) {
  const v = val.toLowerCase(), w = tok.word.toLowerCase();
  
  // Regex mode
  if (tok.rx) { try { return new RegExp(w, 'i').test(val); } catch { return false; } }
  
  // Date keywords (@today, @week, etc.) or date comparisons
  if (tok.dateMatch) {
    return matchDate(val, tok.dateMatch);
  }
  
  // Numeric range (10..100, >50, <100)
  if (tok.numRange) {
    return matchNumericRange(val, tok.numRange);
  }
  
  // Wildcard patterns (* and ?)
  if (tok.wildcard) {
    return matchWildcard(val, tok.word);
  }
  
  // Fuzzy search (~word)
  if (tok.fuzzy) {
    return fuzzyMatch(val, tok.word);
  }
  
  // Exact phrase
  if (tok.phrase) return v.includes(w);
  
  // Modifiers
  if (tok.mod === '=') return v === w;
  if (tok.mod === '<') return v.startsWith(w);
  if (tok.mod === '>') return v.endsWith(w);
  
  // Whole word
  if (tok.whole) return new RegExp('(?<![\\w])' + escapeRegex(w) + '(?![\\w])', 'i').test(val);
  
  // Default: contains
  return v.includes(w);
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ══════════════════════════════════════════════════════════════
// FUZZY SEARCH (Levenshtein distance)
// ══════════════════════════════════════════════════════════════
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = a[i-1] === b[j-1]
        ? d[i-1][j-1]
        : Math.min(d[i-1][j-1], d[i][j-1], d[i-1][j]) + 1;
    }
  }
  return d[m][n];
}

function fuzzyMatch(val, word, threshold = 2) {
  const v = val.toLowerCase();
  const w = word.toLowerCase();
  if (v.includes(w)) return true;
  // Check each word in the value
  const words = v.split(/\s+/);
  for (const vw of words) {
    if (vw.length >= 3 && w.length >= 3) {
      const dist = levenshtein(vw.slice(0, Math.max(w.length, 5)), w);
      const maxDist = Math.min(threshold, Math.floor(w.length / 3));
      if (dist <= maxDist) return true;
    }
  }
  return false;
}

// ══════════════════════════════════════════════════════════════
// NUMERIC RANGE MATCHING
// ══════════════════════════════════════════════════════════════
function parseNumericRange(word) {
  // Range: 10..100
  const rangeMatch = word.match(/^(\d+(?:\.\d+)?)\.\.(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    return { type: 'range', min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
  }
  // Greater than: >100 or >=100
  const gtMatch = word.match(/^(>=?)(\d+(?:\.\d+)?)$/);
  if (gtMatch) {
    return { type: gtMatch[1] === '>=' ? 'gte' : 'gt', value: parseFloat(gtMatch[2]) };
  }
  // Less than: <100 or <=100
  const ltMatch = word.match(/^(<=?)(\d+(?:\.\d+)?)$/);
  if (ltMatch) {
    return { type: ltMatch[1] === '<=' ? 'lte' : 'lt', value: parseFloat(ltMatch[2]) };
  }
  return null;
}

function matchNumericRange(val, range) {
  const num = parseFloat(val);
  if (isNaN(num)) return false;
  switch (range.type) {
    case 'range': return num >= range.min && num <= range.max;
    case 'gt': return num > range.value;
    case 'gte': return num >= range.value;
    case 'lt': return num < range.value;
    case 'lte': return num <= range.value;
    default: return false;
  }
}

// ══════════════════════════════════════════════════════════════
// DATE MATCHING
// ══════════════════════════════════════════════════════════════
function parseDateKeyword(word) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const keywords = {
    '@today': () => ({ type: 'exact', date: today }),
    '@yesterday': () => {
      const d = new Date(today); d.setDate(d.getDate() - 1);
      return { type: 'exact', date: d };
    },
    '@week': () => {
      const start = new Date(today);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(start); end.setDate(end.getDate() + 6);
      return { type: 'range', start, end };
    },
    '@month': () => {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { type: 'range', start, end };
    },
    '@year': () => {
      const start = new Date(today.getFullYear(), 0, 1);
      const end = new Date(today.getFullYear(), 11, 31);
      return { type: 'range', start, end };
    },
  };
  
  if (keywords[word.toLowerCase()]) {
    return keywords[word.toLowerCase()]();
  }
  
  // Helper to parse date string (supports EN: YYYY-MM-DD and FR: DD-MM-YYYY or DD/MM/YYYY)
  function parseFlexDate(str) {
    // EN format: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return new Date(str);
    }
    // FR format: DD-MM-YYYY or DD/MM/YYYY
    const frMatch = str.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
    if (frMatch) {
      return new Date(`${frMatch[3]}-${frMatch[2]}-${frMatch[1]}`);
    }
    return null;
  }
  
  // Date comparison: >2024-01-01, <2024-12-31, >=, <= (EN format)
  // Also supports: >01-01-2024, >01/01/2024 (FR format)
  const dateCompMatchEN = word.match(/^([><]=?)(\d{4}-\d{2}-\d{2})$/);
  const dateCompMatchFR = word.match(/^([><]=?)(\d{2}[-\/]\d{2}[-\/]\d{4})$/);
  const dateCompMatch = dateCompMatchEN || dateCompMatchFR;
  if (dateCompMatch) {
    const op = dateCompMatch[1];
    const date = parseFlexDate(dateCompMatch[2]);
    if (date && !isNaN(date.getTime())) {
      date.setHours(0, 0, 0, 0);
      return { type: 'compare', op, date };
    }
  }
  
  // Date range: 2024-01-01..2024-12-31 (EN) or 01-01-2024..31-12-2024 (FR)
  const dateRangeMatchEN = word.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  const dateRangeMatchFR = word.match(/^(\d{2}[-\/]\d{2}[-\/]\d{4})\.\.(\d{2}[-\/]\d{2}[-\/]\d{4})$/);
  const dateRangeMatch = dateRangeMatchEN || dateRangeMatchFR;
  if (dateRangeMatch) {
    const start = parseFlexDate(dateRangeMatch[1]);
    const end = parseFlexDate(dateRangeMatch[2]);
    if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { type: 'range', start, end };
    }
  }
  
  return null;
}

function matchDate(val, dateCond) {
  let d;
  if (typeof val === 'number') {
    // Grist stores dates as Unix timestamps (seconds)
    d = new Date(val * 1000);
  } else if (typeof val === 'string') {
    d = new Date(val);
  } else {
    return false;
  }
  if (isNaN(d.getTime())) return false;
  d.setHours(0, 0, 0, 0);
  
  switch (dateCond.type) {
    case 'exact':
      return d.getTime() === dateCond.date.getTime();
    case 'range':
      return d >= dateCond.start && d <= dateCond.end;
    case 'compare':
      switch (dateCond.op) {
        case '>': return d > dateCond.date;
        case '>=': return d >= dateCond.date;
        case '<': return d < dateCond.date;
        case '<=': return d <= dateCond.date;
      }
  }
  return false;
}

// ══════════════════════════════════════════════════════════════
// WILDCARD MATCHING (* and ?)
// ══════════════════════════════════════════════════════════════
function wildcardToRegex(pattern) {
  // * = any characters, ? = single character
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + regex + '$', 'i');
}

function matchWildcard(val, pattern) {
  const rx = wildcardToRegex(pattern);
  // Test against each word and the whole value
  if (rx.test(val)) return true;
  const words = val.split(/\s+/);
  return words.some(w => rx.test(w));
}

function testRecord(rec, parsed) {
  const { mode, tokens } = parsed;
  const active = [...APP.activeCols];
  if (!tokens.length) return false;
  
  const testTok = tok => {
    const cols = tok.cols.length ? tok.cols : active;
    
    // For date/numeric filters, use raw values and only test relevant columns
    if (tok.dateMatch) {
      // For date filters, only test columns that look like dates (timestamps or date strings)
      const dateVals = cols.map(c => rec[c]).filter(v => {
        if (typeof v === 'number' && v > 946684800 && v < 2524608000) return true;
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return true;
        return false;
      });
      if (dateVals.length === 0) return tok.negate; // No date columns found
      const hit = dateVals.some(v => matchDate(v, tok.dateMatch));
      return tok.negate ? !hit : hit;
    }
    
    if (tok.numRange) {
      // For numeric filters, only test numeric values
      const numVals = cols.map(c => rec[c]).filter(v => typeof v === 'number');
      if (numVals.length === 0) return tok.negate; // No numeric columns found
      const hit = numVals.some(v => matchNumericRange(v, tok.numRange));
      return tok.negate ? !hit : hit;
    }
    
    // For text-based filters, use string conversion
    const vals = cols.map(c => String(rec[c] ?? '')).filter(Boolean);
    const hit = vals.some(v => matchVal(v, tok));
    return tok.negate ? !hit : hit;
  };
  
  if (mode === 'or') return tokens.some(testTok);
  if (mode === 'and') return tokens.every(testTok);
  if (mode === 'and2') {
    for (const col of active) {
      const testTokCol = tok => {
        const cols = tok.cols.length ? tok.cols : [col];
        
        if (tok.dateMatch) {
          const dateVals = cols.map(c => rec[c]).filter(v => {
            if (typeof v === 'number' && v > 946684800 && v < 2524608000) return true;
            if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return true;
            return false;
          });
          if (dateVals.length === 0) return tok.negate;
          const hit = dateVals.some(v => matchDate(v, tok.dateMatch));
          return tok.negate ? !hit : hit;
        }
        
        if (tok.numRange) {
          const numVals = cols.map(c => rec[c]).filter(v => typeof v === 'number');
          if (numVals.length === 0) return tok.negate;
          const hit = numVals.some(v => matchNumericRange(v, tok.numRange));
          return tok.negate ? !hit : hit;
        }
        
        const vals = cols.map(c => String(rec[c] ?? '')).filter(Boolean);
        const hit = vals.some(v => matchVal(v, tok));
        return tok.negate ? !hit : hit;
      };
      if (tokens.every(testTokCol)) return true;
    }
    return false;
  }
  return false;
}

function buildQuery(raw) {
  if (!raw.trim()) return '';
  const words = raw.trim().split(/\s+/);
  let prefix = APP.logicMode === 'and' ? '& ' : '';
  let modifier = '';
  
  switch (APP.matchMode) {
    case 'starts': modifier = '<'; break;
    case 'exact': modifier = '='; break;
    default: modifier = ''; break;
  }
  
  return prefix + words.map(w => modifier + w).join(' ');
}

// ══════════════════════════════════════════════════════════════
// FILTER & DISPLAY
// ══════════════════════════════════════════════════════════════
function runFilter() {
  if (!APP.ready) return;
  
  const raw = APP.query.trim();
  let matched = [];
  
  if (raw) {
    const query = buildQuery(raw);
    const parsed = parseQuery(query);
    matched = APP.records.filter(r => testRecord(r, parsed));
    renderTokens(parsed.tokens);
  } else {
    matched = [];
    renderTokens([]);
  }
  
  APP.lastMatchedRecords = matched;
  renderResults(matched);
  updateCount(matched.length);
  
  // Send to Grist
  if (APP.gristReady) {
    try { grist.setSelectedRows(matched.map(r => r.id)); } catch(e) {}
  }
}

function renderTokens(tokens) {
  tokenList.innerHTML = tokens.map(t => {
    let cls = 'token';
    if (t.negate) cls += ' neg';
    else if (t.dateMatch) cls += ' date';
    else if (t.numRange) cls += ' numeric';
    else if (t.fuzzy) cls += ' fuzzy';
    else if (t.wildcard) cls += ' wildcard';
    else if (t.phrase) cls += ' phrase';
    return `<span class="${cls}">${t.raw}</span>`;
  }).join('');
}

function updateCount(n) {
  countBadge.textContent = n;
  countBadge.className = 'count-badge' + (n === 0 ? ' zero' : '');
  modeBadge.textContent = APP.logicMode.toUpperCase();
  modeBadge.className = 'mode-badge' + (APP.logicMode === 'and' ? ' and' : '');
}

function formatDateByLocale(date) {
  switch (APP.dateFormat) {
    case 'en':
      return date.toLocaleDateString('en-CA'); // YYYY-MM-DD
    case 'iso':
      return date.toISOString().split('T')[0]; // YYYY-MM-DD
    case 'fr':
    default:
      return date.toLocaleDateString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit' }); // JJ/MM/AAAA
  }
}

function formatValue(val, colName) {
  if (val == null) return '';
  
  // Detect Unix timestamp (seconds since 1970)
  // Grist stores dates as seconds, typical range: 946684800 (2000) to 2524608000 (2050)
  if (typeof val === 'number' && val > 946684800 && val < 2524608000) {
    // Check if column name suggests it's a date
    const lowerCol = colName.toLowerCase();
    const isDateCol = /date|created|updated|modified|embauche|naissance|debut|fin|start|end/i.test(lowerCol);
    if (isDateCol) {
      const d = new Date(val * 1000);
      return formatDateByLocale(d);
    }
  }
  
  // Detect ISO date strings
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return formatDateByLocale(d);
    }
  }
  
  return String(val);
}

function renderResults(records) {
  if (records.length === 0) {
    resultsTable.style.display = 'none';
    emptyState.style.display = 'flex';
    if (APP.query.trim()) {
      emptyState.querySelector('h3').textContent = 'Aucun résultat';
      emptyState.querySelector('p').textContent = 'Essayez avec d\'autres mots-clés';
    } else {
      emptyState.querySelector('h3').textContent = 'Commencez votre recherche';
      emptyState.querySelector('p').textContent = 'Tapez un mot-clé pour filtrer les données';
    }
    return;
  }
  
  emptyState.style.display = 'none';
  resultsTable.style.display = 'table';
  
  const cols = [...APP.activeCols];
  resultsHead.innerHTML = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
  
  const displayRecords = records.slice(0, 100);
  resultsBody.innerHTML = displayRecords.map(rec => {
    return '<tr>' + cols.map(c => {
      const val = rec[c];
      const display = formatValue(val, c);
      return `<td title="${display}">${display}</td>`;
    }).join('') + '</tr>';
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// COLUMN TAGS
// ══════════════════════════════════════════════════════════════
function renderColTags() {
  colTags.innerHTML = APP.columns.slice(0, 6).map(c => {
    const active = APP.activeCols.has(c.id);
    return `<button class="col-tag${active ? ' active' : ''}" data-col="${c.id}">${c.id}</button>`;
  }).join('');
  
  if (APP.columns.length > 6) {
    colTags.innerHTML += `<button class="col-tag" id="moreColsBtn">+${APP.columns.length - 6}</button>`;
  }
  
  // Event listeners
  colTags.querySelectorAll('.col-tag[data-col]').forEach(btn => {
    btn.addEventListener('click', () => {
      const col = btn.dataset.col;
      if (APP.activeCols.has(col)) {
        APP.activeCols.delete(col);
        btn.classList.remove('active');
      } else {
        APP.activeCols.add(col);
        btn.classList.add('active');
      }
      renderColumnsList();
      runFilter();
    });
  });
  
  const moreBtn = $('moreColsBtn');
  if (moreBtn) {
    moreBtn.addEventListener('click', () => openSettings());
  }
}

function renderColumnsList() {
  columnsList.innerHTML = APP.columns.map(c => {
    const checked = APP.activeCols.has(c.id) ? 'checked' : '';
    return `
      <label class="column-item">
        <input type="checkbox" data-col="${c.id}" ${checked}>
        <span>${c.id}</span>
        <span class="col-type">${shortType(c.type)}</span>
      </label>
    `;
  }).join('');
  
  columnsList.querySelectorAll('input[data-col]').forEach(cb => {
    cb.addEventListener('change', () => {
      const col = cb.dataset.col;
      if (cb.checked) APP.activeCols.add(col);
      else APP.activeCols.delete(col);
      renderColTags();
      runFilter();
    });
  });
}

function shortType(t) {
  const map = { Text: 'TXT', Numeric: 'NUM', Bool: 'BOOL', Date: 'DATE' };
  return map[t] || 'TXT';
}

// ══════════════════════════════════════════════════════════════
// TABLE SELECTION
// ══════════════════════════════════════════════════════════════
async function loadAvailableTables() {
  if (!APP.gristReady) return;
  try {
    const tables = await grist.docApi.listTables();
    APP.availableTables = tables.filter(t => !t.startsWith('_grist') && !t.startsWith('GristHidden'));
    tableSelect.innerHTML = '<option value="">Vue liée</option>' +
      APP.availableTables.map(t => `<option value="${t}">${t}</option>`).join('');
  } catch (e) {
    console.warn('Error loading tables:', e);
  }
}

async function selectTable(tableName) {
  APP.selectedTable = tableName;
  
  if (!tableName) {
    APP.records = APP.linkedRecords;
    if (APP.linkedRecords.length > 0) {
      rebuildColumns(APP.linkedRecords);
    }
  } else {
    loadingState.style.display = 'flex';
    emptyState.style.display = 'none';
    resultsTable.style.display = 'none';
    
    try {
      const data = await grist.docApi.fetchTable(tableName);
      const records = [];
      const ids = data.id || [];
      const columns = Object.keys(data).filter(k => k !== 'id' && k !== 'manualSort');
      
      for (let i = 0; i < ids.length; i++) {
        const rec = { id: ids[i] };
        columns.forEach(col => { rec[col] = data[col][i]; });
        records.push(rec);
      }
      
      APP.records = records;
      APP.ready = true;
      rebuildColumns(records);
    } catch (e) {
      console.error('Error loading table:', e);
    }
    
    loadingState.style.display = 'none';
  }
  
  runFilter();
}

function rebuildColumns(records) {
  if (!records.length) {
    APP.columns = [];
    APP.activeCols.clear();
    renderColTags();
    renderColumnsList();
    return;
  }
  
  const skip = new Set(['id', 'manualSort']);
  APP.columns = Object.keys(records[0])
    .filter(k => !skip.has(k))
    .map(k => ({ id: k, label: k, type: inferType(records[0][k]) }));
  
  APP.activeCols.clear();
  APP.columns.forEach(c => APP.activeCols.add(c.id));
  
  renderColTags();
  renderColumnsList();
}

function inferType(v) {
  if (typeof v === 'number') return 'Numeric';
  if (typeof v === 'boolean') return 'Bool';
  return 'Text';
}

// ══════════════════════════════════════════════════════════════
// SETTINGS & HELP PANELS
// ══════════════════════════════════════════════════════════════
function openSettings() {
  settingsOverlay.classList.add('show');
  settingsPanel.classList.add('show');
}

function closeSettings() {
  settingsOverlay.classList.remove('show');
  settingsPanel.classList.remove('show');
}

function openHelp() {
  helpPanel.classList.add('show');
}

function closeHelp() {
  helpPanel.classList.remove('show');
}

// ══════════════════════════════════════════════════════════════
// GRIST INTEGRATION
// ══════════════════════════════════════════════════════════════
function initGrist() {
  try {
    grist.ready({ requiredAccess: 'full', columns: [] });
    APP.gristReady = true;
    loadAvailableTables();
    
    grist.onRecords((records) => {
      APP.linkedRecords = records || [];
      if (!APP.selectedTable) {
        APP.records = APP.linkedRecords;
      }
      
      if (!APP.ready && records.length > 0) {
        APP.ready = true;
        rebuildColumns(records);
        runFilter();
      } else if (APP.ready && !APP.selectedTable) {
        runFilter();
      }
    });
  } catch (e) {
    console.warn('Grist not available, using demo mode');
    loadDemo();
  }
}

function loadDemo() {
  APP.records = [
    { id: 1, Nom: 'Alice Dupont', Email: 'alice@corp.fr', Ville: 'Paris' },
    { id: 2, Nom: 'Bob Martin', Email: 'bob@corp.fr', Ville: 'Lyon' },
    { id: 3, Nom: 'Claire Morin', Email: 'claire@corp.fr', Ville: 'Nantes' },
  ];
  APP.ready = true;
  rebuildColumns(APP.records);
}

// ══════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ══════════════════════════════════════════════════════════════
searchInput.addEventListener('input', () => {
  APP.query = searchInput.value;
  searchClear.classList.toggle('show', !!APP.query);
  runFilter();
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    APP.query = '';
    searchClear.classList.remove('show');
    runFilter();
  }
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  APP.query = '';
  searchClear.classList.remove('show');
  runFilter();
  searchInput.focus();
});

// Match mode pills
document.querySelectorAll('.pill[data-match]').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill[data-match]').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    APP.matchMode = pill.dataset.match;
    runFilter();
  });
});

// Logic mode pills
document.querySelectorAll('.pill[data-logic]').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill[data-logic]').forEach(p => {
      p.classList.remove('active', 'active-green');
    });
    pill.classList.add(pill.dataset.logic === 'or' ? 'active-green' : 'active');
    APP.logicMode = pill.dataset.logic;
    runFilter();
  });
});

// Table selection
tableSelect.addEventListener('change', () => selectTable(tableSelect.value));

// Settings
$('btnSettings').addEventListener('click', openSettings);
settingsOverlay.addEventListener('click', closeSettings);
$('settingsClose').addEventListener('click', closeSettings);

// Help
$('btnHelp').addEventListener('click', () => {
  if (helpPanel.classList.contains('show')) closeHelp();
  else openHelp();
});
$('helpClose').addEventListener('click', closeHelp);

// Date format
$('dateFormat').addEventListener('change', (e) => {
  APP.dateFormat = e.target.value;
  runFilter();
});

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
initGrist();
