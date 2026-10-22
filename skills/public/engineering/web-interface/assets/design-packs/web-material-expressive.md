# Material Expressive — web 디자인 팩

## 이 스타일의 정체성
Google Material 3 Expressive 계보의 웹이다. 다채로운 토널 색 시스템, 크고 다양한 모핑 셰이프, 스프링 기반 통통한 모션. 큰 둥근 컨테이너와 굵은 가변 타이포. 무엇을 보면 이 스타일임을 아는가 — 컨테이너 모서리 반경이 24~48px로 크고 서로 다르며(한 화면에 여러 radius), 토널 색 컨테이너(연한 면 + 진한 텍스트가 같은 색상군)가 쓰이고, 모션이 스프링처럼 살짝 튄다.

## 색
- 배경: `#fef7f2` (Material neutral 표면, 웜).
- 토널 컨테이너(면+텍스트 한 쌍으로 사용):
  - Primary: 컨테이너 `#e4d9ff` / 텍스트·아이콘 `#3b2c6b` / 솔리드 `#6750a4` + 흰 텍스트.
  - Secondary: 컨테이너 `#ffe1d0` / 텍스트 `#7a3416` / 솔리드 `#e8732a`.
  - Tertiary: 컨테이너 `#cfeede` / 텍스트 `#16493a` / 솔리드 `#2e9c75`.
- 텍스트(중립): `#1d1b1a` 본문, `#5c5856` 보조.
- 강조 운용: 각 섹션은 토널 색군 하나를 골라 일관 사용 — 한 카드 안에서 색군을 섞지 않는다. 3색군을 섹션별로 로테이션.

## 타이포그래피
- 폰트: `Roboto Flex`(Google Fonts, 가변 폰트) — 없으면 `Roboto`. `minimal-sans`이지만 굵기·폭(width)을 적극 변주.
- 디스플레이: `clamp(2.4rem, 5vw, 3.8rem)`, weight 700, width 변주(가능 시 `font-stretch: 115%`), `letter-spacing: -0.02em`, line-height 1.15.
- 헤드라인(섹션): `1.6rem`, weight 600.
- 본문: `1.0625rem`, weight 400, line-height 1.6, 측정 60~70자.
- 라벨(버튼·칩): `0.85rem`, weight 600, `letter-spacing: 0.02em`.
- 5단계 타입 스케일(display/headline/title/body/label) 위계를 또렷이.

## 레이아웃 / 그리드
- 콘텐츠 최대 폭: 1200px. 좌우 패딩 모바일 16px / 데스크탑 40px.
- 브레이크포인트: 600px, 905px, 1240px (Material breakpoints).
- `block-grid` — 콘텐츠를 크기가 다른 둥근 블록의 모자이크로 구성. 12열 그리드, 거터 24px. 한 행에 큰 블록 1 + 작은 블록 2 식의 비균등 배치.
- 섹션 수직 리듬: 섹션 간 `clamp(80px, 9vw, 128px)`(balanced).

## 형태 / 질감
- 모서리: **여러 radius를 의도적으로 혼용** — 큰 컨테이너 `32px`, 카드 `24px`, 칩/버튼 `999px`(알약), 강조 블록 `48px`. 한 화면에 최소 3가지 radius.
- 모핑 셰이프: 일부 장식 요소는 비대칭 모서리(`border-radius: 48px 16px 48px 16px`) 또는 SVG cookie/clover 셰이프.
- 보더: 기본 없음. 깊이는 토널 색 면과 elevation 그림자로.
- 그림자: Material elevation — `0 1px 3px rgba(0,0,0,0.12)` (level 1), 호버 시 `0 6px 16px rgba(0,0,0,0.16)` (level 3).
- 버튼: 알약(radius 999px), 솔리드 토널 색 채움, 패딩 `14px 28px`.

## 모션
- 전환: `playful` — 스프링 `cubic-bezier(0.34, 1.3, 0.64, 1)`, duration `320ms`.
- 호버: 카드 elevation 상승 + `scale(1.02)`, 버튼 `scale(1.04)`.
- 셰이프 모핑: 강조 셰이프가 호버/스크롤 시 `border-radius` 값을 다른 모핑 형태로 transition(예: `24px → 48px 16px`).
- 스크롤 진입: 블록이 `scale(0.92 → 1)` + `translateY(20px → 0)` 스프링, stagger 80ms.
- 클릭 리플: 버튼 클릭 시 중심에서 퍼지는 원형 리플(Material 시그니처).

## 하지 말 것
- 보라-핑크 2색 그라디언트 배경 금지 — Material는 토널 솔리드 색 시스템이다. (Primary 보라 `#6750a4`는 솔리드 면으로만, 그라디언트 금지)
- 모든 컨테이너에 같은 radius 적용 금지 — radius 다양성이 Expressive의 핵심.
- 그라디언트 텍스트 금지.
- 색군 혼합 금지 — 한 카드/컴포넌트 안은 한 토널 색군으로 통일.
- 정적·linear 모션 금지 — 스프링 바운스가 필수.
- 직각 모서리(radius 0) 금지.
- 이모지를 아이콘 대용으로 쓰지 말 것 — Material Symbols 스타일 라인 아이콘.

## 적용 예
- **히어로:** 좌측 큰 둥근 토널 블록(Primary 컨테이너 `#e4d9ff`)에 가변 굵은 헤드라인 + 알약 CTA. 우측에 모핑 셰이프 장식. radius 혼용(블록 48px, 버튼 999px).
- **카드(기능):** 비균등 모자이크 3블록 — 큰 블록 1(Tertiary 색군, radius 32px) + 작은 블록 2(Secondary, radius 24px). 각 블록은 라인 아이콘 + 타이틀 + 본문. 호버 시 elevation 상승 + scale 1.02.
- **푸터:** Primary 솔리드 `#6750a4` 패널, 흰 텍스트, radius 48px 상단 모서리만. 알약 링크 칩, 클릭 리플.
