(function () {
  'use strict';

  /* ── DOM helpers ── */
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

  /* ── Persist API key ── */
  apiKeyInput.value = localStorage.getItem('gmk') || '';
  apiKeyInput.addEventListener('change', () => {
    localStorage.setItem('gmk', apiKeyInput.value);
  });

  /* ── Toast notification ── */
  function toast(msg, type = 'ok') {
    const el = $('toast');
    el.textContent = msg;
    el.className = `toast ${type} on`;
    setTimeout(() => { el.className = 'toast'; }, 3200);
  }

  /* ── Error box ── */
  function showErr(msg) { errBox.textContent = '⚠ ' + msg; errBox.className = 'err-box on'; }
  function hideErr()    { errBox.className = 'err-box'; }

  /* ── Summarize button sync ── */
  function syncBtn() {
    btnSummarize.disabled = txArea.value.trim().length < 10;
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
      btnRecord.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2"/>
        </svg> Stop`;
      btnRecord.className = 'btn btn-rec';
    };

    recognition.onend = () => {
      if (isRecording) recognition.start(); // 자동 재시작 (연결 끊김 방지)
    };

    recognition.onerror = e => {
      if (e.error !== 'no-speech') toast('음성 오류: ' + e.error, 'err');
    };

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

  /* ── Record toggle ── */
  const MIC_ICON = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>`;

  btnRecord.addEventListener('click', () => {
    if (!recognition) return;
    if (!isRecording) {
      isRecording = true;
      recognition.start();
    } else {
      isRecording = false;
      recognition.stop();
      statusEl.textContent = 'Ready to record';
      statusEl.className = 'status';
      btnRecord.innerHTML = MIC_ICON + ' Start Recording';
      btnRecord.className = 'btn btn-red';
    }
  });

  /* ── Clear ── */
  btnClear.addEventListener('click', () => {
    if (!confirm('회의록을 모두 지우시겠습니까?')) return;
    rawText = '';
    txArea.value = '';
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

  /* ════════════════════════════════════
     Gemini API 호출
     엔드포인트: v1beta + key 쿼리파라미터
  ════════════════════════════════════ */
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
      throw new Error(
        `네트워크 연결 오류\n${netErr.message}\n\n→ 인터넷 연결을 확인하세요.\n→ Chrome 브라우저를 사용하세요.`
      );
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = (await res.json())?.error?.message || detail; } catch (_) {}

      const guide = {
        400: `잘못된 요청 (400)\n모델명 확인: ${model}`,
        403: `API 키 오류 (403)\n키가 없거나 잘못됨\n→ aistudio.google.com/apikey 에서 확인`,
        404: `모델을 찾을 수 없음 (404)\n다른 모델을 선택해보세요`,
        429: `요청 한도 초과 (429)\n무료 한도: 10RPM / 500/day\n→ 1분 후 다시 시도하세요`
      };
      throw new Error((guide[res.status] || '') + '\n\n원문: ' + detail);
    }

    const json = await res.json();
    const content = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('Gemini 응답이 비어있습니다.\n다시 시도해주세요.');
    return content;
  }

  /* ── Generate Summary ── */
  btnSummarize.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      toast('API 키를 먼저 입력하세요.', 'err');
      apiKeyInput.focus();
      return;
    }

    const text = txArea.value.trim();
    if (!text) return;
    saved.original = text;

    hideErr();
    btnSummarize.disabled = true;
    btnSummarize.textContent = '분석 중...';
    loadingEl.className = 'loading on';
    emptyState.style.display = 'none';
    cardsEl.style.display = 'none';

    try {
      const raw = await callGemini(key, text, modelSel.value);
      console.log('[Gemini response]', raw);

      const extract = tag => {
        const m = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].trim() : null;
      };

      saved.summary     = extract('summary')      || raw; // XML 파싱 실패 시 원문 표시
      saved.schedule    = extract('schedule')     || '언급된 일정 없음';
      saved.actionItems = extract('action_items') || '없음';

      $('cSummary').textContent  = saved.summary;
      $('cSchedule').textContent = saved.schedule;
      $('cAction').textContent   = saved.actionItems;

      cardsEl.style.display = 'flex';
      btnObsidian.disabled = false;
      btnEmail.disabled = false;
      toast('요약 완료 ✓', 'ok');

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

  /* ── Save to Obsidian ── */
  btnObsidian.addEventListener('click', () => {
    const now = new Date();
    const d = now.toISOString().split('T')[0];
    const t = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const body = [
      `# 회의록 — ${d}`,
      '',
      '## 📌 핵심 요약',
      saved.summary,
      '',
      '## 🗓️ 일정',
      saved.schedule,
      '',
      '## ✅ 액션 아이템',
      saved.actionItems,
      '',
      '---',
      '',
      '## 🎙️ 원본 (STT)',
      saved.original
    ].join('\n');

    const uri =
      `obsidian://new?vault=${encodeURIComponent('meeting summary')}` +
      `&name=${encodeURIComponent('Meeting_' + d + '_' + t)}` +
      `&content=${encodeURIComponent(body.trim())}`;

    window.open(uri, '_self');
    toast('Obsidian으로 전송했습니다.', 'ok');
  });

  /* ── Copy for Email ── */
  btnEmail.addEventListener('click', async () => {
    const plain =
      `[회의 요약]\n\n📌 핵심 요약\n${saved.summary}\n\n🗓️ 일정\n${saved.schedule}\n\n✅ 액션 아이템\n${saved.actionItems}`;
    const html =
      `<div style="font-family:Arial,sans-serif;color:#333;line-height:1.6">` +
      `<h2>회의 요약</h2>` +
      `<h3 style="color:#ea1917">📌 핵심 요약</h3><p>${saved.summary.replace(/\n/g, '<br>')}</p>` +
      `<h3 style="color:#ea1917">🗓️ 일정</h3><p>${saved.schedule.replace(/\n/g, '<br>')}</p>` +
      `<h3 style="color:#ea1917">✅ 액션 아이템</h3><p>${saved.actionItems.replace(/\n/g, '<br>')}</p>` +
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

})();
