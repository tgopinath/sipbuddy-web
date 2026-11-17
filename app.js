// SipBuddy for the web, Android and Windows: the same product as the Mac menu bar app.
// Everything is stored in this browser (localStorage). The camera runs only while a reminder or Drink now is open.
import { PERSONALITIES, nextMessage, greetingTitle, greetingSubtitle } from './messages.js';
import { nextReminder } from './planner.js';
import { createSession, loadModels } from './detector.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const say = t => { const el = $('#say'); el.textContent = ''; setTimeout(() => (el.textContent = t), 30); };
const SIPS_TO_CLOSE = 5;
const CAMERA_LIMIT_MS = 10 * 60 * 1000;
const DRINK_NOW_IDLE_MS = 5000;

// ---------- Storage ----------
const DEFAULTS = {
  goal: 2000, perSip: 25, enabled: true, interval: 60, start: 480, end: 1320, days: [0, 1, 2, 3, 4, 5, 6],
  weekendHours: false, weekendStart: 540, weekendEnd: 1320, lunch: false, lunchStart: 780, lunchEnd: 840,
  sleep: true, sleepStart: 1380, sleepEnd: 420, stopAtGoal: true, personality: 'friendlyFriend',
  theme: 'system', accent: 'ocean', sound: true, ownerOnly: true,
};
const DEMO = new URLSearchParams(location.search).has('demo');
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem('sipbuddy.' + k)); return v ?? d; } catch { return d; } };
const write = (k, v) => { if (DEMO) return; try { localStorage.setItem('sipbuddy.' + k, JSON.stringify(v)); } catch {} };

let S = { ...DEFAULTS, ...read('settings', {}) };
let entries = read('entries', []);           // [{ id, ml, t, sips }]
let st = { lastReminderAt: null, lastDrinkAt: null, snoozedUntil: null, pausedUntil: null, lastMessageId: null, ...read('state', {}) };
let owner = read('owner', null);              // { sig, learnedAt }
const saveS = () => write('settings', S), saveE = () => write('entries', entries), saveSt = () => write('state', st);
const pausedUntil = () => (st.pausedUntil === -1 ? Infinity : st.pausedUntil);

if (DEMO) seedDemo();
function seedDemo() {
  // Sample history for screenshots and visitors (?demo); never saved.
  const now = new Date(); entries = [];
  const totals = [2150, 1800, 2400, 2050, 1500, 2250, 2000, 1900, 2300, 2100, 1650, 2200, 2050, 2500, 1950, 2000, 2350, 1700, 2100, 2200, 2000, 1850, 2400, 2050, 2150, 1950, 2300, 2100, 2000];
  totals.forEach((ml, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (totals.length - i)); d.setHours(9, 0, 0, 0);
    let left = ml, h = 9;
    while (left > 0) { const a = Math.min(left, [125, 150, 175, 200][h % 4]); d.setHours(h, (h * 17) % 60); entries.push({ id: crypto.randomUUID(), ml: a, t: d.getTime(), sips: a / 25 }); left -= a; h++; }
  });
  [[8, 40, 150], [10, 5, 125], [11, 30, 100], [14, 10, 150], [16, 45, 125], [18, 20, 125]].forEach(([h, m, ml]) => {
    const d = new Date(now); d.setHours(h, m, 0, 0); if (d < now) entries.push({ id: crypto.randomUUID(), ml, t: d.getTime(), sips: ml / 25 });
  });
  owner = owner || { sig: [], learnedAt: Date.now() };
  st.lastDrinkAt = Math.max(...entries.map(e => e.t));
}

// ---------- Helpers ----------
const fmtMl = ml => ml.toLocaleString('en-GB') + ' ml';
const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const todayKey = () => dayKey(Date.now());
const todays = () => entries.filter(e => dayKey(e.t) === todayKey()).sort((a, b) => b.t - a.t);
const todayTotal = () => todays().reduce((a, e) => a + e.ml, 0);
const totalsByDay = () => entries.reduce((m, e) => { const k = dayKey(e.t); m[k] = (m[k] || 0) + e.ml; return m; }, {});
const minToStr = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const strToMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const icon = (d, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  drop: '<path d="M12 3.2c3 3.6 6 7.3 6 10.6a6 6 0 0 1-12 0c0-3.3 3-7 6-10.6z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 5l12 7-12 7V5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  face: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  cam: '<path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"/><circle cx="12" cy="12.5" r="3.5"/>',
};

// ---------- Theme ----------
function applyTheme() {
  const r = document.documentElement;
  if (S.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', S.theme);
  if (S.accent === 'ocean') r.removeAttribute('data-accent'); else r.setAttribute('data-accent', S.accent);
}
applyTheme();
const ACCENTS = { ocean: ['Ocean', '#0077b6'], aqua: ['Aqua', '#0b7590'], teal: ['Teal', '#0e7c7c'], indigo: ['Indigo', '#4f52d9'], mint: ['Mint', '#137a57'], coral: ['Coral', '#c2412f'] };

// ---------- Native looks (Material 3 in the Android app, Apple HIG in an iPhone home-screen app) ----------
const ROUTES = { '': ['today', 'Today'], stats: ['stats', 'Statistics'], settings: ['settings', 'Settings'] };
const m3 = window.KolamM3 ? KolamM3.init({
  primary: ACCENTS[S.accent][1], title: 'SipBuddy', hide: ['.app-header', '.app-tabs'],
  destinations: [{ id: 'today', label: 'Today', icon: 'water_drop', href: '#/' }, { id: 'stats', label: 'Statistics', icon: 'bar_chart', href: '#/stats' }, { id: 'settings', label: 'Settings', icon: 'settings', href: '#/settings' }],
  onBack: () => { if (!$('#overlay').hidden) { closeOverlay(); return true; } return false; },
}) : null;
const ios = window.KolamIOS ? KolamIOS.init({
  appName: 'SipBuddy', navBar: { title: 'Today', large: true },
  tabs: [{ id: 'today', label: 'Today', icon: 'house', href: '#/' }, { id: 'stats', label: 'Statistics', icon: 'list.bullet', href: '#/stats' }, { id: 'settings', label: 'Settings', icon: 'gearshape', href: '#/settings' }],
  currentTab: 'today',
}) : null;

// ---------- Router ----------
function route() {
  const key = location.hash.replace(/^#\/?/, '').split('/')[0];
  const [id, title] = ROUTES[key] || ROUTES[''];
  document.querySelectorAll('[data-route]').forEach(a => { if (a.dataset.route === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.title = id === 'today' ? 'SipBuddy' : `${title} · SipBuddy`;
  m3?.setTitle?.(id === 'today' ? 'SipBuddy' : title);
  if (ios) { KolamIOS.navBar.set({ title, large: true }); KolamIOS.tabBar.select(id); }
  ({ today: renderToday, stats: renderStats, settings: renderSettings })[id]();
}
addEventListener('hashchange', () => { route(); $('#main').focus({ preventScroll: true }); scrollTo(0, 0); });

// ---------- Today ----------
function dropSvg(progress) {
  const p = Math.max(0, Math.min(1, progress));
  const C = 2 * Math.PI * 44;
  const level = 86 - p * 70; // water surface y inside the drop (86 = empty, 16 = full)
  return `<svg viewBox="0 0 100 100" role="img" aria-label="${Math.round(p * 100)}% of today's goal">
    <defs>
      <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--water-2)"/><stop offset="1" stop-color="var(--water)"/></linearGradient>
      <clipPath id="dropClip"><path d="M50 18c7 9 16 19 16 30a16 16 0 0 1-32 0c0-11 9-21 16-30z" transform="translate(0 6)"/></clipPath>
    </defs>
    <circle class="track" cx="50" cy="50" r="44" fill="none" stroke-width="7"/>
    <circle class="fill" cx="50" cy="50" r="44" fill="none" stroke-width="7" stroke-linecap="round" transform="rotate(-90 50 50)" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}"/>
    <path d="M50 18c7 9 16 19 16 30a16 16 0 0 1-32 0c0-11 9-21 16-30z" transform="translate(0 6)" fill="var(--surface)" stroke="var(--water-2)" stroke-width="1.6"/>
    <g clip-path="url(#dropClip)"><g class="drop-water" style="transform:translateY(${level - 86}px)">
      <path d="M20 88 q7.5 -4 15 0 t15 0 t15 0 t15 0 V140 H20z" fill="var(--water)"/>
      <path d="M20 86 q7.5 -3 15 0 t15 0 t15 0 t15 0" fill="none" stroke="var(--water-2)" stroke-width="2" opacity=".8"/>
    </g></g>
    <path d="M44 38c-2 3-3.5 6-3.5 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>
  </svg>`;
}

function nextAt() {
  if (!S.enabled) return null;
  const anchor = Math.max(st.lastReminderAt || 0, st.lastDrinkAt || 0) || null;
  return nextReminder(Date.now(), anchor, S, todayTotal() >= S.goal, st.snoozedUntil, pausedUntil());
}

function nextText() {
  if (!S.enabled) return ['Reminders are off', 'Turn them on in Settings.'];
  const p = pausedUntil();
  if (p === Infinity) return ['Paused', 'Until you resume.'];
  const n = nextAt();
  if (!n) return ['No reminder planned', 'Check working days and hours in Settings.'];
  const d = new Date(n), same = dayKey(n) === todayKey();
  const tomorrow = dayKey(n) === dayKey(Date.now() + 864e5);
  const when = same ? fmtTime(n) : `${tomorrow ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'long' })}, ${fmtTime(n)}`;
  const sub = p && p > Date.now() ? `Paused until ${fmtTime(p)}.` : st.snoozedUntil && st.snoozedUntil > Date.now() ? 'Snoozed.' : `Every ${S.interval} minutes, ${minToStr(S.start)} to ${minToStr(S.end)}.`;
  return [when, sub];
}

function renderToday() {
  const total = todayTotal(), progress = total / S.goal, list = todays();
  const [when, sub] = nextText();
  const paused = pausedUntil() && pausedUntil() > Date.now();
  const notif = 'Notification' in window && Notification.permission === 'default' && !read('notifAsked', false);
  $('#main').innerHTML = `
  <div class="today">
    <section class="greet" aria-label="Greeting">
      <h1>${esc(greetingTitle())}</h1>
      <p>${esc(greetingSubtitle(S.personality))}</p>
      <p class="date">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    </section>
    <section class="k-card hero" aria-label="Today's water">
      <div class="ring">${dropSvg(progress)}</div>
      <div>
        <p class="amount num">${total.toLocaleString('en-GB')} <small>ml</small></p>
        <p class="of">of ${fmtMl(S.goal)} goal</p>
        <dl class="mini"><div><dt>Remaining</dt><dd class="num">${fmtMl(Math.max(0, S.goal - total))}</dd></div><div><dt>Done</dt><dd class="num">${Math.round(progress * 100)}%</dd></div></dl>
      </div>
    </section>
    <button class="k-btn k-btn-primary drink-btn" id="drinkNow">${icon(I.drop)}Drink now — I'll count your sips</button>
    ${notif ? `<div class="notice" role="note">${icon(I.bell)}<span>Turn on notifications so a reminder reaches you while SipBuddy is in the background.</span><button class="k-btn k-btn-sm k-btn-outline" id="askNotif">Turn on</button></div>` : ''}
    <div class="side" style="display:grid;gap:16px">
      <section class="k-card next" aria-labelledby="next-h">
        <div class="card-h"><h2 id="next-h">Next reminder</h2>${icon(I.clock)}</div>
        <p class="next-when num">${esc(when)}</p>
        <p class="muted" style="margin:-8px 0 0">${esc(sub)}</p>
        <div class="row-btns">
          ${paused ? `<button class="k-btn k-btn-sm k-btn-primary" id="resume">${icon(I.play, 'ico sm')}Resume</button>` : `<button class="k-btn k-btn-sm k-btn-outline" id="pause">${icon(I.pause, 'ico sm')}Pause</button>`}
          <button class="k-btn k-btn-sm k-btn-outline" id="snooze">Snooze 15 min</button>
          <button class="k-btn k-btn-sm k-btn-ghost" id="preview">Show a reminder now</button>
        </div>
      </section>
      <section class="k-card" aria-labelledby="sips-h">
        <div class="card-h"><h2 id="sips-h">Today's sips (${list.length})</h2></div>
        ${list.length ? `<ul class="sips">${list.map(e => `<li><span class="dot">${icon(I.drop, 'ico sm')}</span><div><div class="t num">${fmtMl(e.ml)}</div><div class="s">${fmtTime(e.t)}${e.sips ? ` · ${e.sips} sip${e.sips === 1 ? '' : 's'}` : ''}</div></div><div><button class="iconbtn" data-edit="${e.id}" aria-label="Edit ${fmtMl(e.ml)} at ${fmtTime(e.t)}">${icon(I.edit)}</button><button class="iconbtn" data-del="${e.id}" aria-label="Delete ${fmtMl(e.ml)} at ${fmtTime(e.t)}">${icon(I.trash)}</button></div></li>`).join('')}</ul>`
        : `<p class="empty">Nothing yet. Press Drink now and take a few sips in front of the camera; each sip logs ${S.perSip} ml.</p>`}
      </section>
      <p class="persona-foot">${icon(I.smile, 'ico sm')}${esc(PERSONALITIES[S.personality].title)}</p>
    </div>
  </div>`;
  $('#drinkNow').onclick = () => openOverlay('drink');
  $('#askNotif')?.addEventListener('click', askNotifications);
  $('#pause')?.addEventListener('click', pauseMenu);
  $('#resume')?.addEventListener('click', () => { st.pausedUntil = null; saveSt(); renderToday(); say('Reminders resumed.'); });
  $('#snooze').onclick = () => { st.snoozedUntil = Date.now() + 15 * 60000; saveSt(); renderToday(); say('Snoozed for 15 minutes.'); };
  $('#preview').onclick = () => fireReminder(true);
  $('#main').querySelectorAll('[data-edit]').forEach(b => (b.onclick = () => editEntry(b.dataset.edit)));
  $('#main').querySelectorAll('[data-del]').forEach(b => (b.onclick = () => deleteEntry(b.dataset.del)));
}

function addEntry(sips) {
  if (!sips) return;
  const e = { id: crypto.randomUUID(), ml: sips * S.perSip, t: Date.now(), sips };
  const before = todayTotal();
  entries.push(e); st.lastDrinkAt = e.t; st.snoozedUntil = null; saveE(); saveSt();
  if (before < S.goal && todayTotal() >= S.goal) setTimeout(() => toast("Goal reached. That's today's water done."), 400);
  rerender();
  return e;
}

function editEntry(id) {
  const e = entries.find(x => x.id === id); if (!e) return;
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog"><h2 class="k-dialog-title">Edit entry</h2><div class="k-dialog-body">Logged at ${fmtTime(e.t)}.
    <div class="k-field"><label class="k-label" for="ml">Amount (ml)</label><input class="k-select" style="background-image:none" id="ml" type="number" inputmode="numeric" min="5" max="3000" step="5" value="${e.ml}" required></div></div>
    <div class="k-dialog-actions"><button class="k-btn k-btn-outline" value="cancel" formnovalidate>Cancel</button><button class="k-btn k-btn-primary" value="ok">Save</button></div></form>`;
  dlg.showModal();
  dlg.onclose = () => { if (dlg.returnValue === 'ok') { const v = Math.round(+$('#ml', dlg).value); if (v > 0) { e.ml = v; saveE(); rerender(); say(`Changed to ${fmtMl(v)}.`); } } };
}

function deleteEntry(id) {
  const i = entries.findIndex(x => x.id === id); if (i < 0) return;
  const [e] = entries.splice(i, 1); saveE(); rerender();
  toast(`Deleted ${fmtMl(e.ml)}`, 'Undo', () => { entries.push(e); saveE(); rerender(); });
}

function pauseMenu() {
  const opts = [['30 minutes', 30], ['1 hour', 60], ['2 hours', 120], ['4 hours', 240], ['Rest of today', 'today'], ['Until I resume', 'forever']];
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog"><h2 class="k-dialog-title">Pause reminders</h2><div class="menu-list">${opts.map(([l, v]) => `<button value="${v}">${l}</button>`).join('')}</div><div class="k-dialog-actions"><button class="k-btn k-btn-outline" value="cancel">Cancel</button></div></form>`;
  dlg.showModal();
  dlg.onclose = () => {
    const v = dlg.returnValue; if (!v || v === 'cancel') return;
    if (v === 'forever') st.pausedUntil = -1;
    else if (v === 'today') { const d = new Date(); d.setHours(24, 0, 0, 0); st.pausedUntil = d.getTime(); }
    else st.pausedUntil = Date.now() + v * 60000;
    saveSt(); rerender(); say('Reminders paused.');
  };
}

// ---------- Statistics ----------
let statsRange = 'week', statsPick = null;
function renderStats() {
  const totals = totalsByDay(), n = statsRange === 'week' ? 7 : 30;
  const days = [...Array(n)].map((_, i) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (n - 1 - i)); const k = dayKey(d); return { k, d, ml: totals[k] || 0 }; });
  const last30 = [...Array(30)].map((_, i) => totals[dayKey(Date.now() - i * 864e5)] || 0);
  const logged = last30.filter(v => v > 0);
  const avg = logged.length ? Math.round(logged.reduce((a, b) => a + b, 0) / logged.length) : 0;
  const bestK = Object.keys(totals).sort((a, b) => totals[b] - totals[a])[0];
  let streak = 0; { let i = totals[todayKey()] >= S.goal ? 0 : 1; while (totals[dayKey(Date.now() - i * 864e5)] >= S.goal) { streak++; i++; } }
  const W = innerWidth < 600 ? 360 : 700, H = innerWidth < 600 ? 220 : 240, padL = 40, padB = 26, top = 12;
  const max = Math.max(S.goal * 1.2, ...days.map(d => d.ml));
  const bw = (W - padL - 8) / n;
  const y = v => top + (H - padB - top) * (1 - v / max);
  const label = d => statsRange === 'week' ? d.d.toLocaleDateString('en-GB', { weekday: 'short' }) : (d.d.getDate() % (W < 600 ? 7 : 5) === 0 ? d.d.getDate() : '');
  const picked = days.find(d => d.k === statsPick) || days[days.length - 1];
  $('#main').innerHTML = `
  <div class="stats">
    <h1>Statistics</h1>
    <div class="tiles">
      <div class="k-card tile k-stat"><span class="k-stat-label">Today</span><span class="k-stat-value num">${fmtMl(todayTotal())}</span><span class="k-stat-label">${Math.round(todayTotal() / S.goal * 100)}% of goal</span></div>
      <div class="k-card tile k-stat"><span class="k-stat-label">Streak</span><span class="k-stat-value num">${streak} day${streak === 1 ? '' : 's'}</span><span class="k-stat-label">goal met in a row</span></div>
      <div class="k-card tile k-stat"><span class="k-stat-label">30-day average</span><span class="k-stat-value num">${fmtMl(avg)}</span><span class="k-stat-label">on days you logged</span></div>
      <div class="k-card tile k-stat"><span class="k-stat-label">Best day</span><span class="k-stat-value num">${bestK ? fmtMl(totals[bestK]) : '—'}</span><span class="k-stat-label">${bestK ? new Date(bestK + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No entries yet'}</span></div>
    </div>
    <section class="k-card" aria-labelledby="ch-h">
      <div class="card-h"><h2 id="ch-h">${statsRange === 'week' ? 'Last 7 days' : 'Last 30 days'}</h2>
        <div class="k-tabs" role="tablist" aria-label="Range"><button class="k-tab" role="tab" aria-selected="${statsRange === 'week'}" data-range="week">Week</button><button class="k-tab" role="tab" aria-selected="${statsRange === 'month'}" data-range="month">Month</button></div></div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily water for the ${statsRange === 'week' ? 'last 7' : 'last 30'} days">
        ${[0, 0.5, 1].map(f => `<text x="${padL - 6}" y="${y(max * f) + 4}" text-anchor="end">${(max * f / 1000).toFixed(1)} L</text>`).join('')}
        <line class="goal" x1="${padL}" x2="${W - 4}" y1="${y(S.goal)}" y2="${y(S.goal)}"/>
        ${days.map((d, i) => `<g class="hit" data-day="${d.k}"><rect x="${padL + i * bw}" y="${top}" width="${bw}" height="${H - padB - top}" fill="transparent"/><rect class="bar ${d.ml >= S.goal ? 'met' : ''} ${d.k === todayKey() ? 'today' : ''}" x="${padL + i * bw + bw * 0.18}" y="${y(d.ml)}" width="${bw * 0.64}" height="${Math.max(0, H - padB - y(d.ml))}" rx="${Math.min(6, bw * 0.2)}"/><text x="${padL + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${label(d)}</text></g>`).join('')}
      </svg>
      <div class="legend"><span><i style="background:var(--primary)"></i>Goal met</span><span><i style="background:var(--water-2)"></i>Below goal</span><span><i style="border:2px solid var(--ink)"></i>Today</span><span><i style="border-top:2px dashed var(--ink-muted);border-radius:0;height:0;width:14px"></i>Goal ${fmtMl(S.goal)}</span></div>
      <p class="muted" aria-live="polite" style="margin:0"><b style="color:var(--ink)">${picked.d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}:</b> ${fmtMl(picked.ml)}${picked.ml >= S.goal ? ', goal met' : ''}. Select a bar to see another day.</p>
      <ul class="k-sr-only">${days.map(d => `<li>${d.d.toDateString()}: ${d.ml} ml</li>`).join('')}</ul>
    </section>
    <div class="row-btns"><button class="k-btn k-btn-outline" id="csv">${icon(I.download)}Export CSV</button></div>
  </div>`;
  $('#main').querySelectorAll('[data-range]').forEach(b => (b.onclick = () => { statsRange = b.dataset.range; statsPick = null; renderStats(); $(`[data-range="${statsRange}"]`).focus(); }));
  $('#main').querySelectorAll('[data-day]').forEach(g => (g.onclick = () => { statsPick = g.dataset.day; renderStats(); }));
  $('#csv').onclick = exportCsv;
}

function exportCsv() {
  const rows = [['date', 'time', 'ml', 'sips'], ...entries.slice().sort((a, b) => a.t - b.t).map(e => [dayKey(e.t), new Date(e.t).toTimeString().slice(0, 5), e.ml, e.sips || ''])];
  const blob = new Blob([rows.map(r => r.join(',')).join('\n') + '\n'], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `sipbuddy-${todayKey()}.csv` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  say('CSV exported.');
}

// ---------- Settings ----------
function sw(id, label, on, help = '') {
  return `<label class="k-switch"><span><span class="label">${label}</span>${help ? `<br><span class="muted body-sm">${help}</span>` : ''}</span><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="k-switch-track" aria-hidden="true"></span></label>`;
}
function times(a, b, la, lb) {
  return `<div class="times"><label class="k-field"><span class="k-label">${la}</span><input type="time" id="${a}" value="${minToStr(S[a])}"></label><label class="k-field"><span class="k-label">${lb}</span><input type="time" id="${b}" value="${minToStr(S[b])}"></label></div>`;
}
function renderSettings() {
  const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#main').innerHTML = `
  <div class="settings">
    <h1>Settings</h1>
    <div class="grid2">
      <div style="display:grid;gap:16px">
        <section class="k-card sect" aria-labelledby="s-goal"><h2 id="s-goal">Goal</h2>
          <div class="range-row"><div class="head"><label class="k-label" for="goal">Daily goal</label><span class="val" id="goalV">${fmtMl(S.goal)}</span></div><input type="range" id="goal" min="1000" max="5000" step="100" value="${S.goal}"></div>
          <div class="range-row"><div class="head"><label class="k-label" for="perSip">Water per sip</label><span class="val" id="perSipV">${S.perSip} ml</span></div><input type="range" id="perSip" min="10" max="60" step="5" value="${S.perSip}"></div>
          <p class="help">Each sip the camera counts logs this much. About ${SIPS_TO_CLOSE} sips (${SIPS_TO_CLOSE * S.perSip} ml) close a reminder.</p>
        </section>
        <section class="k-card sect" aria-labelledby="s-rem"><h2 id="s-rem">Reminders</h2>
          ${sw('enabled', 'Remind me to drink', S.enabled)}
          <div class="k-field"><label class="k-label" for="interval">Every</label><select class="k-select" id="interval">${[30, 45, 60, 90, 120].map(v => `<option value="${v}" ${S.interval === v ? 'selected' : ''}>${v < 60 ? v + ' minutes' : v === 60 ? '1 hour' : v % 60 ? (v / 60) + ' hours' : v / 60 + ' hours'}</option>`).join('')}</select></div>
          ${times('start', 'end', 'From', 'Until')}
          <fieldset class="k-fieldset"><legend>Working days</legend><div class="days">${DAYS.map((d, i) => `<button type="button" data-dayi="${i}" aria-pressed="${S.days.includes(i)}" aria-label="${DAYN[i]}">${d}</button>`).join('')}</div></fieldset>
          ${sw('weekendHours', 'Different hours at the weekend', S.weekendHours)}<div class="subsw" id="weekendBox" ${S.weekendHours ? '' : 'hidden'}>${times('weekendStart', 'weekendEnd', 'Weekend from', 'Weekend until')}</div>
          ${sw('lunch', 'Lunch break', S.lunch, 'No reminders while you eat.')}<div class="subsw" id="lunchBox" ${S.lunch ? '' : 'hidden'}>${times('lunchStart', 'lunchEnd', 'Lunch from', 'Lunch until')}</div>
          ${sw('sleep', 'Sleep hours', S.sleep, 'Missed reminders never pile up: one catch-up, 5 minutes after you are back.')}<div class="subsw" id="sleepBox" ${S.sleep ? '' : 'hidden'}>${times('sleepStart', 'sleepEnd', 'Sleep from', 'Wake at')}</div>
          ${sw('stopAtGoal', 'Stop for the day at my goal', S.stopAtGoal)}
          ${sw('sound', 'Sounds', S.sound, 'A soft chime for a reminder and a pop for each sip.')}
          <div class="row-btns">${perm === 'granted' ? '<span class="muted body-sm">Notifications are on for when SipBuddy is in the background.</span>' : perm === 'denied' ? '<span class="muted body-sm">Notifications are blocked in this browser\'s site settings.</span>' : perm === 'unsupported' ? '<span class="muted body-sm">This browser cannot show notifications; reminders appear when SipBuddy is open.</span>' : `<button class="k-btn k-btn-sm k-btn-outline" id="askNotif2">${icon(I.bell, 'ico sm')}Turn on notifications</button>`}<button class="k-btn k-btn-sm k-btn-ghost" id="preview2">Show a reminder now</button></div>
        </section>
      </div>
      <div style="display:grid;gap:16px">
        <section class="k-card sect" aria-labelledby="s-per"><h2 id="s-per">Personality</h2>
          <div class="persons" role="radiogroup" aria-labelledby="s-per">${Object.entries(PERSONALITIES).map(([k, p]) => `<label><input type="radio" name="persona" value="${k}" ${S.personality === k ? 'checked' : ''}><div><b>${p.title}</b><span>${p.subtitle}</span></div></label>`).join('')}</div>
        </section>
        <section class="k-card sect" aria-labelledby="s-cam"><h2 id="s-cam">Camera</h2>
          ${sw('ownerOnly', 'Only count my sips', S.ownerOnly, 'SipBuddy learns your face once, so other people drinking in front of the camera don\'t count.')}
          <p class="help" style="margin:0">${owner && owner.sig?.length ? `Face learned ${new Date(owner.learnedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.` : 'Your face is learned the first time the camera opens.'}</p>
          <div class="row-btns"><button class="k-btn k-btn-sm k-btn-outline" id="learn">${icon(I.face, 'ico sm')}${owner && owner.sig?.length ? 'Learn my face again' : 'Learn my face'}</button>${owner && owner.sig?.length ? '<button class="k-btn k-btn-sm k-btn-ghost" id="forget">Forget my face</button>' : ''}</div>
          <p class="privacy">The camera is on only while a reminder or Drink now is open, and turns itself off after 10 minutes. Video is read on this device by MediaPipe models; nothing is recorded or uploaded.</p>
        </section>
        <section class="k-card sect" aria-labelledby="s-look"><h2 id="s-look">Appearance</h2>
          <div class="k-tabs" role="radiogroup" aria-label="Theme">${['system', 'light', 'dark'].map(t => `<button class="k-tab" role="radio" aria-checked="${S.theme === t}" aria-selected="${S.theme === t}" data-theme-v="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
          <div class="swatches" role="group" aria-label="Accent colour">${Object.entries(ACCENTS).map(([k, [n, c]]) => `<button style="background:${c}" data-accent-v="${k}" aria-pressed="${S.accent === k}" aria-label="${n}"></button>`).join('')}</div>
        </section>
        <section class="k-card sect" aria-labelledby="s-data"><h2 id="s-data">Your data</h2>
          <p class="help" style="margin:0">History stays in this browser. There's no account and no server.</p>
          <div class="row-btns"><button class="k-btn k-btn-sm k-btn-outline" id="csv2">${icon(I.download, 'ico sm')}Export CSV</button><button class="k-btn k-btn-sm k-btn-ghost" id="resetToday">Reset today</button></div>
          <p class="privacy">SipBuddy is a friendly reminder, not medical advice.</p>
        </section>
      </div>
    </div>
  </div>`;
  const M = $('#main');
  const bindRange = (id, fmt) => { const el = $('#' + id, M); el.oninput = () => { S[id] = +el.value; $('#' + id + 'V', M).textContent = fmt(S[id]); saveS(); }; };
  bindRange('goal', fmtMl); bindRange('perSip', v => v + ' ml');
  ['enabled', 'weekendHours', 'lunch', 'sleep', 'stopAtGoal', 'sound', 'ownerOnly'].forEach(id => { const el = $('#' + id, M); el.onchange = () => { S[id] = el.checked; saveS(); const box = $('#' + id + 'Box', M); if (box) box.hidden = !el.checked; }; });
  $('#interval', M).onchange = e => { S.interval = +e.target.value; saveS(); };
  ['start', 'end', 'weekendStart', 'weekendEnd', 'lunchStart', 'lunchEnd', 'sleepStart', 'sleepEnd'].forEach(id => { const el = $('#' + id, M); el.onchange = () => { if (el.value) { S[id] = strToMin(el.value); saveS(); } }; });
  M.querySelectorAll('[data-dayi]').forEach(b => (b.onclick = () => { const i = +b.dataset.dayi; S.days = S.days.includes(i) ? S.days.filter(x => x !== i) : [...S.days, i].sort(); b.setAttribute('aria-pressed', S.days.includes(i)); saveS(); }));
  M.querySelectorAll('[name=persona]').forEach(r => (r.onchange = () => { S.personality = r.value; saveS(); say(PERSONALITIES[r.value].title + ' chosen.'); }));
  M.querySelectorAll('[data-theme-v]').forEach(b => (b.onclick = () => { S.theme = b.dataset.themeV; saveS(); applyTheme(); renderSettings(); $(`[data-theme-v="${S.theme}"]`).focus(); }));
  M.querySelectorAll('[data-accent-v]').forEach(b => (b.onclick = () => { S.accent = b.dataset.accentV; saveS(); applyTheme(); renderSettings(); $(`[data-accent-v="${S.accent}"]`).focus(); }));
  $('#askNotif2', M)?.addEventListener('click', askNotifications);
  $('#preview2', M).onclick = () => fireReminder(true);
  $('#learn', M).onclick = () => openOverlay('learn');
  $('#forget', M)?.addEventListener('click', () => { owner = null; write('owner', null); renderSettings(); say('Face forgotten.'); });
  $('#csv2', M).onclick = exportCsv;
  $('#resetToday', M).onclick = () => { const k = todayKey(); const removed = entries.filter(e => dayKey(e.t) === k); if (!removed.length) return toast('Nothing logged today.'); entries = entries.filter(e => dayKey(e.t) !== k); saveE(); toast(`Cleared ${removed.length} entr${removed.length === 1 ? 'y' : 'ies'} from today`, 'Undo', () => { entries.push(...removed); saveE(); }); };
}

function rerender() { if ($('#overlay').hidden) route(); else pendingRender = true; }
let pendingRender = false;

// ---------- Toast ----------
let toastTimer;
function toast(text, action, fn) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  t.hidden = false; say(text);
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; fn(); rerender(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 6000);
}

// ---------- Sound ----------
let ac;
function tone(freqs, dur = 0.5, vol = 0.12) {
  if (!S.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    freqs.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.12;
      o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
    });
  } catch {}
}

// ---------- Notifications ----------
async function askNotifications() {
  write('notifAsked', true);
  try { await Notification.requestPermission(); } catch {}
  rerender();
}
async function notify(body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification('Time for water', { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'sipbuddy-reminder', renotify: true, requireInteraction: true });
    else new Notification('Time for water', { body, icon: 'icons/icon-192.png', tag: 'sipbuddy-reminder' });
  } catch {}
}

// ---------- Scheduler ----------
function fireReminder(preview = false) {
  if (!$('#overlay').hidden) return;
  const total = todayTotal();
  const ctx = { consumed: fmtMl(total), remaining: fmtMl(Math.max(0, S.goal - total)), progress: total / S.goal };
  const m = nextMessage(S.personality, ctx, st.lastMessageId);
  st.lastMessageId = m.id;
  if (!preview) { st.lastReminderAt = Date.now(); st.snoozedUntil = null; }
  saveSt();
  if (document.hidden) notify(m.text);
  tone([660, 880, 990], 0.7);
  openOverlay('reminder', m.text);
}
function tick() {
  if (DEMO || !$('#overlay').hidden) return;
  if (st.pausedUntil && st.pausedUntil !== -1 && st.pausedUntil <= Date.now()) { st.pausedUntil = null; saveSt(); }
  const n = nextAt();
  if (n && Date.now() >= n) fireReminder();
}
setInterval(tick, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); if ($('#overlay').hidden) route(); } });
navigator.serviceWorker?.addEventListener('message', e => { if (e.data === 'open-reminder' && $('#overlay').hidden) fireReminder(true); });

// ---------- Reminder / Drink now / Learn overlay ----------
let ov = null;
const STATUS = {
  loading: ['Starting the camera…', false],
  models: ['Loading the on-device models (the first time takes a few seconds)…', false],
  learning: ['Learning your face: look at the camera and hold still for a moment.', false],
  learned: ['Got it. Only your sips will count from now on.', false],
  looking: ['Looking for you. Sit in front of the camera.', true],
  ready: ['Lift your bottle or cup to your mouth and drink.', false],
  drinking: ['Drinking…', false],
  stranger: ["That's not you, so these sips won't count.", true],
  denied: ['Camera access is blocked. Allow it in the browser, or close this with ✕.', true],
  nocam: ['No camera found. Close this with ✕.', true],
  error: ['The detection models could not load. Check the connection, or close this with ✕.', true],
  off: ['The camera turned off after 10 minutes. Close this with ✕ when you have had some water.', true],
};

function openOverlay(mode, message = '') {
  const el = $('#overlay');
  const opener = document.activeElement;
  const needLearn = mode === 'learn' || (S.ownerOnly && !(owner && owner.sig?.length));
  const kicker = mode === 'reminder' ? 'Water reminder' : mode === 'drink' ? 'Drink now' : 'Learn my face';
  const title = mode === 'reminder' ? 'Time for water' : mode === 'drink' ? 'Take a few sips' : 'Let me learn your face';
  const sub = mode === 'reminder' ? message : mode === 'drink' ? `I'll count each sip and log ${S.perSip} ml for it. I save them 5 seconds after you stop.` : 'Then only your sips count, even if someone else drinks in front of the camera.';
  el.innerHTML = `
    <button class="ov-close" id="ovClose" aria-label="${mode === 'reminder' ? 'Close reminder' : 'Close'}">${icon(I.close)}</button>
    <div class="ov-body">
      <div>
        <p class="ov-kicker">${kicker}</p>
        <h2 class="ov-title" id="ov-title">${esc(title)}</h2>
        <p class="ov-sub">${esc(sub)}</p>
        ${mode !== 'learn' ? `<div class="sipdots" aria-hidden="true">${mode === 'reminder' ? [...Array(SIPS_TO_CLOSE)].map(() => '<i></i>').join('') : ''}</div><p class="ov-count num" id="ovCount" aria-live="polite">${mode === 'reminder' ? `0 of ${SIPS_TO_CLOSE} sips` : '0 sips so far'}</p>` : ''}
        <p class="ov-status" id="ovStatus"><span class="pulse"></span><span></span></p>
        <div class="ov-actions">${mode === 'reminder' ? '<button class="k-btn k-btn-sm" id="ovSnooze">Snooze 15 min</button>' : mode === 'drink' ? '<button class="k-btn k-btn-sm" id="ovDone">Done</button>' : ''}</div>
      </div>
      <div class="cam"><video id="ovVideo" playsinline muted></video><canvas id="ovCanvas"></canvas><span class="rec" id="ovRec" hidden>Camera on · stays on this device</span><div class="cam-msg" id="ovCamMsg">${icon(I.cam)}</div></div>
    </div>`;
  el.hidden = false; document.body.style.overflow = 'hidden';
  ov = { mode, sips: 0, opener, stream: null, session: null, timers: [], idle: null, done: false };
  const setStatus = code => {
    const [text, warn] = STATUS[code] || STATUS.looking;
    const s = $('#ovStatus'); if (!s) return; s.classList.toggle('warn', warn); s.lastElementChild.textContent = text;
    if (['denied', 'nocam', 'error', 'off', 'learned', 'stranger'].includes(code)) say(text);
  };
  setStatus('loading');
  $('#ovClose').onclick = () => closeOverlay();
  $('#ovSnooze')?.addEventListener('click', () => { st.snoozedUntil = Date.now() + 15 * 60000; saveSt(); closeOverlay(); toast('Snoozed for 15 minutes.'); });
  $('#ovDone')?.addEventListener('click', () => finishDrink());
  el.onkeydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); }
    if (e.key === 'Tab') { const f = [...el.querySelectorAll('button')]; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
  };
  $('#ovClose').focus();
  say(`${title}. ${sub}`);

  const video = $('#ovVideo'), canvas = $('#ovCanvas'), ctx2 = canvas.getContext('2d');
  if (!navigator.mediaDevices?.getUserMedia) { setStatus('nocam'); $('#ovCamMsg').textContent = 'No camera available'; return; }
  loadModels().catch(() => {}); // start downloading while the camera permission prompt is open
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }).then(async stream => {
    if (!ov || ov.done) { stream.getTracks().forEach(t => t.stop()); return; }
    ov.stream = stream; video.srcObject = stream; await video.play().catch(() => {});
    $('#ovCamMsg').remove(); $('#ovRec').hidden = false; setStatus('models');
    ov.timers.push(setTimeout(() => { stopCamera(); setStatus('off'); }, CAMERA_LIMIT_MS));
    ov.session = createSession({
      video, owner: owner && owner.sig?.length ? owner : null, learn: needLearn, ownerCheck: S.ownerOnly || mode === 'learn',
      onStatus: (code) => setStatus(code),
      onLearned: o => { owner = o; write('owner', o); if (mode === 'learn') ov.timers.push(setTimeout(() => closeOverlay(), 1600)); },
      onSip: n => onSip(n),
      onFrame: f => draw(ctx2, canvas, f),
    });
  }).catch(err => {
    if (!ov) return;
    const code = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'denied' : 'nocam';
    setStatus(code); const m = $('#ovCamMsg'); if (m) m.textContent = code === 'denied' ? 'Camera access blocked' : 'No camera found';
  });
}

function draw(ctx, canvas, f) {
  if (canvas.width !== f.w) { canvas.width = f.w; canvas.height = f.h; }
  ctx.clearRect(0, 0, f.w, f.h);
  ctx.lineWidth = 3;
  if (f.best) { const b = f.best.box; ctx.strokeStyle = f.isOwner ? '#4cc79a' : '#f2b44a'; ctx.strokeRect(b.x, b.y, b.w, b.h); }
  if (f.mouth) { ctx.fillStyle = f.drinking ? '#4fb3e8' : '#ffffff'; ctx.beginPath(); ctx.arc(f.mouth.x, f.mouth.y, 6, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#ffffffcc';
  f.hands.forEach(lm => [0, 4, 8, 12, 16, 20].forEach(i => { ctx.beginPath(); ctx.arc(lm[i].x * f.w, lm[i].y * f.h, 4, 0, 7); ctx.fill(); }));
  (f.objects || lastObjects).forEach(d => { const b = d.boundingBox; ctx.strokeStyle = '#4fb3e8'; ctx.strokeRect(b.originX, b.originY, b.width, b.height); });
  if (f.objects) lastObjects = f.objects;
}
let lastObjects = [];

function onSip(n) {
  if (!ov || ov.done) return;
  ov.sips = n;
  tone([520 + n * 40], 0.25, 0.1);
  const p = document.createElement('div'); p.className = 'pop'; p.textContent = '+' + S.perSip + ' ml'; p.setAttribute('aria-hidden', 'true'); $('#overlay').append(p); setTimeout(() => p.remove(), 1000);
  if (ov.mode === 'reminder') {
    $('#overlay').querySelectorAll('.sipdots i').forEach((d, i) => d.classList.toggle('on', i < n));
    $('#ovCount').textContent = `${Math.min(n, SIPS_TO_CLOSE)} of ${SIPS_TO_CLOSE} sips`;
    if (n >= SIPS_TO_CLOSE) {
      ov.done = true; addEntry(n); stopCamera();
      $('#ov-title').textContent = 'Nice. Well done!';
      $('#ovStatus').lastElementChild.textContent = `${n} sips, ${fmtMl(n * S.perSip)} logged.`;
      say(`Well done. ${n} sips logged.`); tone([784, 988, 1175], 0.6);
      ov.timers.push(setTimeout(() => closeOverlay(true), 1800));
    }
  } else if (ov.mode === 'drink') {
    $('#ovCount').textContent = `${n} sip${n === 1 ? '' : 's'} so far · ${fmtMl(n * S.perSip)}`;
    clearTimeout(ov.idle); ov.idle = setTimeout(() => finishDrink(), DRINK_NOW_IDLE_MS);
  }
}

function finishDrink() {
  if (!ov || ov.done) return;
  ov.done = true; const n = ov.sips;
  if (n) { addEntry(n); toast(`Logged ${n} sip${n === 1 ? '' : 's'}, ${fmtMl(n * S.perSip)}.`); }
  closeOverlay(true);
}

function stopCamera() {
  if (!ov) return;
  ov.session?.stop(); ov.session = null;
  const rec = $('#ovRec'); if (rec) rec.hidden = true;
  ov.stream?.getTracks().forEach(t => t.stop()); ov.stream = null;
}

function closeOverlay(skipLog = false) {
  if (!ov) return;
  if (!skipLog && !ov.done && ov.sips) { ov.done = true; addEntry(ov.sips); toast(`Logged ${ov.sips} sip${ov.sips === 1 ? '' : 's'}, ${fmtMl(ov.sips * S.perSip)}.`); }
  stopCamera(); ov.timers.forEach(clearTimeout); clearTimeout(ov.idle);
  const opener = ov.opener; ov = null;
  const el = $('#overlay'); el.hidden = true; el.innerHTML = ''; document.body.style.overflow = '';
  pendingRender = false; route();
  (opener && document.contains(opener) ? opener : $('#main')).focus?.();
}

route();
if (!DEMO) setTimeout(tick, 1500);
if (new URLSearchParams(location.search).get('open') === 'reminder') setTimeout(() => fireReminder(true), 300);
