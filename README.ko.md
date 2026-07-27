<p align="center">
  <img src="./assets/icon-neko-master.png" width="200" alt="Neko Master 로고" style="margin-bottom: 16px;">
  <br>
  <b style="font-size: 32px;">Neko Master</b>
</p>

<p align="center">
  <b>네트워크 트래픽을 한눈에 파악하세요.</b><br>
  <span>실시간 모니터링 · 트래픽 감사 · 멀티 게이트웨이 지원</span>
</p>

<p align="center">
  <a href="./README.md"><b>English</b></a> | <a href="./README.zh.md">中文</a> | <b>한국어</b>
</p>

<p align="center">
  <a href="https://github.com/foru17/neko-master/stargazers"><img src="https://img.shields.io/github/stars/foru17/neko-master?style=flat-square&color=yellow" alt="Stars"></a>
  <a href="https://hub.docker.com/r/foru17/neko-master"><img src="https://img.shields.io/docker/pulls/foru17/neko-master?style=flat-square&color=blue&logo=docker" alt="Docker Pulls"></a>
  <a href="https://hub.docker.com/r/foru17/neko-master"><img src="https://img.shields.io/docker/v/foru17/neko-master?style=flat-square&label=Docker&color=2496ED" alt="Docker Version"></a>
  <a href="https://hub.docker.com/r/foru17/neko-master"><img src="https://img.shields.io/docker/image-size/foru17/neko-master/latest?style=flat-square&logo=docker" alt="Image Size"></a>
  <a href="https://github.com/foru17/neko-master/blob/main/LICENSE"><img src="https://img.shields.io/github/license/foru17/neko-master?style=flat-square&color=green" alt="License"></a>
  <img src="https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js">
  <a href="https://github.com/foru17/neko-master/actions/workflows/docker-build.yml"><img src="https://img.shields.io/github/actions/workflow/status/foru17/neko-master/docker-build.yml?style=flat-square&label=Docker%20CI" alt="Docker CI"></a>
  <a href="./docs/architecture.md"><img src="https://img.shields.io/badge/docs-architecture-0ea5e9?style=flat-square" alt="Architecture Docs"></a>
</p>

> [!IMPORTANT]
> **면책 조항**
>
> 본 프로젝트는 로컬 게이트웨이 환경을 위한 **트래픽 분석 및 시각화 도구**입니다.
>
> 네트워크 접속 서비스, 프록시 구독, 네트워크 간 연결 기능을 제공하지 않습니다.
> 모든 데이터는 사용자의 자체 네트워크 환경에서만 수집됩니다.
>
> 본 프로젝트는 MIT 라이선스로 오픈소스화되어 있습니다. 본 소프트웨어 사용으로 인해 발생하는 결과에 대해 책임을 지지 않으며, 관련 법규를 준수하여 사용해 주시기 바랍니다.

<table>
  <tr>
    <td align="center" width="50%">
      <img src="./assets/neko-master-overview-light.png" alt="Neko Master 미리보기 (라이트 1)" />
    </td>
    <td align="center" width="50%">
      <img src="./assets/neko-master-regions-light.png" alt="Neko Master 미리보기 (라이트 2)" />
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="./assets/neko-master-rules-dark.png" alt="Neko Master 미리보기 (다크 1)" />
    </td>
    <td align="center" width="50%">
      <img src="./assets/neko-master-domains-dark.png" alt="Neko Master 미리보기 (다크 2)" />
    </td>
  </tr>
</table>

## 이름의 의미

**Neko**(ねこ)는 일본어로 _고양이_를 뜻합니다.  
발음은 **/ˈneɪkoʊ/** (NEH-ko).

고양이처럼, Neko Master는 네트워크 트래픽을 조용하고 정밀하게 관찰합니다.  
현대적인 게이트웨이 환경을 위해 설계된 가벼운 분석 대시보드입니다.

## 📋 목차

- [✨ 주요 기능](#-주요-기능)
- [🚀 빠른 시작](#-빠른-시작)
- [🤖 Agent 배포](#-agent-배포)
- [📖 첫 사용](#-첫-사용)
- [🔧 포트 충돌 해결](#-포트-충돌-해결)
- [🐳 Docker 구성](#-docker-구성)
- [🗄️ ClickHouse (선택)](#-clickhouse-선택)
- [🌐 리버스 프록시 & 터널](#-리버스-프록시--터널)
- [🔐 인증 & 보안](#-인증--보안)
- [❓ FAQ](#-faq)
- [🏗️ 아키텍처 가이드](#-아키텍처-가이드)
- [🤝 피드백 & 이슈](#-피드백--이슈)
- [📁 프로젝트 구조](#-프로젝트-구조)
- [🛠️ 기술 스택](#-기술-스택)
- [📄 라이선스](#-라이선스)

## ✨ 주요 기능

| 기능 | 설명 |
| --- | --- |
| 📊 **실시간 모니터링** | WebSocket 실시간 수집으로 밀리초 단위 지연 |
| 📈 **추이 분석** | 다차원 트래픽 추이 (30분 / 1시간 / 24시간) |
| 🌐 **도메인 분석** | 도메인별 트래픽, 연관 IP, 연결 수 조회 |
| 🗺️ **IP 분석** | ASN, 지리 위치, 연관 도메인 표시 |
| 🚀 **프록시 통계** | 프록시 노드별 트래픽 분포 및 연결 수 |
| 📱 **PWA 지원** | 데스크톱 앱으로 설치하여 네이티브 환경에서 사용 |
| 🌙 **다크 모드** | 라이트 / 다크 / 시스템 테마 지원 |
| 🌍 **다국어 지원** | 한국어 / 영어 / 중국어 원활한 전환 |
| 🔄 **멀티 백엔드** | 여러 OpenClash 백엔드 인스턴스를 동시에 모니터링 |

## 🚀 빠른 시작

### 옵션 1: Docker Compose (권장)

> 저장소에 기본 포함된 `docker-compose.yml`은 기본적으로 `3000/3001/3002`를 매핑합니다.  
> 아래의 시나리오 A/B는 일반적인 배포를 위한 최소 템플릿입니다.

#### 시나리오 A: 최소 배포 (3000만 노출)

```yaml
services:
  neko-master:
    image: foru17/neko-master:latest
    container_name: neko-master
    restart: unless-stopped
    ports:
      - "3000:3000" # Web UI
    volumes:
      - ./data:/app/data
      # 로컬 MMDB (선택, ./geoip 폴더에 파일을 미리 다운로드해 두세요)
      - ./geoip:/app/data/geoip:ro
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/stats.db
      - COOKIE_SECRET=${COOKIE_SECRET}
```

> `.env` 파일에 (`docker-compose.yml`과 같은 경로) 다음을 권장합니다.  
> `COOKIE_SECRET=<최소 32바이트 랜덤 문자열>` (`openssl rand -hex 32`로 생성)

> 이 모드는 업그레이드와 완전히 호환되며, 별도 설정 없이 동작합니다.  
> WebSocket이 라우팅되지 않으면 자동으로 HTTP 폴링으로 전환됩니다.

#### 시나리오 B: 실시간 WebSocket (리버스 프록시와 함께 권장)

```yaml
services:
  neko-master:
    image: foru17/neko-master:latest
    container_name: neko-master
    restart: unless-stopped
    ports:
      - "3000:3000" # Web UI
      - "3002:3002" # WebSocket (Nginx / 터널 전달용)
    volumes:
      - ./data:/app/data
      # 로컬 MMDB (선택, ./geoip 폴더에 파일을 미리 다운로드해 두세요)
      - ./geoip:/app/data/geoip:ro
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/stats.db
      - COOKIE_SECRET=${COOKIE_SECRET}
```

그런 다음 실행:

```bash
docker compose up -d
```

<http://localhost:3000>을 열어 시작하세요.

저장소에 기본 포함된 Compose 파일(`3000/3001/3002` 기본)을 그대로 사용하는 경우에도 같은 명령을 실행하면 됩니다.

### 옵션 2: Docker Run

```bash
# 세션 유지를 위해 먼저 고정된 쿠키 시크릿 생성
export COOKIE_SECRET="$(openssl rand -hex 32)"
```

```bash
# 최소 (3000만)
docker run -d \
  --name neko-master \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e COOKIE_SECRET="$COOKIE_SECRET" \
  --restart unless-stopped \
  foru17/neko-master:latest

# 실시간 WS (리버스 프록시 사용)
docker run -d \
  --name neko-master \
  -p 3000:3000 \
  -p 3002:3002 \
  -v $(pwd)/data:/app/data \
  -e COOKIE_SECRET="$COOKIE_SECRET" \
  --restart unless-stopped \
  foru17/neko-master:latest
```

<http://localhost:3000>을 열어 시작하세요.

> 프런트엔드는 기본적으로 same-origin `/api`를 사용하므로 3001 포트는 보통 외부에 노출할 필요가 없습니다.  
> 실시간 WebSocket을 사용하려면 리버스 프록시/터널이 `3002` 포트에 도달할 수 있어야 합니다. 도달할 수 없으면 약 5초 간격 HTTP 폴링으로 폴백합니다.

> `docker run`을 사용할 때는 외부 포트를 `-p` 매핑으로 직접 변경하세요.  
> 리버스 프록시 없이 직접 WebSocket에 접근하면서 외부 WS 포트가 `3002`가 아닌 경우에만 `-e WS_EXTERNAL_PORT=<외부-ws-포트>`도 함께 전달하세요.

> 로컬 MMDB 조회 모드 (선택): `-v $(pwd)/geoip:/app/data/geoip:ro`를 마운트한 뒤, `설정 -> 환경설정 -> IP 조회 소스`에서 로컬로 전환하세요.

### 옵션 3: 원클릭 스크립트

포트 충돌을 자동으로 감지하고 모든 설정을 구성합니다:

```bash
# curl 사용
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/setup.sh | bash

# 또는 wget 사용
wget -qO- https://raw.githubusercontent.com/foru17/neko-master/main/setup.sh | bash
```

스크립트가 자동으로 다음을 수행합니다:

- ✅ `docker-compose.yml` 다운로드
- ✅ 기본 포트(`3000/3001/3002`) 사용 여부 확인
- ✅ 사용 가능한 대체 포트 제안
- ✅ 구성 파일 작성 및 서비스 시작

### 옵션 4: 소스 코드

```bash
# 1. 저장소 클론
git clone https://github.com/foru17/neko-master.git
cd neko-master

# 2. 의존성 설치
pnpm install

# 3. collector 환경 준비 (소스 모드는 apps/collector/.env를 읽습니다)
cp apps/collector/.env.example apps/collector/.env

# 4. 개발 서비스 시작
pnpm dev
```

<http://localhost:3000>에서 구성하세요.

> 소스 모드에서는 collector가 `3001/3002`, web이 기본적으로 `3000`에서 수신합니다.  
> `API_PORT`를 변경한 경우(3001이 아닌 경우), web `/api` 재작성 대상이 올바르게 가리키도록 `API_URL`도 함께 설정하세요(예: `API_URL=http://localhost:4001`).  
> `apps/collector/.env.local`이 `apps/collector/.env`보다 우선합니다.

## 🤖 Agent 배포

하나의 중앙 Neko Master 서비스로 여러 원격 디바이스(OpenWrt, Linux, macOS)에서 로컬 게이트웨이 데이터를 수집하려면 Agent 모드를 사용하세요. Agent는 게이트웨이 근처에서 동작하며 데이터를 수집해서 패널로 보고합니다 — 패널은 게이트웨이에 직접 접속하지 않습니다.

지원하는 게이트웨이 종류: **Clash / Mihomo** (WebSocket 실시간) 및 **Surge v5+** (HTTP 폴링).

### 빠른 설치 (UI가 생성한 명령)

1. 대시보드에서 `설정 → 백엔드`로 이동하여 `Agent` 백엔드를 추가하고 게이트웨이 종류를 선택합니다.
2. **"Agent 스크립트 보기"**를 클릭해 원라인 설치 명령을 복사한 후 대상 호스트에서 실행합니다:

```bash
# Clash / Mihomo 게이트웨이 예시
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER='http://your-panel:3000' \
        NEKO_BACKEND_ID='1' \
        NEKO_BACKEND_TOKEN='ag_xxx' \
        NEKO_GATEWAY_TYPE='clash' \
        NEKO_GATEWAY_URL='http://127.0.0.1:9090' \
        sh

# Surge 게이트웨이 예시
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/apps/agent/install.sh \
  | env NEKO_SERVER='http://your-panel:3000' \
        NEKO_BACKEND_ID='2' \
        NEKO_BACKEND_TOKEN='ag_yyy' \
        NEKO_GATEWAY_TYPE='surge' \
        NEKO_GATEWAY_URL='http://127.0.0.1:9091' \
        sh
```

설치 후 `nekoagent` 명령으로 인스턴스를 관리합니다:

```bash
nekoagent list               # 모든 인스턴스 목록
nekoagent status <instance>  # 실행 상태 확인
nekoagent logs <instance>    # 실시간 로그 확인
nekoagent restart <instance> # 재시작
nekoagent upgrade            # 전역 업그레이드 (CLI + 바이너리)
```

> 스크립트는 기존 설치를 자동으로 감지합니다 — 이미 `neko-agent`가 설치되어 있으면 다시 다운로드하지 않고 새 인스턴스만 추가합니다.  
> 동일 호스트에서 서로 다른 `NEKO_INSTANCE_NAME`으로 여러 인스턴스를 실행할 수 있으며, 각각 다른 게이트웨이를 가리킬 수 있습니다.

### Agent 문서

- [개요](./docs/agent/overview.md): 아키텍처, Direct vs Agent 비교, 보안 모델
- [빠른 시작](./docs/agent/quick-start.md): UI부터 실행 중인 Agent까지 엔드투엔드 설정
- [설치 가이드](./docs/agent/install.md): 설치 방법, systemd / launchd 자동 시작
- [구성](./docs/agent/config.md): 전체 플래그 및 환경 변수 레퍼런스
- [릴리즈 플로우](./docs/agent/release.md): 버전 관리 및 호환성 정책
- [트러블슈팅](./docs/agent/troubleshooting.md): 자주 발생하는 오류와 해결 방법

## 📖 첫 사용

![첫 사용](./assets/neko-master-setup.png)

### Clash / Mihomo 연결

1. <http://localhost:3000>을 엽니다.
2. 첫 방문 시 **게이트웨이 구성** 대화상자가 나타납니다.
3. 네트워크 게이트웨이(예: OpenClash) 연결 정보를 입력합니다:
   - **이름**: 사용자 지정 이름(예: "집 게이트웨이")
   - **유형**: `Clash / Mihomo` 선택
   - **호스트**: 게이트웨이 백엔드 주소(예: `192.168.101.1`)
   - **포트**: 게이트웨이 백엔드 포트(예: `9090`)
   - **토큰**: Secret이 설정된 경우에만 입력, 그렇지 않으면 비워 둡니다.
4. "백엔드 추가"를 클릭해 저장합니다.
5. 시스템이 자동으로 트래픽 데이터 수집 및 분석을 시작합니다.

> 💡 **게이트웨이 주소 확인 방법**: 게이트웨이 제어판(예: OpenClash)으로 이동 → "외부 제어" 활성화 → API 주소 복사

### Surge 연결

![Surge HTTP API 구성](./assets/neko-master-surge.png)

Neko Master는 Surge 게이트웨이에 연결해 완전한 규칙 체인 시각화와 트래픽 분석을 지원합니다.

#### 1. Surge HTTP API 활성화

Surge 구성에서 HTTP 원격 API를 활성화합니다:

```ini
[General]
http-api = 127.0.0.1:9091
http-api-tls = false
http-api-web-dashboard = true
```

또는 Surge 그래픽 인터페이스에서 구성:

- **HTTP 원격 API**: `설정` → `일반` → `HTTP 원격 API`
- **포트**: 기본 `9091`
- **인증**: 보안 강화를 위해 비밀번호 설정을 권장

#### 2. Neko Master에서 Surge 백엔드 추가

1. Neko Master 설정 대화상자를 엽니다.
2. "백엔드 추가"를 클릭합니다.
3. 연결 정보를 입력합니다:
   - **이름**: 사용자 지정 이름(예: "Surge 집")
   - **유형**: `Surge` 선택
   - **호스트**: Surge가 실행 중인 IP 주소(예: `192.168.1.1` 또는 `127.0.0.1`)
   - **포트**: HTTP API 포트(기본 `9091`)
   - **토큰**: HTTP API 비밀번호(설정한 경우)
4. "연결 테스트"를 클릭해 구성을 검증합니다.
5. 구성을 저장합니다.

> 💡 **참고**: Surge는 HTTP 폴링으로 데이터를 가져옵니다(Clash의 WebSocket 실시간 스트림 대비). 데이터 갱신 지연은 약 2초입니다.

## 🔧 포트 충돌 해결

"port already in use" 오류가 발생하면 다음 해결 방법을 참고하세요.

### 해결 방법 1: .env 파일 사용

`docker-compose.yml`과 같은 경로에 `.env` 파일을 생성합니다:

```env
WEB_EXTERNAL_PORT=8080    # Web UI 포트 변경
API_EXTERNAL_PORT=8081    # API 포트 변경
WS_EXTERNAL_PORT=8082     # WebSocket 외부 포트 변경 (직접 접근 시에만)
COOKIE_SECRET=your-long-random-secret   # 고정할 것을 강력 권장
```

그 다음 재시작:

```bash
docker compose down
docker compose up -d
```

이제 <http://localhost:8080>으로 접속할 수 있습니다.

### 해결 방법 2: docker-compose.yml 직접 수정

```yaml
ports:
  - "8080:3000" # 외부 8080 → 내부 3000
  - "8082:3002" # 외부 8082 → 내부 3002 (프록시/터널 WS 전달용)
```

> 참고: 리버스 프록시 없이 직접 WebSocket에 접근하면서 외부 WS 포트가 `3002`가 아닌 경우 `WS_EXTERNAL_PORT=<외부-ws-포트>`를 설정하세요.

### 해결 방법 3: 원클릭 스크립트 사용

```bash
curl -fsSL https://raw.githubusercontent.com/foru17/neko-master/main/setup.sh | bash
```

스크립트가 사용 가능한 포트를 자동으로 감지하고 제안합니다.

## 🐳 Docker 구성

### 포트

| 포트 | 용도 | 외부 노출 필요 | 설명 |
| :--: | :--: | :--: | :-- |
| 3000 | Web UI | ✅ | 프런트엔드 진입점 |
| 3001 | API | 선택 | 프런트엔드는 기본적으로 same-origin `/api`를 사용하므로 보통 외부 노출 불필요(기본 Compose가 매핑) |
| 3002 | WebSocket | 선택 | 실시간 푸시 엔드포인트, 리버스 프록시/터널 전달용으로만 권장(기본 Compose가 매핑) |

### 환경 변수 (배포)

| 변수 | 기본값 | 용도 | 설정 시점 |
| :-- | :-- | :-- | :-- |
| `WEB_PORT` | `3000` | 컨테이너 내부 Web 수신 포트 | 보통 변경하지 않음 |
| `API_PORT` | `3001` | 컨테이너 내부 API 수신 포트 | 보통 변경하지 않음 |
| `COLLECTOR_WS_PORT` | `3002` | 컨테이너 내부 WS 수신 포트 | 보통 변경하지 않음 |
| `DB_PATH` | `/app/data/stats.db` | SQLite 데이터 경로 | 데이터 경로 변경 시 |
| `WEB_EXTERNAL_PORT` | `3000` | `docker-compose.yml`의 외부 Web 포트 매핑 | 외부 Web 포트 변경 시 |
| `API_EXTERNAL_PORT` | `3001` | `docker-compose.yml`의 외부 API 포트 매핑 | 외부 API 직접 노출이 필요할 때 |
| `WS_EXTERNAL_PORT` | `3002` | `docker-compose.yml`의 외부 WS 포트 매핑, 직접 WS 포트 추론에도 사용 | 프록시 없이 직접 WS에 접근하면서 외부 WS 포트가 변경된 경우 |
| `NEXT_PUBLIC_API_URL` | 비어 있음 | 프런트엔드 API 기본 URL 재정의 (예: `https://api.example.com`) | API가 same-origin `/api`가 아닐 때 |
| `NEXT_PUBLIC_WS_URL` | 비어 있음 | 프런트엔드 WS URL 재정의 (절대 URL 또는 `/custom_ws`) | 커스텀 WS 경로/도메인 사용 시 |
| `NEXT_PUBLIC_WS_PORT` | `3002` | WS 직접 연결 폴백 포트(**빌드 타임 전용 — Docker 런타임에 설정해도 효과가 없음**. 대신 `WS_EXTERNAL_PORT` 사용) | 커스텀 소스 빌드에서만 |
| `API_URL` | `http://localhost:3001` | Next.js `/api` 재작성 대상 (주로 소스/커스텀 빌드) | API 수신 주소 변경 시 |
| `COOKIE_SECRET` | 자동 생성 | 쿠키 서명 시크릿, 고정하지 않으면 데이터 디렉터리가 영구 저장되지 않을 때 재시작 후 세션이 무효화될 수 있음 | 운영 환경에서 강력 권장 |
| `GEOIP_LOOKUP_PROVIDER` | `online` | IP 지리 정보 소스 (`online` / `local`) | 기본적으로 로컬 MMDB 조회를 사용하도록 설정 |
| `GEOIP_ONLINE_API_URL` | `https://api.ipinfo.es/ipinfo` | 온라인 IP 지리 정보 API 엔드포인트 (`ipinfo.my` 응답 스키마와 호환되어야 함) | 호환 엔드포인트를 자체 배포한 경우에만 설정 |
| `FORCE_ACCESS_CONTROL_OFF` | `false` | 접근 제어를 강제로 비활성화 (긴급 복구용) | 토큰 분실 시 임시로만 사용 |
| `SHOWCASE_SITE_MODE` | `false` | 읽기 전용 쇼케이스 모드 (민감한 쓰기 작업 차단) | 공개 데모 사이트에만 사용 |

### 고급 튜닝 변수 (선택)

| 변수 | 기본값 | 설명 |
| :-- | :-- | :-- |
| `FLUSH_INTERVAL_MS` | `30000` | collector 쓰기용 버퍼 플러시 간격 |
| `FLUSH_MAX_BUFFER_SIZE` | `5000` | 조기 플러시를 트리거하는 최대 버퍼 항목 수 |
| `REALTIME_MAX_MINUTES` | `180` | 실시간 메모리 내 윈도우 크기 (분) |
| `REALTIME_RANGE_END_TOLERANCE_MS` | `120000` | 범위 쿼리 종료 시각 허용 오차 |
| `SURGE_POLICY_SYNC_INTERVAL_MS` | `600000` | Surge 정책 동기화 간격 |
| `DB_RANGE_QUERY_CACHE_TTL_MS` | `8000` | 범위 쿼리 캐시 TTL |
| `DB_HISTORICAL_QUERY_CACHE_TTL_MS` | `300000` | 히스토리컬 쿼리 캐시 TTL |
| `DB_RANGE_QUERY_CACHE_MAX_ENTRIES` | `1024` | 범위 쿼리 캐시 최대 항목 수 |
| `DB_RANGE_QUERY_CACHE_DISABLED` | 비어 있음 | `1`로 설정하면 범위 쿼리 캐시 비활성화 |
| `DEBUG_SURGE` | `false` | Surge collector 디버그 로그 활성화 (`true`) |

### API / WS 해석 우선순위

1. API 클라이언트 base: `runtime-config.API_URL` → `NEXT_PUBLIC_API_URL` → same-origin `/api`
2. `/api` 서버 측 재작성 대상: `API_URL` (기본 `http://localhost:3001`, Next.js 재작성에 적용)
3. WS URL: `runtime-config.WS_URL` → `NEXT_PUBLIC_WS_URL` → 자동 후보 (`runtime-config.WS_PORT`가 설정되어 있으면 직접 포트가 우선, 아니면 `/_cm_ws` 먼저 시도)
4. WS 포트: `runtime-config.WS_PORT` (`WS_EXTERNAL_PORT`에서) → `NEXT_PUBLIC_WS_PORT` → `3002`
5. 일반적인 배포에서는 커스텀 WS 경로/도메인을 쓰지 않는 한 `NEXT_PUBLIC_WS_URL`을 설정할 필요가 없습니다.

### 운영 환경 베이스라인 (권장)

```env
NODE_ENV=production
DB_PATH=/app/data/stats.db
COOKIE_SECRET=<최소 32바이트 랜덤 문자열>
# 선택: 기본적으로 로컬 MMDB 조회 사용
# GEOIP_LOOKUP_PROVIDER=local
# 일반 운영에서는 false로 유지
# FORCE_ACCESS_CONTROL_OFF=false
```

`COOKIE_SECRET`은 `openssl rand -hex 32`로 생성하세요.

추가 권장 사항:

1. 영구 저장소(예: `./data:/app/data`)를 마운트해 데이터와 시크릿 손실을 방지하세요.
2. 직접 WS에 접근하면서 외부 WS 포트가 `3002`가 아니면 `WS_EXTERNAL_PORT`도 함께 설정하세요.
3. 소스 배포에서 API 포트/주소가 변경되면 `API_URL`도 함께 업데이트하세요.
4. 로컬 MMDB 조회를 사용하려면 `./geoip:/app/data/geoip:ro`를 마운트한 뒤 `설정 -> 환경설정 -> IP 조회 소스`에서 소스를 전환하세요.
5. MMDB 파일은 용량이 크며 이미지에 포함되어 있지 않습니다. `./geoip` 폴더에 고정된 이름으로 다운로드해 두세요.
   `GeoLite2-City.mmdb`, `GeoLite2-ASN.mmdb` (필수), `GeoLite2-Country.mmdb` (선택).
   권장 소스: <https://github.com/P3TERX/GeoLite.mmdb>.

> Agent의 고급 세부 사항(설치, 구성, 릴리즈, 호환성)은 `docs/agent/*`에서 관리합니다.

## 🗄️ ClickHouse (선택)

SQLite는 Neko Master의 기본 저장소 엔진이며 대부분의 사용자에게 충분합니다.  
다음과 같은 경우 ClickHouse 활성화를 고려하세요:

- 매우 큰 데이터셋 (수십만 개의 도메인/IP 항목)
- 긴 시간 범위(≥ 7일)에 대한 빠른 집계 쿼리
- 히스토리컬 통계를 구성/메타데이터 저장과 분리

> ClickHouse는 완전히 선택 사항입니다. ClickHouse 활성화 여부와 무관하게 SQLite는 항상 구성과 메타데이터 저장소로 남아 있습니다.

### 아키텍처 개요

ClickHouse가 활성화되면 시스템은 **듀얼 쓰기 모드**로 진입합니다:

```
BatchBuffer.flush()
    │
    ├──→ SQLite (구성 / 메타데이터, 항상 기록)
    └──→ ClickHouse (통계 트래픽 데이터, 듀얼 쓰기)
           └── 버퍼 테이블 → SummingMergeTree 비동기 머지
```

읽기 소스는 `STATS_QUERY_SOURCE`로 제어합니다 (기본값: `sqlite`).

### ClickHouse 활성화 (Docker)

#### 1단계: ClickHouse 컨테이너 시작

저장소에 기본 포함된 `docker-compose.yml`에는 이미 ClickHouse 서비스가 포함되어 있으며,  
`profiles: [clickhouse]` 게이트로 기본 시작에서 제외됩니다. 저장소 루트에서 다음을 실행합니다:

```bash
docker compose --profile clickhouse up -d
```

> ClickHouse 데이터는 `./data/clickhouse`에 영구 저장되며 메인 앱 데이터 디렉터리와 분리됩니다.

**커스텀 `docker-compose.yml`**(위 시나리오 A/B 등)을 사용하는 경우 ClickHouse 서비스 블록을 수동으로 추가하세요:

```yaml
services:
  neko-master:
    # ... 기존 구성 ...
    environment:
      # 기존 environment 섹션에 추가:
      - CH_ENABLED=${CH_ENABLED:-0}
      - CH_HOST=${CH_HOST:-clickhouse}
      - CH_PORT=${CH_PORT:-8123}
      - CH_DATABASE=${CH_DATABASE:-neko_master}
      - CH_USER=${CH_USER:-neko}
      - CH_PASSWORD=${CH_PASSWORD:-neko_master}
      - CH_WRITE_ENABLED=${CH_WRITE_ENABLED:-0}
      - STATS_QUERY_SOURCE=${STATS_QUERY_SOURCE:-sqlite}
    networks:
      - neko-master-network

  clickhouse:
    image: clickhouse/clickhouse-server:24.8
    container_name: neko-master-clickhouse
    restart: unless-stopped
    profiles: ["clickhouse"]
    ports:
      - "${CH_EXTERNAL_HTTP_PORT:-8123}:8123"
      - "${CH_EXTERNAL_NATIVE_PORT:-9000}:9000"
    volumes:
      - ./data/clickhouse:/var/lib/clickhouse
    environment:
      - CLICKHOUSE_DB=${CH_DATABASE:-neko_master}
      - CLICKHOUSE_USER=${CH_USER:-neko}
      - CLICKHOUSE_PASSWORD=${CH_PASSWORD:-neko_master}
      - CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1
    networks:
      - neko-master-network
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://127.0.0.1:8123/ping || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  neko-master-network:
    driver: bridge
```

#### 2단계: 환경 변수 구성

`.env` (`docker-compose.yml`과 같은 경로)에 다음을 추가합니다:

```env
# ClickHouse 연결 활성화
CH_ENABLED=1

# 듀얼 쓰기 활성화
CH_WRITE_ENABLED=1

# 읽기 소스: sqlite (기본) / auto (스마트 라우팅) / clickhouse (강제)
STATS_QUERY_SOURCE=auto

# ClickHouse 연결 (docker-compose.yml 기본값과 일치, 변경 불필요)
CH_HOST=clickhouse
CH_PORT=8123
CH_DATABASE=neko_master
CH_USER=neko
CH_PASSWORD=neko_master
```

재시작:

```bash
docker compose --profile clickhouse up -d
```

### ClickHouse 환경 변수

| 변수 | 기본값 | 설명 |
| :-- | :-- | :-- |
| `CH_ENABLED` | `0` | ClickHouse 연결 활성화 (`1`로 활성화) |
| `CH_WRITE_ENABLED` | `0` | 듀얼 쓰기 활성화 (`CH_ENABLED=1` 필요) |
| `CH_ONLY_MODE` | `0` | CH가 정상일 때 SQLite 통계 쓰기 건너뛰기 (CH 전용 모드) |
| `CH_HOST` | `clickhouse` | ClickHouse 호스트 주소 |
| `CH_PORT` | `8123` | ClickHouse HTTP 포트 |
| `CH_DATABASE` | `neko_master` | 데이터베이스 이름 |
| `CH_USER` | `neko` | 사용자 이름 |
| `CH_PASSWORD` | `neko_master` | 비밀번호 |
| `CH_SECURE` | `0` | HTTPS 연결 사용 |
| `CH_REQUIRED` | `0` | CH를 사용할 수 없으면 시작 거부 |
| `CH_AUTO_CREATE_TABLES` | `1` | 첫 시작 시 테이블 자동 생성 |
| `CH_WRITE_MAX_PENDING_BATCHES` | `200` | 대기 중인 최대 쓰기 배치 수 |
| `CH_UNHEALTHY_THRESHOLD` | `5` | 비정상 표시 전 연속 실패 횟수 (SQLite로 자동 폴백) |
| `STATS_QUERY_SOURCE` | `sqlite` | 읽기 소스: `sqlite` / `auto` / `clickhouse` |
| `CH_COMPARE_ENABLED` | `0` | SQLite ↔ ClickHouse 일관성 검사 활성화 |
| `CH_EXTERNAL_HTTP_PORT` | `8123` | ClickHouse HTTP 외부 포트 (Compose 매핑) |
| `CH_EXTERNAL_NATIVE_PORT` | `9000` | ClickHouse Native 외부 포트 (Compose 매핑) |

> **상태 & 폴백**: `CH_UNHEALTHY_THRESHOLD`회 연속 쓰기 실패 후 시스템은 ClickHouse를 자동으로 비정상 상태로 표시하고 SQLite 쓰기를 재개합니다 — `CH_ONLY_MODE=1`인 경우에도 마찬가지입니다. ClickHouse가 복구되면 다시 정상으로 표시되고 로그가 남습니다.

### 기존 사용자 마이그레이션 가이드

> SQLite 전용 버전에서 업그레이드하시나요? **데이터는 안전합니다.**  
> SQLite 파일(`./data/stats.db`)은 완전히 보존됩니다. 다음은 점진적 마이그레이션 경로입니다.

#### 1단계: 듀얼 쓰기 (관찰 기간, 권장 시작점)

```env
CH_ENABLED=1
CH_WRITE_ENABLED=1
STATS_QUERY_SOURCE=sqlite   # CH가 데이터를 누적하는 동안 SQLite에서 계속 읽기
```

서비스를 시작한 뒤 `[ClickHouse Writer]` 로그를 확인해 쓰기가 성공하는지 살펴보세요.

#### 2단계: 읽기 소스 전환

```env
STATS_QUERY_SOURCE=auto        # 스마트 라우팅: 최근 데이터는 CH, 히스토리컬은 SQLite
# 또는
STATS_QUERY_SOURCE=clickhouse  # 모든 읽기를 ClickHouse로 강제
```

#### 3단계 (선택): 히스토리컬 데이터 마이그레이션

기존 SQLite 통계를 ClickHouse로 옮기려면:

```bash
# 표준 마이그레이션 (CH를 truncate한 뒤 재임포트, 일관성 검사 포함)
./scripts/ch-migrate-docker.sh

# 추가 모드 (기존 CH 데이터를 유지하고 점진적으로 임포트)
./scripts/ch-migrate-docker.sh --append

# 특정 시간 범위 지정
./scripts/ch-migrate-docker.sh --from 2026-02-01T00:00:00Z --to 2026-02-20T00:00:00Z
```

#### 4단계 (선택): CH 전용 모드

ClickHouse가 안정적으로 동작하면 SQLite 통계 쓰기를 중지합니다:

```env
CH_ONLY_MODE=1
```

> `CH_ONLY_MODE=1`에서도 ClickHouse가 비정상이 되면 시스템은 자동으로 SQLite 쓰기로 폴백합니다 — 데이터 손실이 발생하지 않습니다.

### SQLite 전용으로 되돌리기

언제든지 완전히 롤백할 수 있습니다:

```env
CH_ENABLED=0
CH_WRITE_ENABLED=0
CH_ONLY_MODE=0
STATS_QUERY_SOURCE=sqlite
```

재시작하면 모든 것이 순수 SQLite 모드로 돌아옵니다. 기존 데이터는 그대로 유지됩니다.

---

## 🌐 리버스 프록시 & 터널

권장 구성: Web과 WS를 같은 도메인 아래에 두고 경로로 라우팅합니다.  
`/` → `3000`, `/_cm_ws` → `3002`.

### Nginx 표준 예시

```nginx
server {
  listen 443 ssl http2;
  server_name neko.example.com;

  location / {
    proxy_pass http://<neko-master-host>:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location ^~ /_cm_ws {
    proxy_pass http://<neko-master-host>:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
    proxy_buffering off;
  }
}
```

환경 변수 재정의 (선택):

```env
# 기본값(이미 /_cm_ws)이므로 보통 불필요
# NEXT_PUBLIC_WS_URL=/custom_ws
```

### Cloudflare Tunnel 표준 예시

`~/.cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-name-or-id>
credentials-file: /path/to/<credentials>.json

ingress:
  - hostname: neko.example.com
    path: /_cm_ws*
    service: http://localhost:3002
  - hostname: neko.example.com
    path: /*
    service: http://localhost:3000
  - service: http_status:404
```

실행:

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run <your-tunnel-name-or-id>
```

Zero Trust 대시보드에서 토큰 모드로 관리되는 라우트의 경우, 동일한 두 라우트를 구성하고 `/_cm_ws*`를 `/*`보다 위에 두세요.

### 핵심 주의 사항

1. WS 경로로 `ws` (앞에 슬래시 없음)를 사용하지 마세요. 과도하게 매칭되어 `/_next/static/...` → `426 Upgrade Required` 오류가 발생할 수 있습니다.
2. WS 라우트는 catch-all `/*`보다 위에 있어야 합니다.
3. `NEXT_PUBLIC_WS_URL`은 기본적으로 선택입니다. 커스텀한 경우 프런트엔드/컨테이너를 재시작하세요.
4. `3000`만 매핑해도 동작하지만 HTTP 폴링(약 5초)으로 폴백되어 실시간성이 떨어집니다.
5. `beacon.min.js` 실패(Cloudflare 분석 스크립트)는 일반적으로 앱 API/WS 데이터 흐름과 무관합니다.
6. 대부분의 설정에서 `/api` 리버스 프록시 규칙은 추가로 필요하지 않습니다. 프런트엔드가 same-origin `/api`를 사용하고 앱이 내부적으로 `3001`로 전달합니다.

> 참고: `/_next/static/... 426 Upgrade Required`는 **잘못 구성된 리버스 프록시 / 터널** 환경에서 흔히 발생하며, 프록시 없이 로컬에서 직접 접속할 때는 드물게 나타납니다.

### 멀티 아키텍처 지원

Docker 이미지는 `linux/amd64`와 `linux/arm64`를 모두 지원합니다.

### 데이터 영구 저장

데이터는 컨테이너 내부 `/app/data`에 저장됩니다. 데이터 손실을 방지하려면 호스트에 마운트하세요:

```yaml
volumes:
  - ./data:/app/data
```

### 최신 버전으로 업데이트

```bash
# 최신 이미지를 받아 재시작
docker compose pull
docker compose up -d
```

## 🔐 인증 & 보안

Neko Master는 대시보드 데이터를 보호하기 위해 접근 인증을 지원합니다.

### 운영 보안 베이스라인

1. 고정된 `COOKIE_SECRET`을 설정하세요(그렇지 않으면 재시작 후 세션이 무효화될 수 있음).
2. 정상 운영 시 `FORCE_ACCESS_CONTROL_OFF=true`를 켜둔 상태로 두지 마세요.
3. `SHOWCASE_SITE_MODE=true`는 공개 데모 환경에서만 사용하세요(쓰기 작업이 제한됨).

예시:

```env
COOKIE_SECRET=<최소 32바이트 랜덤 문자열>
# FORCE_ACCESS_CONTROL_OFF=false
# SHOWCASE_SITE_MODE=false
```

### 인증 활성화 / 비활성화

1. 대시보드를 열고 왼쪽 하단 사이드바에서 "설정"을 클릭합니다.
2. "보안" 탭으로 이동합니다.
3. 접근 제어를 켜거나 끄고 토큰을 설정합니다.

### 토큰 분실 (긴급 재설정)

토큰을 잊어버린 경우 임시로 `FORCE_ACCESS_CONTROL_OFF=true`를 설정해 긴급 모드로 진입할 수 있습니다.

#### Docker Compose

1. `docker-compose.yml`에 다음을 추가합니다:

   ```yaml
   environment:
     - FORCE_ACCESS_CONTROL_OFF=true
   ```

2. 재시작:

   ```bash
   docker compose up -d
   ```

3. 대시보드를 열고 "설정 -> 보안"에서 토큰을 재설정합니다.
4. 재설정 직후 이 환경 변수를 즉시 제거하고 다시 재시작하세요.

#### Docker CLI

1. 컨테이너를 중지하고 제거합니다:

   ```bash
   docker stop neko-master
   docker rm neko-master
   ```

2. 긴급 플래그와 함께 다시 실행합니다:

   ```bash
   docker run -d \
     --name neko-master \
     -p 3000:3000 \
     -v $(pwd)/data:/app/data \
     -e FORCE_ACCESS_CONTROL_OFF=true \
     foru17/neko-master:latest
   ```

3. 토큰을 재설정한 뒤 이 플래그를 제거하고 평소대로 재시작합니다.


## ❓ FAQ

### Q: `3000:3000`만 노출해도 정상 동작하나요?

**A:** 정상 동작합니다. 핵심 기능은 모두 사용할 수 있습니다.  
WebSocket이 라우팅되지 않으면 앱은 자동으로 HTTP 폴링으로 폴백합니다.  
실시간성을 모두 활용하려면 `/_cm_ws`를 `3002`로 라우팅하세요.

### Q: 포트 변경 후 충돌이 발생하거나 접속할 수 없어요.

**A:** `.env` (`docker-compose.yml`과 같은 경로)를 생성/수정하세요:

```env
WEB_EXTERNAL_PORT=8080
API_EXTERNAL_PORT=8081
WS_EXTERNAL_PORT=8082
```

그 다음 재시작:

```bash
docker compose down
docker compose up -d
```

### Q: 재시작 후 로그인/세션이 사라지는 이유는 무엇인가요?

**A:** 보통 `COOKIE_SECRET`이 고정되지 않았거나 데이터 디렉터리가 영구 저장되지 않았기 때문입니다.

1. 고정된 `COOKIE_SECRET` 설정
2. `./data:/app/data` 마운트

### Q: 로컬 MMDB 조회에는 어떤 파일이 필요한가요?

**A:** 프로젝트 디렉터리에 `./geoip`를 만들고(`docker-compose.yml`과 같은 레벨 권장) 다음을 두세요:

1. `GeoLite2-City.mmdb` (필수)
2. `GeoLite2-ASN.mmdb` (필수)
3. `GeoLite2-Country.mmdb` (선택)

권장 소스: <https://github.com/P3TERX/GeoLite.mmdb>.  
컨테이너 내부에서 고정된 조회 경로는 `/app/data/geoip`이므로 `./geoip:/app/data/geoip:ro`를 유지하세요. 나중에 업데이트할 때는 호스트의 `./geoip` 파일만 교체하면 됩니다.

### Q: OpenClash / 게이트웨이 연결에 실패해요.

**A:** 다음을 확인하세요:

1. 게이트웨이 측에서 외부 제어가 활성화되어 있는지
2. 호스트/포트가 올바른지
3. 토큰/Secret이 올바른지(설정한 경우)
4. 컨테이너 네트워크가 게이트웨이에 도달할 수 있는지

### Q: 데이터를 백업하고 복원하는 방법은 무엇인가요?

**A:** 먼저 백업:

```bash
cp -r ./data ./data-backup-$(date +%Y%m%d)
```

복원:

```bash
docker compose down
cp -r ./data-backup-YYYYMMDD/. ./data/
docker compose up -d
```

## 🏗️ 아키텍처 가이드

시스템 설계를 빠르게 이해하려면 다음 순서로 읽어보세요.

1. **시스템 아키텍처 다이어그램**: 전체 레이어링과 모듈 책임 → [docs/architecture.md](./docs/architecture.md)
2. **데이터 플로우**: Clash / Surge 수집 파이프라인과 집계
3. **데이터 모델 & 저장소**: SQLite 스키마, ClickHouse 버퍼 테이블, 보존 정책
4. **실시간 채널 설계**: `RealtimeStore` 머지 전략과 WebSocket 푸시
5. **ClickHouse 모듈**: 듀얼 쓰기 아키텍처, 상태 폴백, 읽기 라우팅

전체 문서 인덱스: [docs/README.md](./docs/README.md)

> 이 문서는 수집, 집계, 캐싱, 실시간 푸시, 멀티 백엔드 관리의 핵심 설계를 다룹니다.

## 🤝 피드백 & 이슈

본 프로젝트는 GitHub Issue 템플릿(Bug / Feature / Support)을 사용합니다.

다음을 최소한 포함해 주세요:

1. 배포 방법 (Compose / Docker Run / Source)
2. 버전 정보(이미지 태그 또는 커밋)
3. 주요 환경 변수(마스킹, 예: `COOKIE_SECRET=***`)
4. 재현 절차와 기대/실제 동작
5. 주요 로그(`docker logs`, 브라우저 콘솔, 네트워크 오류)

## 📁 프로젝트 구조

```
neko-master/
├── docker-compose.yml      # Docker Compose 구성
├── Dockerfile              # Docker 이미지 빌드
├── setup.sh                # 원클릭 설치 스크립트
├── docker-start.sh         # Docker 컨테이너 시작 스크립트
├── start.sh                # 소스 코드 개발용 시작 스크립트
├── docs/                   # 문서 (docs/README.md 참고)
│   ├── README.md           # 문서 인덱스 (영문 기본)
│   ├── README.zh.md        # 문서 인덱스 (중국어)
│   ├── README.en.md        # 문서 인덱스 (영문 미러)
│   ├── architecture.md     # 시스템 아키텍처 (중국어)
│   ├── architecture.en.md  # 시스템 아키텍처 (영문)
│   ├── release-checklist.md
│   ├── agent/              # Agent 문서 (한/영/중)
│   │   ├── overview.md / overview.en.md
│   │   ├── quick-start.md / quick-start.en.md
│   │   ├── install.md / install.en.md
│   │   ├── config.md / config.en.md
│   │   ├── release.md / release.en.md
│   │   └── troubleshooting.md / troubleshooting.en.md
│   ├── research/           # 리서치 보고서
│   └── dev/                # 내부 개발 문서
├── assets/                 # 스크린샷과 아이콘
├── apps/
│   ├── collector/          # 데이터 수집 서비스 (Node.js + WebSocket)
│   ├── agent/              # Agent 데몬 (Go)
│   └── web/                # Next.js 프런트엔드 앱
└── packages/
    └── shared/             # 공유 타입과 유틸리티
```

## 🛠️ 기술 스택

- **프런트엔드**: [Next.js 16](https://nextjs.org/) + [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **스타일링**: [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **차트**: [Recharts](https://recharts.org/)
- **다국어**: [next-intl](https://next-intl-docs.vercel.app/)
- **백엔드**: [Node.js](https://nodejs.org/) + [Fastify](https://www.fastify.io/) + WebSocket
- **데이터베이스**: [SQLite](https://www.sqlite.org/) ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) + [ClickHouse](https://clickhouse.com/) (선택)
- **빌드**: [pnpm](https://pnpm.io/) + [Turborepo](https://turbo.build/)

## 🤝 기여

기여를 환영합니다!

- 🐛 [버그 신고](https://github.com/foru17/neko-master/issues/new)
- 💡 [기능 요청](https://github.com/foru17/neko-master/issues/new)
- 🔧 [코드 기여](https://github.com/foru17/neko-master/pulls)

## 📄 라이선스

[MIT](LICENSE) © [foru17](https://github.com/foru17)

---

## ⭐ Star 추이

[![Star History Chart](https://api.star-history.com/svg?repos=foru17/neko-master&type=date&legend=top-left)](https://www.star-history.com/#foru17/neko-master&type=date&legend=top-left)

---

<p align="center">
  <sub>Made with ❤️ by <a href="https://github.com/foru17">@foru17</a></sub><br>
  <sub>이 프로젝트가 도움이 되었다면 ⭐ 한 번 부탁드립니다.</sub>
</p>