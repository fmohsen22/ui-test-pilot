/* UI Test Pilot SPA — vanilla JS, no build step */
'use strict';

let token = localStorage.getItem('uitp_token') || null;
let me = null;
let currentConversation = null;
let currentScenarioPath = null;

/* ---------------- api ---------------- */
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) { logout(); throw new Error('session expired, please sign in again'); }
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.details || j.title || JSON.stringify(j); } catch (e) { /* keep */ }
    throw new Error(detail);
  }
  return res.json();
}

/* ---------------- auth ---------------- */
function showLogin() { el('login-form').classList.remove('hidden'); el('register-form').classList.add('hidden'); authError(''); }
function showRegister() { el('register-form').classList.remove('hidden'); el('login-form').classList.add('hidden'); authError(''); }
function authError(msg) { const e = el('auth-error'); e.textContent = msg; e.classList.toggle('hidden', !msg); }

async function doLogin() {
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: el('login-email').value, password: el('login-password').value })
    });
    session(data);
  } catch (e) { authError(e.message); }
}

async function doRegister() {
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: el('reg-email').value, firstName: el('reg-first').value,
        lastName: el('reg-last').value, position: el('reg-position').value,
        password: el('reg-password').value
      })
    });
    session(data);
  } catch (e) { authError(e.message); }
}

function session(data) {
  token = data.token; me = data.user;
  localStorage.setItem('uitp_token', token);
  boot();
}

function logout() {
  token = null; me = null;
  localStorage.removeItem('uitp_token');
  el('app-view').classList.add('hidden');
  el('auth-view').classList.remove('hidden');
}

/* ---------------- boot / tabs ---------------- */
async function boot() {
  if (!token) { logout(); return; }
  try { me = await api('/api/auth/me'); } catch (e) { return; }
  el('auth-view').classList.add('hidden');
  el('app-view').classList.remove('hidden');
  el('whoami').textContent = `${me.firstName} ${me.lastName}` + (me.position ? ` · ${me.position}` : '');
  el('nav-admin').classList.toggle('hidden', !me.admin);
  showTab('chat');
  loadConversations();
}

function showTab(name) {
  for (const t of ['chat', 'regression', 'admin']) {
    el('tab-' + t).classList.toggle('hidden', t !== name);
    el('nav-' + t).classList.toggle('active', t === name);
  }
  if (name === 'regression') loadTree();
  if (name === 'admin') loadAdmin('users');
}

/* ---------------- chat ---------------- */
async function loadConversations() {
  const list = await api('/api/chat/conversations');
  const box = el('conversations');
  box.innerHTML = '';
  for (const c of list) {
    const div = document.createElement('div');
    div.className = 'conv-item' + (currentConversation === c.id ? ' active' : '');
    div.textContent = c.title;
    div.onclick = () => openConversation(c.id);
    box.appendChild(div);
  }
}

async function newConversation() {
  const c = await api('/api/chat/conversations', { method: 'POST' });
  currentConversation = c.id;
  await loadConversations();
  renderMessages([]);
}

async function openConversation(id) {
  currentConversation = id;
  const c = await api('/api/chat/conversations/' + id);
  await loadConversations();
  renderMessages(c.messages);
}

function renderMessages(messages) {
  const box = el('messages');
  box.innerHTML = '';
  if (!messages.length) {
    box.innerHTML = '<div class="placeholder">Describe the test you want in plain language.</div>';
    return;
  }
  for (const m of messages) {
    const div = document.createElement('div');
    div.className = 'msg ' + m.role;
    if (m.role === 'tool') {
      div.innerHTML = `<details><summary>🔧 ${escapeHtml(m.toolName)}</summary><pre>${escapeHtml(m.content)}</pre></details>`;
    } else {
      div.innerHTML = `<div class="who">${m.role === 'user' ? 'You' : 'Pilot'}</div>` +
        `<div class="bubble">${escapeHtml(m.content)}</div>`;
    }
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}

async function sendMessage() {
  const input = el('chat-input');
  const text = input.value.trim();
  if (!text) return;
  if (!currentConversation) await newConversation();
  input.value = '';
  el('send-btn').disabled = true;
  const box = el('messages');
  box.insertAdjacentHTML('beforeend',
    `<div class="msg user"><div class="who">You</div><div class="bubble">${escapeHtml(text)}</div></div>` +
    `<div class="msg assistant thinking" id="thinking">Pilot is working — snapshotting, writing and running tests can take a minute…</div>`);
  box.scrollTop = box.scrollHeight;
  try {
    const c = await api(`/api/chat/conversations/${currentConversation}/messages`, {
      method: 'POST', body: JSON.stringify({ content: text })
    });
    renderMessages(c.messages);
    loadConversations();
  } catch (e) {
    const t = el('thinking');
    if (t) t.outerHTML = `<div class="msg assistant"><div class="bubble">⚠️ ${escapeHtml(e.message)}</div></div>`;
  } finally {
    el('send-btn').disabled = false;
  }
}

/* ---------------- regression ---------------- */
async function loadTree() {
  const tree = await api('/api/regression/tree');
  const box = el('tree');
  box.innerHTML = '';
  const folders = Object.keys(tree);
  if (!folders.length) {
    box.innerHTML = '<div class="placeholder">No scenarios yet. Create some in the Chat tab!</div>';
    return;
  }
  for (const folder of folders) {
    const details = document.createElement('details');
    details.className = 'tree-folder';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = `📁 ${folder} (${tree[folder].length})`;
    details.appendChild(summary);
    for (const s of tree[folder]) {
      const file = document.createElement('div');
      file.className = 'tree-file';
      file.dataset.path = s.path;
      file.textContent = s.id;
      file.title = s.title;
      file.onclick = () => openScenario(s.path, file);
      details.appendChild(file);
    }
    box.appendChild(details);
  }
}

async function openScenario(path, node) {
  document.querySelectorAll('.tree-file.active').forEach(n => n.classList.remove('active'));
  if (node) node.classList.add('active');
  const s = await api('/api/regression/scenario?path=' + encodeURIComponent(path));
  currentScenarioPath = path;
  el('reg-empty').classList.add('hidden');
  el('reg-content').classList.remove('hidden');
  el('reg-title').textContent = s.title || s.id;
  el('reg-path').textContent = s.path;
  el('reg-json').value = s.raw;
  el('run-result').classList.add('hidden');
  const ol = el('reg-explained');
  ol.innerHTML = '';
  for (const line of s.explained) {
    const li = document.createElement('li');
    li.textContent = line.replace(/^Step \d+: /, '');
    ol.appendChild(li);
  }
}

async function saveScenario() {
  if (!currentScenarioPath) return;
  try {
    await api('/api/regression/scenario', {
      method: 'PUT',
      body: JSON.stringify({ path: currentScenarioPath, content: el('reg-json').value })
    });
    await openScenario(currentScenarioPath, document.querySelector('.tree-file.active'));
    flashResult(true, 'Saved and validated.');
  } catch (e) { flashResult(false, 'Save failed: ' + e.message); }
}

async function runScenario(heal) {
  if (!currentScenarioPath) return;
  flashResult(true, heal ? 'Running with self-heal — this can take a few minutes…' : 'Running…');
  try {
    await api('/api/regression/scenario', {
      method: 'PUT',
      body: JSON.stringify({ path: currentScenarioPath, content: el('reg-json').value })
    });
    const r = await api('/api/regression/run', {
      method: 'POST', body: JSON.stringify({ path: currentScenarioPath, heal })
    });
    let html = r.passed
      ? `<strong>✅ PASSED</strong> after ${r.attempts.length} attempt(s).`
      : `<strong>❌ FAILED</strong> (exit ${r.exitCode}) after ${r.attempts.length} attempt(s).`;
    html += `<details><summary>Full report</summary><pre>${escapeHtml(JSON.stringify(r.attempts, null, 2))}</pre></details>`;
    flashResult(r.passed, html, true);
    await openScenario(currentScenarioPath, document.querySelector('.tree-file.active')); // healed JSON may differ
    const box = el('run-result');
    box.classList.remove('hidden');
  } catch (e) { flashResult(false, 'Run failed: ' + e.message); }
}

function flashResult(ok, message, isHtml) {
  const box = el('run-result');
  box.classList.remove('hidden', 'pass', 'fail');
  box.classList.add(ok ? 'pass' : 'fail');
  if (isHtml) box.innerHTML = message; else box.textContent = message;
}

/* ---------------- admin ---------------- */
async function loadAdmin(which) {
  const box = el('admin-content');
  box.innerHTML = '<div class="placeholder">Loading…</div>';
  try {
    if (which === 'users') {
      const users = await api('/api/admin/users');
      box.innerHTML = table(
        ['Email', 'Name', 'Position', 'Role', 'Chats', 'Registered'],
        users.map(u => [u.email, `${u.firstName} ${u.lastName}`, u.position,
          u.admin ? 'admin' : 'user', u.conversations, u.createdAt.slice(0, 10)]));
    } else if (which === 'logs') {
      const logs = await api('/api/admin/logs');
      box.innerHTML = table(
        ['Time', 'Level', 'User', 'Action', 'Detail'],
        logs.map(l => [l.ts.replace('T', ' ').slice(0, 19), l.level, l.user, l.action, l.detail]),
        (cell, col) => col === 1 ? `class="lvl-${cell}"` : (col === 4 ? 'class="detail"' : ''));
    } else {
      const convs = await api('/api/admin/conversations');
      box.innerHTML = table(
        ['User', 'Title', 'Messages', 'Last activity'],
        convs.map(c => [c.user, c.title, c.messages, c.updatedAt.replace('T', ' ').slice(0, 19)]));
    }
  } catch (e) {
    box.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

function table(headers, rows, attrFn) {
  let h = '<table class="admin"><thead><tr>' + headers.map(x => `<th>${x}</th>`).join('') + '</tr></thead><tbody>';
  for (const row of rows) {
    h += '<tr>' + row.map((cell, i) =>
      `<td ${attrFn ? attrFn(String(cell), i) : ''}>${escapeHtml(String(cell))}</td>`).join('') + '</tr>';
  }
  return h + '</tbody></table>';
}

/* ---------------- util ---------------- */
function el(id) { return document.getElementById(id); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

el('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

if (token) boot(); else { el('auth-view').classList.remove('hidden'); }
