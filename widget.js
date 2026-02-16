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
    const raw = m[0];
    let word = m[2] || m[3] || m[4] || m[5] || '';
    let negate = false, mod = '', rx = false, phrase = false, whole = false, cols = [];
    
    if (m[2]) phrase = true;
    if (m[3]) { whole = true; word = m[3]; }
    if (m[4]) { rx = true; word = m[4]; }
    
    // Prefixes
    if (word.startsWith('!')) { negate = true; word = word.slice(1); }
    if (word.startsWith('=')) { mod = '='; word = word.slice(1); }
    else if (word.startsWith('<')) { mod = '<'; word = word.slice(1); }
    else if (word.startsWith('>')) { mod = '>'; word = word.slice(1); }
    
    // Column scope
    const atIdx = word.indexOf('@');
    if (atIdx > 0) {
      cols = word.slice(atIdx + 1).split(',').filter(Boolean);
      word = word.slice(0, atIdx);
    }
    
    if (word) {
      tokens.push({ raw, word, negate, mod, rx, phrase, whole, cols });
    }
  }
  
  return { tokens, mode };
}

function matchVal(val, tok) {
  const v = val.toLowerCase(), w = tok.word.toLowerCase();
  if (tok.rx) { try { return new RegExp(w, 'i').test(val); } catch { return false; } }
  if (tok.phrase) return v.includes(w);
  if (tok.mod === '=') return v === w;
  if (tok.mod === '<') return v.startsWith(w);
  if (tok.mod === '>') return v.endsWith(w);
  if (tok.whole) return new RegExp('(?<![\\w])' + escapeRegex(w) + '(?![\\w])', 'i').test(val);
  return v.includes(w);
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function testRecord(rec, parsed) {
  const { mode, tokens } = parsed;
  const active = [...APP.activeCols];
  if (!tokens.length) return false;
  
  const testTok = tok => {
    const cols = tok.cols.length ? tok.cols : active;
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
  
  const cols = [...APP.activeCols].slice(0, 8);
  resultsHead.innerHTML = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
  
  const displayRecords = records.slice(0, 100);
  resultsBody.innerHTML = displayRecords.map(rec => {
    return '<tr>' + cols.map(c => {
      const val = rec[c];
      const display = val == null ? '' : String(val);
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

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
initGrist();
