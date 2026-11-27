// vitality.js — Proof-of-Life Audit & Website Badge generator (<= 256 LOC)
(function (w) {
  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function summarize(r) {
    const total = r.total || 0;
    const vitality = total === 0 ? 0 : Math.max(0, 100 - (r.index || 0));
    const entries = Array.isArray(r.entries) ? r.entries : [];
    let sustained = 0;
    let oneShot = 0;
    for (const e of entries) {
      if (e.stillborn) oneShot++;
      else if (e.fate === 'alive' || e.fate === 'cooling') sustained++;
    }
    const d = r.daysSinceAnyPush;
    const lastPush = d == null ? 'never' : d === 0 ? 'today' : d + 'd ago';

    let verdict;
    if (total === 0) {
      verdict = { cls: 'rot', label: 'NO PUBLIC REPOS', color: '#ff5470',
        note: 'No owned public repositories found to verify.' };
    } else if (vitality >= 70 && d != null && d <= 30 && sustained > 0) {
      verdict = { cls: 'alive', label: 'VERIFIED ACTIVE', color: '#7dffa8',
        note: 'Sustained maintenance signal — active commits beyond one-shot weekend dumps.' };
    } else if (vitality >= 40) {
      verdict = { cls: 'mixed', label: 'MIXED MAINTENANCE', color: '#e8b34b',
        note: 'Some living repos alongside cooling or one-shot projects.' };
    } else {
      verdict = { cls: 'rot', label: 'AI-ROT / ABANDONMENT RISK', color: '#ff5470',
        note: 'High share of dormant, archived, or single-day throwaway repositories.' };
    }

    return { total, vitality, sustained, oneShot, lastPush, verdict };
  }

  function badgeHtml(r, s) {
    const u = encodeURIComponent(r.subject || '');
    const href = `https://necrometer.dev/?u=${u}`;
    const label = escHtml(`${s.vitality}% Active`);
    return `<a href="${href}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:#0c0a16;border:1px solid #322a4d;color:#e8e4d8;font:13px/1.2 ui-monospace,monospace;text-decoration:none"><span style="width:8px;height:8px;border-radius:50%;background:${s.verdict.color};display:inline-block"></span><span>Proof of Life: ${label}</span><span style="color:#8a80a8">· necrometer.dev</span></a>`;
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderPreview(container, r, s) {
    const a = document.createElement('a');
    a.href = `https://necrometer.dev/?u=${encodeURIComponent(r.subject || '')}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:#0c0a16;border:1px solid #322a4d;color:#e8e4d8;font:13px/1.2 ui-monospace,monospace;text-decoration:none';
    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${s.verdict.color};display:inline-block`;
    const main = el('span', '', `Proof of Life: ${s.vitality}% Active`);
    const tag = el('span', '', '· necrometer.dev');
    tag.style.color = '#8a80a8';
    a.append(dot, main, tag);
    container.replaceChildren(a);
  }

  function render(r) {
    const s = summarize(r);
    const panel = document.getElementById('vitality-panel');
    if (panel) {
      const head = el('div', 'audit-head');
      head.append(el('span', 'dim', 'PROOF-OF-LIFE AUDIT'), el('span', 'verdict ' + s.verdict.cls, s.verdict.label));
      const note = el('p', 'audit-note', s.verdict.note);
      const grid = el('div', 'audit-grid');
      const items = [
        ['Vitality', s.vitality + '%'],
        ['Last Push', s.lastPush],
        ['Sustained', String(s.sustained)],
        ['One-Shot Dumps', String(s.oneShot)],
      ];
      for (const [k, v] of items) {
        const box = el('div', 'audit-stat');
        box.append(el('b', '', v), el('span', '', k));
        grid.appendChild(box);
      }
      panel.replaceChildren(head, note, grid);
    }

    const preview = document.getElementById('webbadge-preview');
    if (preview) renderPreview(preview, r, s);
    const code = document.getElementById('webbadge');
    if (code) code.textContent = badgeHtml(r, s);
  }

  w.NecroVitality = { summarize, badgeHtml, render };
})(window);
