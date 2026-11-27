// vitality.js — Proof-of-Life Audit, URL parser & Website Badge (<= 256 LOC)
(function (w) {
  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseSubject(raw) {
    let s = String(raw || '').trim().replace(/^@+/, '');
    if (!s) return { owner: '', repo: null };
    s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '')
      .replace(/^(www\.)?github\.com\//i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
    const parts = s.split('/').filter(Boolean);
    const owner = parts[0] || '';
    const repo = parts[1] ? parts[1].replace(/\.git$/i, '') : null;
    return { owner, repo };
  }

  function summarize(r) {
    const total = r.total || 0;
    const vitality = total === 0 ? 0 : Math.max(0, 100 - (r.index || 0));
    const entries = Array.isArray(r.entries) ? r.entries : [];
    let sustained = 0;
    let oneShot = 0;
    for (const e of entries) {
      if (e.stillborn) {
        if (e.fate !== 'alive') oneShot++;
      } else if (e.fate === 'alive' || e.fate === 'cooling') {
        sustained++;
      }
    }
    const d = r.daysSinceAnyPush;
    const lastPush = d == null ? 'never' : d === 0 ? 'today' : d + 'd ago';
    const aliveCount = (r.counts && r.counts[0]) || 0;

    let verdict;
    if (total === 0) {
      verdict = { cls: 'rot', label: 'NO PUBLIC REPOS', color: '#ff5470',
        note: 'No owned public repositories found to verify.' };
    } else if (r.lowSample && sustained === 0 && aliveCount > 0) {
      verdict = { cls: 'mixed', label: 'TOO NEW TO VERIFY', color: '#e8b34b',
        note: 'Freshly created (<24h commit span). Check back after sustained commits across multiple days to prove it is not a weekend dump.' };
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

  function targetParam(r, focusedRepo) {
    const owner = String(r.subject || '');
    return focusedRepo ? `${owner}/${focusedRepo}` : owner;
  }

  function badgeHtml(r, _s, focusedRepo) {
    const u = encodeURIComponent(targetParam(r, focusedRepo));
    const href = `https://necrometer.dev/?u=${u}`;
    return `<a href="${href}" target="_blank" rel="noopener" title="Check live repository vitality on necrometer.dev" style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:#0c0a16;border:1px solid #322a4d;color:#e8e4d8;font:13px/1.2 ui-monospace,monospace;text-decoration:none"><span style="width:8px;height:8px;border-radius:50%;background:#7dffa8;display:inline-block"></span><span>Proof of Life</span><span style="color:#8a80a8">· Verify live on necrometer.dev →</span></a>`;
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderPreview(container, r, s, focusedRepo) {
    const a = document.createElement('a');
    a.href = `https://necrometer.dev/?u=${encodeURIComponent(targetParam(r, focusedRepo))}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:#0c0a16;border:1px solid #322a4d;color:#e8e4d8;font:13px/1.2 ui-monospace,monospace;text-decoration:none';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#7dffa8;display:inline-block';
    const main = el('span', '', 'Proof of Life');
    const tag = el('span', '', '· Verify live on necrometer.dev →');
    tag.style.color = '#8a80a8';
    a.append(dot, main, tag);
    container.replaceChildren(a);
  }

  function formatCommitAudit(ca) {
    if (!ca) return '';
    if (ca.humanCount === 0 && ca.botCount > 0) {
      return ` · ⚠ 0 human commits in latest ${ca.totalFetched} (${ca.botCount} bot-only)`;
    }
    const when = ca.lastHumanDays === 0 ? 'today' : ca.lastHumanDays + 'd ago';
    const span = ca.humanSpanDays < 7 && ca.totalFetched < 15
      ? ' · <7d burst'
      : ca.humanSpanDays >= 7 ? ` · ${ca.humanSpanDays}d+ span` : '';
    return ` · last human commit ${when} · ${ca.authorsCount} human author(s) · ${ca.botCount} bot filtered${span}`;
  }

  function render(r, focusedRepo, commitAudit) {
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
      const children = [head, note, grid];
      if (focusedRepo) {
        const match = (r.entries || []).find((e) => (e.name || '').toLowerCase() === focusedRepo.toLowerCase());
        const base = match
          ? `${r.subject}/${match.name}: ${match.fate} · last push ${match.daysIdle}d ago · ${match.stillborn ? 'single-day commit span' : 'sustained history'}`
          : `${r.subject}/${focusedRepo}: not found among owned public repos (forks excluded)`;
        children.push(el('div', 'repo-focus', base + formatCommitAudit(commitAudit)));
      }
      panel.replaceChildren(...children);
    }

    const preview = document.getElementById('webbadge-preview');
    if (preview) renderPreview(preview, r, s, focusedRepo);
    const code = document.getElementById('webbadge');
    if (code) code.textContent = badgeHtml(r, s, focusedRepo);
  }

  w.NecroVitality = { parseSubject, summarize, badgeHtml, render };
})(window);
