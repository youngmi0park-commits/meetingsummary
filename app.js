document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const btnRecord = document.getElementById("btnRecord");
  const btnClear = document.getElementById("btnClear");
  const btnSummarize = document.getElementById("btnSummarize");
  const btnObsidian = document.getElementById("btnObsidian");
  const btnEmail = document.getElementById("btnEmail");

  const apiKeyInput = document.getElementById("apiKey");
  const promptType = document.getElementById("promptType");
  const statusEl = document.getElementById("status");
  const transcriptArea = document.getElementById("transcript");

  const summaryView = document.getElementById("summaryView");
  const emptyState = document.querySelector(".empty-state");
  const summaryContent = document.querySelector(".summary-content");

  const contentSummary = document.getElementById("contentSummary");
  const contentSchedule = document.getElementById("contentSchedule");
  const contentActionItems = document.getElementById("contentActionItems");

  // State
  let isRecording = false;
  let recognition = null;
  let rawText = "";

  // Data
  let meetingData = {
    original: "",
    summary: "",
    schedule: "",
    actionItems: ""
  };

  // Load API Key
  const savedKey = localStorage.getItem("gemini_api_key");
  if(savedKey) apiKeyInput.value = savedKey;

  apiKeyInput.addEventListener("change", (e) => {
    localStorage.setItem("gemini_api_key", e.target.value);
  });

  // Web Speech API Setup
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    // User requested Korean logic
    recognition.lang = "ko-KR";

    recognition.onstart = function() {
      statusEl.textContent = "Recording...";
      statusEl.classList.add("recording");
      btnRecord.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect></svg> Stop Recording`;
      btnRecord.classList.replace("btn-primary", "btn-danger");
    };

    recognition.onend = function() {
      if(isRecording) recognition.start(); // Auto-restart if disconnected
    };

    recognition.onresult = function(event) {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript + " ";
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      
      // We append final results immediately to the textarea.
      // But actually, for continuous recording, it's better to just reconstruct it or append carefully.
      if (final) {
        rawText += final + "\n";
        transcriptArea.value = rawText + interim;
      } else {
        transcriptArea.value = rawText + interim;
      }

      transcriptArea.scrollTop = transcriptArea.scrollHeight; // Auto-scroll
      if(transcriptArea.value.trim().length > 10) {
        btnSummarize.disabled = false;
      }
    };
    
    recognition.onerror = function(event) {
      console.error("Speech recognition error", event.error);
    }
  } else {
    statusEl.textContent = "Web Speech API is not supported in this browser.";
  }

  // --- Actions ---

  btnRecord.addEventListener("click", () => {
    if(!isRecording) {
      isRecording = true;
      recognition.start();
    } else {
      isRecording = false;
      recognition.stop();
      statusEl.textContent = "Ready to record";
      statusEl.classList.remove("recording");
      btnRecord.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> Start Recording`;
      btnRecord.classList.replace("btn-danger", "btn-primary");
    }
  });

  btnClear.addEventListener("click", () => {
    if(confirm("정말로 회의록을 지우시겠습니까?")) {
      rawText = "";
      transcriptArea.value = "";
      btnSummarize.disabled = true;
      btnObsidian.disabled = true;
      btnEmail.disabled = true;
      emptyState.style.display = "flex";
      summaryContent.style.display = "none";
    }
  });

  transcriptArea.addEventListener("input", (e) => {
    rawText = e.target.value;
    if(rawText.trim().length > 5) {
      btnSummarize.disabled = false;
    } else {
      btnSummarize.disabled = true;
    }
  });

  // AI Summarization
  btnSummarize.addEventListener("click", async () => {
    const key = apiKeyInput.value.trim();
    if(!key) {
      alert("Gemini API 키를 먼저 입력해주세요.");
      apiKeyInput.focus();
      return;
    }

    const textToSummarize = transcriptArea.value.trim();
    meetingData.original = textToSummarize;

    btnSummarize.innerText = "Generating...";
    btnSummarize.disabled = true;

    try {
      const response = await callGeminiAPI(key, textToSummarize, promptType.value);
      
      // Parse Gemini's response
      const summaryMatch = response.match(/<summary>([\s\S]*?)<\/summary>/);
      const scheduleMatch = response.match(/<schedule>([\s\S]*?)<\/schedule>/);
      const actionMatch = response.match(/<action_items>([\s\S]*?)<\/action_items>/);

      if (!summaryMatch) {
        console.error("파싱 실패. Gemini 응답 원문:", response);
        meetingData.summary = response; // raw 응답이라도 보여주기
      } else {
        meetingData.summary = summaryMatch[1].trim();
      }

      meetingData.schedule = scheduleMatch ? scheduleMatch[1].trim() : "일정을 추출하지 못했습니다.";
      meetingData.actionItems = actionMatch ? actionMatch[1].trim() : "액션 아이템을 추출하지 못했습니다.";

      contentSummary.innerText = meetingData.summary;
      contentSchedule.innerText = meetingData.schedule;
      contentActionItems.innerText = meetingData.actionItems;

      emptyState.style.display = "none";
      summaryContent.style.display = "flex";
      
      btnObsidian.disabled = false;
      btnEmail.disabled = false;

    } catch (e) {
      alert("API Error: " + e.message);
    } finally {
      btnSummarize.innerText = "Generate Summary";
      // disabled 복구는 transcriptArea 내용 기준으로
      btnSummarize.disabled = transcriptArea.value.trim().length <= 5;
    }
  });

  async function callGeminiAPI(apiKey, text, model) {
    // 무료인 gemini-1.5-flash를 기본 모델로 사용합니다.
    const safeModel = model || "gemini-1.5-flash"; 
    
    // 만약 예전 방식의 'gemini-pro'가 선택되었다면 최신으로 교정
    const finalModel = safeModel === "gemini-pro" ? "gemini-1.5-flash" : safeModel;

    // ✅ Gemini API 엔드포인트 형식 (v1beta)
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${finalModel}:generateContent?key=${apiKey}`;

    const systemPrompt = `당신은 LG전자의 전문적인 회의록 요약 AI 비서입니다.
주어진 회의 녹음본(STT)을 분석하여 다음 3가지 항목을 XML 태그로 감싸서 반환해주세요.
<summary>전체 회의 내용 핵심 요약 (3-4줄 이내)</summary>
<schedule>회의에서 언급된 핵심 일정 및 마감일 정리</schedule>
<action_items>회의 결과에 따른 할 일 목록 (담당자가 있다면 명시)</action_items>`;

    // ✅ Gemini API 요청 형식 (사용자 제안 generationConfig 반영)
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt + "\n\n다음 회의록을 요약해주세요:\n\n" + text }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 1500,
          temperature: 0.3
        }
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || "Unknown error occurred.");
    }

    const data = await res.json();
    
    // ✅ Gemini 응답 파싱
    return data.candidates[0].content.parts[0].text;
  }

  // Save to Obsidian (전문 + 요약 모두) - user requested User Vault: 'meeting summary'
  // Actually user said: Vault name: "meeting summary 라고 이름 지정할게 신규생성해줘"
  btnObsidian.addEventListener("click", () => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const fileName = `Meeting_${dateStr}_${timeStr}`;

    const vaultName = encodeURIComponent("meeting summary"); // The vault name requested
    
    // 원본 제외하고 요약만
    const obsContent = `
# 회의 일자: ${dateStr}
## 📌 핵심 요약
${meetingData.summary}
## 🗓️ 일정
${meetingData.schedule}
## ✅ 액션 아이템
${meetingData.actionItems}
    `.trim();

    const encodedFileName = encodeURIComponent(fileName);
    const encodedContent = encodeURIComponent(obsContent);

    // Obsidian URI format: obsidian://new?vault=my-vault&name=my-note&content=my-content
    const uri = `obsidian://new?vault=${vaultName}&name=${encodedFileName}&content=${encodedContent}`;
    window.location.href = uri;
  });

  // Copy for Email (요약만)
  btnEmail.addEventListener("click", async () => {
    const emailHtml = `
<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <h2>회의 요약 공유</h2>
  
  <h3 style="color: #ea1917;">📌 핵심 요약</h3>
  <p>${meetingData.summary.replace(/\n/g, '<br>')}</p>
  
  <h3 style="color: #ea1917;">🗓️ 일정</h3>
  <p>${meetingData.schedule.replace(/\n/g, '<br>')}</p>
  
  <h3 style="color: #ea1917;">✅ 액션 아이템</h3>
  <p>${meetingData.actionItems.replace(/\n/g, '<br>')}</p>
</div>
    `.trim();

    const emailText = `
[회의 요약 공유]

📌 핵심 요약
${meetingData.summary}

🗓️ 일정
${meetingData.schedule}

✅ 액션 아이템
${meetingData.actionItems}
    `.trim();

    try {
      // Create a ClipboardItem with both HTML and plain text form so paste works well in Outlook
      const typeText = new Blob([emailText], { type: "text/plain" });
      const typeHtml = new Blob([emailHtml], { type: "text/html" });
      
      const clipboardItem = new ClipboardItem({
        "text/plain": typeText,
        "text/html": typeHtml
      });
      await navigator.clipboard.write([clipboardItem]);
      alert("이메일 형식으로 클립보드에 복사되었습니다. Outlook에 붙여넣기 해보세요!");
    } catch(err) {
      // Fallback for older browsers
      await navigator.clipboard.writeText(emailText);
      alert("텍스트 형식으로 복사되었습니다!");
    }
  });
});
