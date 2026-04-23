# 🎙️ Meeting Dashboard

AI 기반 회의록 자동 요약 도구 — **Gemini API** (무료) + **Web Speech API** 사용

![screenshot](https://img.shields.io/badge/status-active-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

---

## ✨ 기능

| 기능 | 설명 |
|------|------|
| 🎙️ 실시간 STT | 브라우저 Web Speech API로 한국어 음성 → 텍스트 변환 |
| 🤖 AI 요약 | Gemini API로 핵심 요약 / 일정 / 액션 아이템 자동 추출 |
| 📝 Obsidian 저장 | 요약본을 Obsidian Vault에 바로 저장 |
| 📋 이메일 복사 | Outlook 붙여넣기 지원 (HTML + 텍스트 클립보드) |

---

## 🚀 빠른 시작

### 1. 저장소 클론

```bash
git clone https://github.com/your-username/meeting-dashboard.git
cd meeting-dashboard
```

### 2. Gemini API 키 발급 (무료)

1. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) 접속
2. **Create API Key** 클릭
3. 신용카드 불필요 — 즉시 무료 사용 가능

### 3. 실행

별도 서버 불필요. `index.html`을 Chrome에서 열기:

```bash
# macOS
open index.html

# Windows
start index.html

# 또는 VS Code Live Server 사용
```

> ⚠️ **Chrome 브라우저 필수** — Web Speech API는 Chrome에서만 지원됩니다.

---

## 📁 파일 구조

```
meeting-dashboard/
├── index.html   # 메인 HTML
├── style.css    # 스타일
├── app.js       # 로직 (STT + Gemini API + 내보내기)
└── README.md
```

---

## 🆓 무료 사용 한도 (Gemini API)

| 모델 | 분당 요청 | 일일 요청 | 추천 용도 |
|------|---------|---------|---------|
| `gemini-2.5-flash` ★ | 10 RPM | 500/day | 회의록 요약 최적 |
| `gemini-2.5-flash-lite` | 15 RPM | 1,000/day | 고빈도 사용 |
| `gemini-1.5-flash` | 15 RPM | 1,500/day | 구버전 안정 |

---

## 🔧 GitHub Pages 배포

1. GitHub 저장소 생성 후 파일 업로드
2. **Settings → Pages → Branch: main / root** 선택
3. `https://your-username.github.io/meeting-dashboard` 접속

---

## ⚠️ 주의사항

- API 키를 코드에 직접 하드코딩하지 마세요
- 키는 브라우저 `localStorage`에만 저장됩니다 (서버 전송 없음)
- 음성 데이터는 브라우저 내에서만 처리됩니다

---

## 📄 License

MIT
