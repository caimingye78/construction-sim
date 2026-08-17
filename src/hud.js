// Overlay HUD: log, progress, validation stats, footer, final report.

const $ = (s) => document.querySelector(s);

export class Hud {
  constructor() {
    this.logEl = $('#log-list');
    this.progFill = $('#prog-fill');
    this.progText = $('#prog-text');
    this.progPct = $('#prog-pct');
    this.foot = $('#foot-status');
    this.valBody = $('#val-body');
    this.report = $('#report-overlay');
    this.entries = 0;
  }

  log(msg, kind = 'info') {
    const row = document.createElement('div');
    row.className = `log-row log-${kind}`;
    const t = new Date().toLocaleTimeString('en-GB', { hour12: false });
    row.innerHTML = `<span class="t">${t}</span>${msg}`;
    this.logEl.appendChild(row);
    while (this.logEl.children.length > 40) this.logEl.firstChild.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  setPhase(done, total) {
    const pct = Math.round((done / total) * 100);
    this.progFill.style.width = pct + '%';
    this.progText.textContent = `${done} / ${total} components`;
    this.progPct.textContent = pct + '%';
  }

  setFoot(text, kind = 'info') {
    this.foot.textContent = text;
    this.foot.style.color = kind === 'ok' ? 'var(--accent2)' : kind === 'warn' ? '#ffd166' : 'var(--dim)';
  }

  setVal({ placed, expected, maxDev, warn, reseat }) {
    const lines = [
      ['Placed', `${placed} / ${expected}`],
      ['Max deviation', `${(maxDev * 100).toFixed(0)} cm`],
      ['Warnings', String(warn)],
      ['Re-lifts', String(reseat)],
    ];
    const rowCls = (v) => (v === '0' || v === `${expected}` ? 'ok' : warn > 0 ? 'warn' : '');
    this.valBody.innerHTML = lines
      .map(([k, v]) => `<div class="val-line ${rowCls(v)}"><span>${k}</span><span>${v}</span></div>`)
      .join('');
  }

  report(r) {
    $('#report-grid').innerHTML = [
      ['Components erected', String(r.total)],
      ['Validated OK', String(r.ok)],
      ['Deviation warnings', String(r.warn)],
      ['Re-lifts', String(r.retries)],
      ['Max positional deviation', `${(r.maxDev * 100).toFixed(0)} cm`],
      ['Total build time', `${r.duration.toFixed(1)} s`],
    ].map(([k, v]) => `<div class="rg-item"><span>${k}</span><span>${v}</span></div>`).join('');
    const verdict = $('#report-verdict');
    verdict.textContent = r.verdict;
    verdict.className = r.passed ? '' : 'warn';
    this.report.classList.remove('hidden');
  }
}
