// DOM integration check: npm install --prefix /tmp/oura-dom-check jsdom@26
// NODE_PATH=/tmp/oura-dom-check/node_modules node tools/test_day_view.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM(fs.readFileSync('dashboard/web/index.html', 'utf8'), {
  url: 'http://localhost:8090', runScripts: 'outside-only',
});
const w = dom.window;
w.HTMLElement.prototype.scrollIntoView = function () {};
w.TextDecoder = TextDecoder;
const requests = [];
w.fetch = async url => {
  requests.push(url);
  return { ok: true, json: async () => ({ minutes: 15, bins: [], latest: null }) };
};
w.eval(fs.readFileSync('dashboard/web/app.js', 'utf8').replace(/load\(\);\s*$/, '') + '\nwindow.openDayPage = openDayPage; window.toggleLive = toggleLive;');
const start = Date.UTC(2026, 8, 25, 22) / 1000;
const night = { ymd: '2026-09-25', wake_ymd: '2026-09-26', start_unix: start,
  end_unix: start + 8 * 3600, start: '22:00', end: '06:00', in_bed_h: 8,
  stages_full: [2, 0, 4], staging_complete: false, metrics: {},
  series_t: { motion: [[start + 60, 2]], hr: [[start, 60], [start + 300, 62]] }, series: {} };
const data = { tz: 5.75, nights: [night], activity_daily: {}, activity_profile: {}, activity: [] };
w.openDayPage(data, '2026-09-26');
assert(w.document.querySelector('#sec-sleep'));
assert(w.document.querySelector('#sec-activity'));
assert(w.document.querySelector('#sec-heart'));
assert(w.document.querySelector('#sec-sleep').textContent.includes('Incomplete sleep analysis'));
assert(!w.document.querySelector('#sec-sleep').textContent.includes('Efficiency of'));
const motion = [...w.document.querySelectorAll('.tl-row')].find(row => row.textContent.includes('Motion'));
// A sparse motion measurement must remain visible and must not become a smooth curve.
assert(motion, 'motion lane missing');
assert(!motion.querySelector('path'));
// An NSSA night also gets the official app's 5-minute chart, laid from its first epoch.
const nssa = { ...data, nights: [{ ...night, stages_full: new Array(40).fill(2), staging_complete: true,
  staging_source: 'nssa', stages_5min: [4, 2, 1, 3], stages_t0_unix: start - 20 }] };
w.openDayPage(nssa, '2026-09-26');
const lanes = [...w.document.querySelectorAll('.tl-row')].map(row => row.textContent);
// Every window the ring recorded is shown as what it is: the main night, a nap, other
// sleep outside the daytime window, or a rest. None is dropped and none replaces the night.
const win = (o) => ({ ...night, stages_full: [2, 2, 2, 2], stages: [2, 2], staging_complete: true,
  metrics: { asleep_min: 60 }, efficiency: 80, deep_pct: 0, light_pct: 100, rem_pct: 0, wake_pct: 0, ...o });
const kinds = { ...data, nights: [
  win({ sleep_kind: 'main', is_nap: false, in_bed_h: 8 }),
  win({ sleep_kind: 'nap', is_nap: true, start: '13:00', end: '14:00', in_bed_h: 1, start_unix: start + 15 * 3600 }),
  win({ sleep_kind: 'other', is_nap: false, start: '20:30', end: '21:40', in_bed_h: 1.2, start_unix: start - 2 * 3600 }),
  win({ sleep_kind: 'rest', is_nap: false, start: '15:00', end: '15:12', in_bed_h: 0.2, start_unix: start + 17 * 3600,
        metrics: {}, stages_full: [4, 4], efficiency: 0 }),
] };
w.openDayPage(kinds, '2026-09-26');
const sleepText = w.document.querySelector('#sec-sleep').textContent;
assert(sleepText.includes('Other sleep'), 'non-daytime sleep beside the night must be shown');
assert(sleepText.includes('13:00') && sleepText.includes('20:30'), 'nap and other sleep both listed');
assert(sleepText.includes('Rest 15:00') && sleepText.includes('no sleep detected'), 'rest is named, not hidden');
assert.equal(w.document.querySelectorAll('#sec-sleep .nap-item').length, 2, 'a rest is not drawn as sleep');
// a payload from before `sleep_kind` still honours `is_nap`
const legacy = { ...data, nights: [win({ in_bed_h: 8 }), win({ is_nap: true, start: '13:00', end: '14:00', in_bed_h: 1 })] };
w.openDayPage(legacy, '2026-09-26');
assert.equal(w.document.querySelectorAll('#sec-sleep .nap-item').length, 1);
assert(lanes.some(t => t.includes('Stages · 5 min (Oura app)')), '5-minute Oura lane missing');
assert(lanes.some(t => t.includes('Stages') && !t.includes('5 min')), '30 s stage lane missing');
const absent = { ...data, nights: [{ ...night, start_ds: 10000, end_ds: 298000, stages_full: [] }] };
w.openDayPage(absent, '2026-09-26');
assert(w.document.querySelector('#sec-sleep').textContent.includes('stages are unavailable'));
assert(!w.document.querySelector('#sec-sleep').textContent.includes('Incomplete sleep analysis'));
const editBtn = w.document.querySelector('.bedtime-edit-btn');
const editorForm = w.document.querySelector('.bedtime-editor');
assert(editBtn && editorForm && editorForm.hidden);
editBtn.click();
assert(!editorForm.hidden);
setImmediate(async () => {
  assert(w.document.querySelector('#sec-heart').textContent.includes('No heart-rate readings'));
  assert(requests.some(url => url.includes('/api/hourly-hr')));
  w.fetch = async () => ({ ok: true, body: new ReadableStream({start(controller) {
    controller.enqueue(new TextEncoder().encode('{"error":"Ring is busy; wait for the current operation to finish."}\n'));
    controller.close();
  }}) });
  await w.toggleLive();
  assert(w.document.getElementById('live-status').textContent.includes('Ring is busy'));
  assert.equal(w.document.getElementById('live-label').textContent, 'Start');
  console.log('Day view DOM integration checks passed');
  dom.window.close();
});
