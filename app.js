(function () {
  'use strict';

  /* ══════════════════════════════════════════
     🔢 무료 한도 정의 (2026년 기준)
     출처: Google AI Studio 공식 문서
  ══════════════════════════════════════════ */
  const FREE_LIMITS = {
    'gemini-2.5-flash':      { rpm: 10,  rpd: 250  },
    'gemini-2.5-flash-lite': { rpm: 15,  rpd: 1000 },
    'gemini-1.5-flash':      { rpm: 15,  rpd: 1500 },
  };

  // 경고 임계값 (일일 한도의 80%)
  const WARN_THRESHOLD = 0.8;

  /* ── DOM ── */
  const $ = id => document.getElementById(id);

  const btnRecord    = $('btnRecord');
  const btnClear     = $('btnClear');
  const btnSummarize = $('btnSummarize');
  const btnObsidian  = $('btnObsidian');
  const btnEmail     = $('btnEmail');
  const apiKeyInput  = $('apiKey');
  const modelSel     = $('modelSel');
  const statusEl     = $('status');
  const txArea       = $('transcript');
  const emptyState   = $('emptyState');
  const cardsEl      = $('cards');
  const loadingEl    = $('loading');
  const errBox       = $('errBox');

  /* ── State ── */
  let isRecording = false;
  let recognition = null;
  let rawText = '';
  let saved = { original: '', summary: '', schedule: '', actionItems: '' };

  // RPM 추적 (메모리 — 분당 요청 타임스탬프)
  let rpmLog = [];

  /* ── Persist key ── */
  apiKeyInput.value = localStorage.getItem('gmk') || '';
  apiKeyInput.addEventListener('change', () => localStorage.setItem('gmk', apiKeyInput.value));

  /* ════════════════════════════════════════
     📊 사용량 추적 (localStorage 기반)
     - 날짜별 모델별 일일 카운트 저장
     - 자정(UTC 기준)에 자동 초기화
  ════════════════════════════════════════ */
  function getTodayKey() {
    // 태평양 시간 기준 날짜 (Google 한도 초기화 기준)
    const pt = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    return `gm_usage_${pt}`;
  }

  function getUsage(model) {
    const key = getTodayKey();
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : {};
    return data[model] || 0;
  }

  function incrementUsage(model) {
    const key = getTodayKey();
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : {};
    data[model] = (data[model] || 0) + 1;
    localStorage.setItem(key, JSON.stringify(data));

    // 오래된 날짜 데이터 정리 (7일 이상)
    cleanOldUsage();
    return data[model];
  }

  function cleanOldUsage() {
    const today = new Date();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('gm_usage_')) continue;
      const dateStr = k.replace('gm_usage_', '');
      const diff = (today - new Date(dateStr)) / (1000 * 60 * 60 * 24);
      if (diff > 7) localStorage.removeItem(k);
    }
  }

  /* RPM 체크 (분당 요청 수) */
  function checkRPM(model) {
    const now = Date.now();
    const limit = FREE_LIMITS[model]?.rpm || 10;
    // 1분 이내 요청만 유지
    rpmLog = rpmLog.filter(t => now - t < 60000);
    return rpmLog.length < limit;
  }

  function logRPM() {
    rpmLog.push(Date.now());
  }

  /* ── 사용량 배지 업데이트 ── */
  function updateQuotaBadge() {
    const model = modelSel.value;
    const used  = getUsage(model);
    const limit = FREE_LIMITS[model]?.rpd || 250;
    const pct   = used / limit;

    let el = $('quotaBadge');
    if (!el) return;

    const remaining = limit - used;
    el.textContent = `오늘 남은 횟수: ${remaining}/${limit}`;
    el.className = 'quota-badge ' + (
      pct >= 1     ? 'quota-over'  :
      pct >= WARN_THRESHOLD ? 'quota-warn'  :
                    'quota-ok'
    );
  }

  modelSel.addEventListener('change', updateQuotaBadge);

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

  /* ── Sync btn ── */
  function syncBtn() { btnSummarize.disabled = txArea.value.trim().length < 10; }

  /* ════════════════════════════════════════
     ⚠️  한도 경고 체크
  ════════════════════════════════════════ */
  function checkQuotaBeforeCall(model) {
    const used  = getUsage(model);
    const limit = FREE_LIMITS[model]?.rpd || 250;
    const remaining = limit - used;
    const pct = used / limit;

    // 한도 초과
    if (remaining <= 0) {
      const reset = new Date();
      reset.setDate(reset.getDate() + 1);
      reset.setHours(0, 0, 0, 0);
      throw new Error(
        `일일 무료 한도 초과 (${used}/${limit}회)\n\n` +
        `모델: ${model}\n` +
        `한도 초기화: 매일 자정 (태평양 시간)\n\n` +
        `→ 다른 모델로 변경하거나 내일 다시 시도하세요.\n` +
        `→ gemini-2.5-flash-lite (1,000회/일) 로 변경 권장`
      );
    }

    // 80% 경고
    if (pct >= WARN_THRESHOLD) {
      const ok = confirm(
        `⚠️ 무료 한도 ${Math.round(pct * 100)}% 사용 중\n\n` +
        `오늘 ${used}/${limit}회 사용 (남은 횟수: ${remaining}회)\n` +
        `모델: ${model}\n\n` +
        `한도 초과 시 자동으로 차단됩니다 (요금 청구 없음).\n` +
        `계속 진행하시겠습니까?`
      );
      if (!ok) throw new Error('사용자가 취소했습니다.');
    }

    // RPM 체크
    if (!checkRPM(model)) {
      const limit_rpm = FREE_LIMITS[model]?.rpm || 10;
      throw new Error(
        `분당 요청 한도 초과 (${limit_rpm}RPM)\n\n` +
        `1분 후 다시 시도해주세요.`
      );
    }
  }

  /* ── Speech Recognition ── */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ko-KR';

    recognition.onstart = () => {
      statusEl.innerHTML = '<span class="dot"></span> 녹음 중...';
      statusEl.className = 'status rec';
      btnRecord.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Stop`;
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

  const MIC_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;

  btnRecord.addEventListener('click', () => {
    if (!recognition) return;
    if (!isRecording) {
      isRecording = true; recognition.start();
    } else {
      isRecording = false; recognition.stop();
      statusEl.textContent = 'Ready to record';
      statusEl.className = 'status';
      btnRecord.innerHTML = MIC_ICON + ' Start Recording';
      btnRecord.className = 'btn btn-red';
    }
  });

  btnClear.addEventListener('click', () => {
    if (!confirm('회의록을 모두 지우시겠습니까?')) return;
    rawText = ''; txArea.value = '';
    saved = { original: '', summary: '', schedule: '', actionItems: '' };
    emptyState.style.display = 'flex';
    cardsEl.style.display = 'none';
    hideErr();
    btnSummarize.disabled = true;
    btnObsidian.disabled = true;
    btnEmail.disabled = true;
  });

  txArea.addEventListener('input', () => {
    if (!isRecording) rawText = txArea.value;
    syncBtn();
  });

  /* ══════════════════════════════════
     Gemini API 호출
  ══════════════════════════════════ */
  async function callGemini(apiKey, text, model) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const prompt =
`당신은 LG전자의 전문적인 회의록 요약 AI 비서입니다.
아래 회의 내용을 분석하고 반드시 아래 3개의 XML 태그만 사용하여 응답하세요.
다른 텍스트나 마크다운 없이 태그만 출력하세요.

<summary>핵심 요약 (3~5줄, 한국어)</summary>
<schedule>언급된 일정·마감일. 없으면 → 언급된 일정 없음</schedule>
<action_items>할 일 목록, 담당자 있으면 [담당자] 표시. 없으면 → 없음</action_items>

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
    } catch (netErr) {
      throw new Error(`네트워크 오류\n${netErr.message}\n\n→ 인터넷 연결 및 Chrome 브라우저를 확인하세요.`);
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = (await res.json())?.error?.message || detail; } catch (_) {}
      const guide = {
        400: `잘못된 요청 (400)\n모델명 확인: ${model}`,
        403: `API 키 오류 (403)\n→ aistudio.google.com/apikey 에서 키 확인`,
        404: `모델을 찾을 수 없음 (404)\n→ 다른 모델을 선택해보세요`,
        429: `요청 한도 초과 (429) — 서버 측 차단\n무료 한도: ${FREE_LIMITS[model]?.rpm || 10}RPM / ${FREE_LIMITS[model]?.rpd || 250}/day\n→ 1분 후 다시 시도하거나 모델을 변경하세요`
      };
      throw new Error((guide[res.status] || '') + '\n\n원문: ' + detail);
    }

    const json = await res.json();
    const content = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('Gemini 응답이 비어있습니다. 다시 시도해주세요.');
    return content;
  }

  /* ── Generate Summary ── */
  btnSummarize.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) { toast('API 키를 먼저 입력하세요.', 'err'); apiKeyInput.focus(); return; }
    const text = txArea.value.trim();
    if (!text) return;

    // ✅ 한도 체크 (호출 전)
    try {
      checkQuotaBeforeCall(modelSel.value);
    } catch (e) {
      showErr(e.message);
      return;
    }

    saved.original = text;
    hideErr();
    btnSummarize.disabled = true;
    btnSummarize.textContent = '분석 중...';
    loadingEl.className = 'loading on';
    emptyState.style.display = 'none';
    cardsEl.style.display = 'none';

    try {
      // ✅ RPM 로그 기록
      logRPM();

      const raw = await callGemini(key, text, modelSel.value);
      console.log('[Gemini response]', raw);

      // ✅ 성공 시 일일 카운트 증가
      const used = incrementUsage(modelSel.value);
      const limit = FREE_LIMITS[modelSel.value]?.rpd || 250;
      updateQuotaBadge();

      const extract = tag => {
        const m = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].trim() : null;
      };

      saved.summary     = extract('summary')      || raw;
      saved.schedule    = extract('schedule')     || '언급된 일정 없음';
      saved.actionItems = extract('action_items') || '없음';

      $('cSummary').textContent  = saved.summary;
      $('cSchedule').textContent = saved.schedule;
      $('cAction').textContent   = saved.actionItems;

      cardsEl.style.display = 'flex';
      btnObsidian.disabled = false;
      btnEmail.disabled = false;

      // 남은 횟수 알림
      const remaining = limit - used;
      if (remaining <= 5) {
        toast(`요약 완료 ✓ — ⚠ 오늘 남은 무료 횟수: ${remaining}회`, 'err');
      } else {
        toast(`요약 완료 ✓  (오늘 ${used}/${limit}회 사용)`, 'ok');
      }

    } catch (e) {
      console.error('[API Error]', e);
      showErr(e.message);
      emptyState.style.display = 'flex';
    } finally {
      loadingEl.className = 'loading';
      btnSummarize.textContent = 'Generate Summary';
      btnSummarize.disabled = false;
    }
  });

  /* ── Obsidian ── */
  btnObsidian.addEventListener('click', () => {
    const now = new Date();
    const d   = now.toISOString().split('T')[0];
    const t   = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const fileName = 'Meeting_' + d + '_' + t;

    // ✅ 전체 내용 (.md 형식)
    const fullBody = [
      `# 회의록 — ${d}`, '',
      '## 📌 핵심 요약', saved.summary, '',
      '## 🗓️ 일정', saved.schedule, '',
      '## ✅ 액션 아이템', saved.actionItems, '',
      '---', '', '## 🎙️ 원본 (STT)', saved.original
    ].join('\n').trim();

    // ✅ 요약만 (URI용 — 원본 제외)
    const summaryBody = [
      `# 회의록 — ${d}`, '',
      '## 📌 핵심 요약', saved.summary, '',
      '## 🗓️ 일정', saved.schedule, '',
      '## ✅ 액션 아이템', saved.actionItems
    ].join('\n').trim();

    const uri =
      `obsidian://new?vault=${encodeURIComponent('meeting summary')}` +
      `&name=${encodeURIComponent(fileName)}` +
      `&content=${encodeURIComponent(summaryBody)}`;

    const URI_LIMIT = 8000; // Obsidian 실질적 URI 한도

    // ✅ URI 길이 초과 시 → .md 파일 다운로드 fallback
    if (uri.length > URI_LIMIT) {
      const ok = confirm(
        '회의록이 너무 길어 Obsidian URI 한도를 초과합니다.\n\n' +
        '.md 파일로 다운로드 후 Obsidian Vault 폴더에 직접 넣어주세요.\n\n' +
        '다운로드 하시겠습니까?'
      );
      if (ok) downloadMd(fileName, fullBody);
      return;
    }

    // ✅ window.location.href 사용 (팝업 차단 우회)
    // visibilitychange로 Obsidian 실행 여부 감지
    let launched = false;
    const onBlur = () => { launched = true; };
    window.addEventListener('blur', onBlur);

    window.location.href = uri;

    // 2초 후에도 blur 없으면 → Obsidian 미설치로 판단
    setTimeout(() => {
      window.removeEventListener('blur', onBlur);
      if (!launched) {
        const ok = confirm(
          'Obsidian이 설치되지 않았거나 실행되지 않았습니다.\n\n' +
          '.md 파일로 다운로드 하시겠습니까?'
        );
        if (ok) downloadMd(fileName, fullBody);
      } else {
        toast('Obsidian으로 전송했습니다. ✓', 'ok');
      }
    }, 2000);
  });

  /* ── .md 파일 다운로드 (Obsidian fallback) ── */
  function downloadMd(fileName, content) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = fileName + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('.md 파일 다운로드 완료 — Vault 폴더에 넣어주세요.', 'ok');
  }

  /* ── Email Copy ── */
  btnEmail.addEventListener('click', async () => {
    const plain =
      `[회의 요약]\n\n📌 핵심 요약\n${saved.summary}\n\n🗓️ 일정\n${saved.schedule}\n\n✅ 액션 아이템\n${saved.actionItems}`;
    const html =
      `<div style="font-family:Arial,sans-serif;color:#333;line-height:1.6">` +
      `<h2>회의 요약</h2>` +
      `<h3 style="color:#ea1917">📌 핵심 요약</h3><p>${saved.summary.replace(/\n/g,'<br>')}</p>` +
      `<h3 style="color:#ea1917">🗓️ 일정</h3><p>${saved.schedule.replace(/\n/g,'<br>')}</p>` +
      `<h3 style="color:#ea1917">✅ 액션 아이템</h3><p>${saved.actionItems.replace(/\n/g,'<br>')}</p>` +
      `</div>`;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html':  new Blob([html],  { type: 'text/html' })
        })
      ]);
      toast('클립보드 복사 완료 (Outlook 붙여넣기 가능)', 'ok');
    } catch {
      await navigator.clipboard.writeText(plain);
      toast('텍스트로 복사됨', 'ok');
    }
  });

  /* ── Init ── */
  updateQuotaBadge();
  btnRecord.innerHTML = MIC_ICON + ' Start Recording';

})();
