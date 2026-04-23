(function () {
  'use strict';

  /* ── 무료 한도 ── */
  const FREE_LIMITS = {
    'gemini-2.5-flash':      { rpm: 10,  rpd: 250  },
    'gemini-2.5-flash-lite': { rpm: 15,  rpd: 1000 },
    'gemini-1.5-flash':      { rpm: 15,  rpd: 1500 },
  };
  const WARN_THRESHOLD = 0.8;

  /* ── DOM ── */
  const $ = id => document.getElementById(id);
  const btnRecord    = $('btnRecord');
  const btnClear     = $('btnClear');
  const btnSummarize = $('btnSummarize');
  const btnObsidian  = $('btnObsidian');
  const btnEmail     = $('btnEmail');
  const btnMd        = $('btnMd');
  const apiKeyInput  = $('apiKey');
  const modelSel     = $('modelSel');
  const statusEl     = $('status');
  const txArea       = $('transcript');
  const emptyState   = $('emptyState');
  const cardsEl      = $('cards');
  const loadingEl    = $('loading');
  const errBox       = $('errBox');

  /* ── State ── */
  let isRecording = false, recognition = null, rawText = '';
  let rpmLog = [];
  let saved = { original:'', summary:'', schedule:'', actionItems:'' };

  /* ── Persist key ── */
  apiKeyInput.value = localStorage.getItem('gmk') || '';
  apiKeyInput.addEventListener('change', () => localStorage.setItem('gmk', apiKeyInput.value));

  /* ── Auto-fill 일시 ── */
  function formatDateTime(d) {
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  $('mDate').value = formatDateTime(new Date());

  /* ── 메타 데이터 수집 ── */
  function getMeta() {
    return {
      title:     $('mTitle').value.trim()     || '(제목 없음)',
      date:      $('mDate').value.trim()      || formatDateTime(new Date()),
      location:  $('mLocation').value.trim()  || '',
      attendees: $('mAttendees').value.trim() || '',
      agenda:    $('mAgenda').value.trim()    || '',
      tags:      $('mTags').value.trim()      || '',
    };
  }

  /* ── Toast ── */
  function toast(msg, type = 'ok') {
    const el = $('toast');
    el.textContent = msg;
    el.className = `toast ${type} on`;
    setTimeout(() => { el.className = 'toast'; }, 3500);
  }

  /* ── Error box ── */
  function showErr(msg) { errBox.textContent = '⚠ ' + msg; errBox.className = 'err-box on'; }
  function hideErr()    { errBox.className = 'err-box'; }

  /* ── Quota ── */
  function getTodayKey() {
    const pt = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    return 'gm_usage_' + pt;
  }
  function getUsage(model) {
    try { return JSON.parse(localStorage.getItem(getTodayKey()) || '{}')[model] || 0; } catch { return 0; }
  }
  function incrementUsage(model) {
    const key = getTodayKey();
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    data[model] = (data[model] || 0) + 1;
    localStorage.setItem(key, JSON.stringify(data));
    return data[model];
  }
  function updateQuotaBadge() {
    const model = modelSel.value;
    const used  = getUsage(model);
    const limit = FREE_LIMITS[model]?.rpd || 250;
    const pct   = used / limit;
    const el    = $('quotaBadge');
    if (!el) return;
    el.textContent = '남은 횟수: ' + (limit - used) + '/' + limit;
    el.className   = 'quota-badge ' + (pct >= 1 ? 'quota-over' : pct >= WARN_THRESHOLD ? 'quota-warn' : 'quota-ok');
  }
  modelSel.addEventListener('change', updateQuotaBadge);

  function checkQuota(model) {
    const used  = getUsage(model);
    const limit = FREE_LIMITS[model]?.rpd || 250;
    if (used >= limit) throw new Error(`일일 무료 한도 초과 (${used}/${limit}회)\n→ 모델 변경 또는 내일 다시 시도하세요.`);
    if (used / limit >= WARN_THRESHOLD) {
      if (!confirm(`⚠ 무료 한도 ${Math.round(used/limit*100)}% 사용 (${used}/${limit}회)\n계속 진행하시겠습니까?`))
        throw new Error('사용자가 취소했습니다.');
    }
    const now = Date.now();
    rpmLog = rpmLog.filter(t => now - t < 60000);
    if (rpmLog.length >= (FREE_LIMITS[model]?.rpm || 10))
      throw new Error(`분당 요청 한도 초과\n1분 후 다시 시도해주세요.`);
  }

  function syncBtn() { btnSummarize.disabled = txArea.value.trim().length < 10; }

  /* ── Speech Recognition ── */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const MIC_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';

  if (SR) {
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ko-KR';
    recognition.onstart = () => {
      statusEl.innerHTML = '<span class="dot"></span> 녹음 중...';
      statusEl.className = 'status rec';
      btnRecord.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Stop';
      btnRecord.className = 'btn btn-rec';
    };
    recognition.onend   = () => { if (isRecording) recognition.start(); };
    recognition.onerror = e  => { if (e.error !== 'no-speech') toast('음성 오류: ' + e.error, 'err'); };
    recognition.onresult = event => {
      let interim = '', final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t + ' ';
        else interim += t;
      }
      if (final) rawText += final + '\n';
      txArea.value = rawText + interim;
      txArea.scrollTop = txArea.scrollHeight;
      syncBtn();
    };
  } else {
    statusEl.textContent = 'Chrome에서만 음성 인식이 지원됩니다.';
    btnRecord.disabled = true;
  }

  btnRecord.addEventListener('click', () => {
    if (!recognition) return;
    if (!isRecording) { isRecording = true; recognition.start(); }
    else {
      isRecording = false; recognition.stop();
      statusEl.textContent = 'Ready to record'; statusEl.className = 'status';
      btnRecord.innerHTML = MIC_ICON + ' Start Recording'; btnRecord.className = 'btn btn-red';
    }
  });

  btnClear.addEventListener('click', () => {
    if (!confirm('회의록을 모두 지우시겠습니까?')) return;
    rawText = ''; txArea.value = '';
    saved = { original:'', summary:'', schedule:'', actionItems:'' };
    emptyState.style.display = 'flex'; cardsEl.style.display = 'none'; hideErr();
    [btnSummarize, btnObsidian, btnEmail, btnMd].forEach(b => b.disabled = true);
  });

  txArea.addEventListener('input', () => { if (!isRecording) rawText = txArea.value; syncBtn(); });

  /* ══════════════════════════════
     Gemini API
  ══════════════════════════════ */
  async function callGemini(apiKey, text, model) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
    const prompt =
`당신은 LG전자의 전문적인 회의록 요약 AI 비서입니다.
아래 회의 내용을 분석하고 반드시 아래 3개의 XML 태그만 사용하여 응답하세요.
다른 텍스트나 마크다운 없이 태그만 출력하세요.

<summary>핵심 요약 (3~5줄, 한국어로 명확하게)</summary>
<schedule>언급된 일정·마감일을 줄바꿈으로 구분. 없으면 → 언급된 일정 없음</schedule>
<action_items>할 일 목록을 줄바꿈으로 구분. 담당자 있으면 [담당자] 표시. 없으면 → 없음</action_items>

--- 회의록 ---
${text}`;

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
        })
      });
    } catch (e) {
      throw new Error('네트워크 오류\n' + e.message + '\n\n→ 인터넷 연결 및 Chrome 브라우저를 확인하세요.');
    }

    if (!res.ok) {
      let detail = 'HTTP ' + res.status;
      try { detail = (await res.json())?.error?.message || detail; } catch (_) {}
      const guide = {
        403: 'API 키 오류 (403)\n→ aistudio.google.com/apikey 에서 확인',
        404: '모델을 찾을 수 없음 (404)\n→ 다른 모델 선택',
        429: '요청 한도 초과 (429)\n→ 1분 후 재시도 또는 모델 변경'
      };
      throw new Error((guide[res.status] || '') + '\n원문: ' + detail);
    }

    const json = await res.json();
    const content = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('Gemini 응답이 비어있습니다.');
    return content;
  }

  /* ── Generate ── */
  btnSummarize.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) { toast('API 키를 먼저 입력하세요.', 'err'); apiKeyInput.focus(); return; }
    const text = txArea.value.trim();
    if (!text) return;

    try { checkQuota(modelSel.value); } catch (e) { showErr(e.message); return; }

    saved.original = text;
    hideErr();
    btnSummarize.disabled = true; btnSummarize.textContent = '분석 중...';
    loadingEl.className = 'loading on';
    emptyState.style.display = 'none'; cardsEl.style.display = 'none';

    try {
      rpmLog.push(Date.now());
      const raw = await callGemini(key, text, modelSel.value);
      console.log('[Gemini]', raw);

      const extract = tag => {
        const m = raw.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
        return m ? m[1].trim() : null;
      };
      saved.summary     = extract('summary')      || raw;
      saved.schedule    = extract('schedule')     || '언급된 일정 없음';
      saved.actionItems = extract('action_items') || '없음';

      $('cSummary').textContent  = saved.summary;
      $('cSchedule').textContent = saved.schedule;
      $('cAction').textContent   = saved.actionItems;

      cardsEl.style.display = 'flex';
      [btnObsidian, btnEmail, btnMd].forEach(b => b.disabled = false);

      const used  = incrementUsage(modelSel.value);
      const limit = FREE_LIMITS[modelSel.value]?.rpd || 250;
      updateQuotaBadge();
      const remaining = limit - used;
      toast(remaining <= 5
        ? '요약 완료 ✓ — ⚠ 오늘 남은 횟수: ' + remaining + '회'
        : '요약 완료 ✓  (' + used + '/' + limit + '회 사용)', 'ok');

    } catch (e) {
      console.error(e); showErr(e.message); emptyState.style.display = 'flex';
    } finally {
      loadingEl.className = 'loading';
      btnSummarize.textContent = '✨ Generate Summary'; btnSummarize.disabled = false;
    }
  });

  /* ══════════════════════════════════════════════
     📄 템플릿 생성 함수
  ══════════════════════════════════════════════ */

  /** Obsidian .md 템플릿 (YAML frontmatter 포함) */
  function buildMarkdown(meta) {
    const tagList = meta.tags
      ? meta.tags.split(/[\s,]+/).filter(Boolean).map(t => t.startsWith('#') ? t.slice(1) : t)
      : [];

    const lines = [
      '---',
      'title: "' + meta.title + '"',
      'date: ' + meta.date,
      meta.location  ? 'location: "' + meta.location + '"'    : null,
      meta.attendees ? 'attendees: "' + meta.attendees + '"'  : null,
      meta.agenda    ? 'agenda: "' + meta.agenda + '"'        : null,
      tagList.length ? 'tags: [' + tagList.map(t => '"' + t + '"').join(', ') + ']' : null,
      '---',
      '',
      '# ' + meta.title,
      '',
      '---',
      '',
      '## 📋 회의 정보',
      '',
      '| 항목 | 내용 |',
      '|------|------|',
      '| 📅 일시 | ' + meta.date + ' |',
      meta.location  ? '| 📍 장소 | ' + meta.location + ' |'  : null,
      meta.attendees ? '| 👥 참석자 | ' + meta.attendees + ' |' : null,
      meta.agenda    ? '| 📌 아젠다 | ' + meta.agenda + ' |'   : null,
      meta.tags      ? '| 🏷️ 태그 | ' + meta.tags + ' |'       : null,
      '',
      '---',
      '',
      '## 📝 핵심 요약',
      '',
      saved.summary,
      '',
      '---',
      '',
      '## 🗓️ 일정 · 마감일',
      '',
      saved.schedule,
      '',
      '---',
      '',
      '## ✅ 액션 아이템',
      '',
      saved.actionItems,
      '',
      '---',
      '',
      '## 🎙️ 원본 회의록 (STT)',
      '',
      saved.original,
    ].filter(l => l !== null).join('\n');

    return lines.trim();
  }

  /** Outlook HTML 이메일 템플릿 */
  function buildEmailHtml(meta) {
    const br = s => (s || '').replace(/\n/g, '<br>');
    const rowStyle = 'padding:6px 10px;border-bottom:1px solid #f0ece4;font-size:13px;';

    const metaRows = [
      ['📅 일시', meta.date],
      meta.location  ? ['📍 장소',   meta.location]  : null,
      meta.attendees ? ['👥 참석자', meta.attendees]  : null,
      meta.agenda    ? ['📌 아젠다', meta.agenda]     : null,
      meta.tags      ? ['🏷️ 태그',  meta.tags]       : null,
    ].filter(Boolean);

    const metaHtml = metaRows.map(([k, v]) =>
      '<tr><td style="' + rowStyle + 'color:#888;width:80px;white-space:nowrap;">' + k + '</td>' +
      '<td style="' + rowStyle + 'color:#333;">' + v + '</td></tr>'
    ).join('');

    return `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:700px;color:#222;background:#fff;">

  <!-- Header -->
  <div style="background:#ea1917;padding:18px 24px;border-radius:8px 8px 0 0;">
    <div style="color:#fff;font-size:11px;letter-spacing:1px;text-transform:uppercase;opacity:.8;margin-bottom:4px;">Meeting Summary · LG Electronics</div>
    <div style="color:#fff;font-size:20px;font-weight:700;">${meta.title}</div>
  </div>

  <!-- Meta info table -->
  <div style="background:#faf9f7;border:1px solid #e8e4dc;border-top:none;padding:4px 0 0;">
    <table style="width:100%;border-collapse:collapse;font-family:'Segoe UI',Arial,sans-serif;">
      ${metaHtml}
    </table>
  </div>

  <!-- Summary -->
  <div style="border:1px solid #e8e4dc;border-top:none;padding:20px 24px;">
    <div style="color:#ea1917;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px;">📝 핵심 요약</div>
    <div style="font-size:14px;line-height:1.8;color:#333;">${br(saved.summary)}</div>
  </div>

  <!-- Schedule + Action Items (2 column) -->
  <table style="width:100%;border-collapse:collapse;border:1px solid #e8e4dc;border-top:none;">
    <tr>
      <td style="width:50%;padding:18px 20px;vertical-align:top;border-right:1px solid #e8e4dc;">
        <div style="color:#3b82f6;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">🗓️ 일정 · 마감일</div>
        <div style="font-size:13px;line-height:1.8;color:#333;">${br(saved.schedule)}</div>
      </td>
      <td style="width:50%;padding:18px 20px;vertical-align:top;">
        <div style="color:#059669;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">✅ 액션 아이템</div>
        <div style="font-size:13px;line-height:1.8;color:#333;">${br(saved.actionItems)}</div>
      </td>
    </tr>
  </table>

  <!-- Footer -->
  <div style="background:#f5f4f1;border:1px solid #e8e4dc;border-top:none;padding:10px 24px;border-radius:0 0 8px 8px;">
    <div style="font-size:11px;color:#aaa;">본 문서는 AI Meeting Dashboard(Gemini)로 자동 생성되었습니다 · LG Electronics Global Online Marketing</div>
  </div>

</div>`.trim();
  }

  /** Plain text (이메일 fallback) */
  function buildEmailText(meta) {
    const sep = '─'.repeat(50);
    const rows = [
      ['📅 일시', meta.date],
      meta.location  ? ['📍 장소',   meta.location]  : null,
      meta.attendees ? ['👥 참석자', meta.attendees]  : null,
      meta.agenda    ? ['📌 아젠다', meta.agenda]     : null,
      meta.tags      ? ['🏷️ 태그',  meta.tags]       : null,
    ].filter(Boolean).map(([k,v]) => k + '  ' + v).join('\n');

    return [
      '■ ' + meta.title,
      sep,
      rows,
      sep,
      '📝 핵심 요약',
      saved.summary,
      '',
      '🗓️ 일정 · 마감일',
      saved.schedule,
      '',
      '✅ 액션 아이템',
      saved.actionItems,
      sep,
      'AI Meeting Dashboard (LG Electronics)',
    ].join('\n');
  }

  /* ── Obsidian 저장 ── */
  btnObsidian.addEventListener('click', () => {
    const meta = getMeta();
    const now  = new Date();
    const d    = now.toISOString().split('T')[0];
    const t    = now.toTimeString().split(' ')[0].replace(/:/g,'');
    const fileName = (meta.title !== '(제목 없음)' ? meta.title.replace(/[\\/:*?"<>|]/g,'') : 'Meeting') + '_' + d + '_' + t;
    const md   = buildMarkdown(meta);

    const summaryMd = [
      '# ' + meta.title, '',
      '📅 ' + meta.date,
      meta.attendees ? '👥 ' + meta.attendees : null, '',
      '## 📝 핵심 요약', saved.summary, '',
      '## 🗓️ 일정', saved.schedule, '',
      '## ✅ 액션 아이템', saved.actionItems,
    ].filter(l => l !== null).join('\n');

    const uri =
      'obsidian://new?vault=' + encodeURIComponent('meeting summary') +
      '&name='    + encodeURIComponent(fileName) +
      '&content=' + encodeURIComponent(summaryMd);

    if (uri.length > 8000) {
      toast('내용이 길어 .md 파일로 저장합니다.', 'ok');
      downloadMd(fileName, md);
      return;
    }

    const a = document.createElement('a');
    a.href  = uri; a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('Obsidian으로 전송 중...', 'ok');

    setTimeout(() => {
      if (document.visibilityState === 'visible') {
        if (confirm('Obsidian이 열리지 않았나요?\n\n.md 파일로 다운로드 하시겠습니까?'))
          downloadMd(fileName, md);
      }
    }, 2500);
  });

  /* ── Outlook 이메일 복사 ── */
  btnEmail.addEventListener('click', async () => {
    const meta  = getMeta();
    const html  = buildEmailHtml(meta);
    const plain = buildEmailText(meta);

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plain], { type:'text/plain' }),
          'text/html':  new Blob([html],  { type:'text/html' })
        })
      ]);
      toast('📋 Outlook 붙여넣기용으로 복사됐어요!', 'ok');
    } catch {
      await navigator.clipboard.writeText(plain);
      toast('텍스트로 복사됐습니다.', 'ok');
    }
  });

  /* ── .md 다운로드 ── */
  btnMd.addEventListener('click', () => {
    const meta = getMeta();
    const now  = new Date();
    const d    = now.toISOString().split('T')[0];
    const t    = now.toTimeString().split(' ')[0].replace(/:/g,'');
    const fileName = (meta.title !== '(제목 없음)' ? meta.title.replace(/[\\/:*?"<>|]/g,'') : 'Meeting') + '_' + d + '_' + t;
    downloadMd(fileName, buildMarkdown(meta));
  });

  function downloadMd(fileName, content) {
    const blob = new Blob([content], { type:'text/markdown;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = fileName + '.md';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    toast('.md 저장 완료 — Vault 폴더에 넣어주세요.', 'ok');
  }

  /* ── Init ── */
  updateQuotaBadge();
  btnRecord.innerHTML = MIC_ICON + ' Start Recording';

})();
