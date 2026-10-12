import { ArrowRight, Check, ExternalLink, LoaderCircle, Monitor, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import type { Health } from './types';

type Props = { health: Health | null; error: string; busy: boolean; onLogin: () => void; onRefresh: () => void; onContinue: () => void };

export default function OperatorLogin({ health, error, busy, onLogin, onRefresh, onContinue }: Props) {
  const running = health?.login.status === 'running';
  const ready = !!health?.ready && !running;
  const failed = health?.login.status === 'failed';
  return <div className="operator-page">
    <header className="operator-header"><div className="brand"><span className="brand-symbol">◌</span><span><strong>동그란 순간</strong><small>AI 티코스터 공방</small></span></div><span className="operator-label"><Monitor size={16}/> 운영자 PC</span></header>
    <main className="operator-layout">
      <section className="operator-intro"><p className="eyebrow"><Sparkles size={16}/> 공방을 여는 첫 단계</p><h1>이 PC에서 로그인하고,<br/><em>동그란 순간</em>을 시작해요.</h1><p className="operator-copy">사진 한 장이 나만의 티코스터가 되는 시간.<br/>그림을 만들 운영자 PC의 Codex를 연결해 주세요.</p>
        <ol className="operator-steps"><li className={!ready ? 'current' : ''}><span>{ready ? <Check size={17}/> : '01'}</span><div><strong>Codex 로그인</strong><p>ChatGPT 계정으로 이 PC 연결하기</p></div></li><li className={ready ? 'current' : ''}><span>02</span><div><strong>공방 시작하기</strong><p>사진을 담고 원하는 그림 느낌 고르기</p></div></li><li><span>03</span><div><strong>함께 체험하기</strong><p>공방에서 모바일 링크와 QR 열기</p></div></li></ol>
        <p className="operator-footnote"><ShieldCheck size={17}/> API 키 없이, 운영자 계정의 Codex 사용 한도로 생성합니다.</p>
      </section>
      <section className="operator-card" aria-label="운영자 Codex 로그인">
        <div className="operator-pc"><span className="operator-pc-icon"><Monitor size={27}/></span><div><small>현재 연결할 컴퓨터</small><strong>{health?.operator?.name || '현재 운영자 PC'}</strong><p>{health?.operator ? (health.operator.platform === 'win32' ? 'Windows' : health.operator.platform) + ' · ' + health.operator.arch : '연결 정보를 확인하고 있습니다'}</p></div></div>
        <div className={`operator-status ${ready ? 'connected' : ''}`} role="status">{!health || running ? <LoaderCircle size={18} className="spin"/> : ready ? <Check size={18}/> : <span className="operator-status-dot"/>}{!health ? '이 PC의 Codex를 확인하고 있어요' : running ? '브라우저에서 로그인 완료를 기다려요' : ready ? '이 PC의 Codex가 연결되었어요' : 'Codex 로그인이 필요해요'}</div>
        <h2>{ready ? '공방을 시작할 준비가 됐어요.' : running ? '공식 로그인 화면에서 연결해 주세요.' : 'ChatGPT 계정으로 연결하세요.'}</h2>
        <p className="operator-description">{ready ? '현재 PC에 저장된 ChatGPT 인증을 확인했습니다. 아래 버튼을 눌러 체험 화면으로 이동하세요.' : running ? '아래 로그인 페이지를 새 탭으로 열고 기기 코드를 입력하세요. 완료하면 이 화면에서 자동으로 연결을 확인합니다.' : health?.message || '잠시만 기다려 주세요. 실행 파일과 로그인 상태를 확인하고 있습니다.'}</p>
        {running && <div className="operator-device"><span>로그인 기기 코드</span><strong aria-label="로그인 기기 코드">{health.login.code || '코드 준비 중…'}</strong>{health.login.url && <a className="operator-primary" href={health.login.url} target="_blank" rel="noreferrer">공식 로그인 페이지 열기 <ExternalLink size={17}/></a>}<p>기기 코드 로그인이 꺼져 있다면 ChatGPT 보안 설정에서 허용한 뒤 진행해 주세요.</p></div>}
        {(error || failed) && <p className="operator-error" role="alert">{error || health?.login.message}</p>}
        {ready ? <button className="operator-primary" onClick={onContinue} disabled={busy}>공방 시작하기 <ArrowRight size={19}/></button> : !running && <button className="operator-primary" onClick={onLogin} disabled={!health || busy || health.busy || !health.cliVersion}>{busy ? <LoaderCircle size={18} className="spin"/> : <ShieldCheck size={18}/>} Codex로 로그인하기</button>}
        <div className="operator-secondary"><button onClick={onRefresh} disabled={busy}><RefreshCw size={14}/> 연결 다시 확인</button>{ready && <button onClick={onLogin} disabled={busy || health.busy}>다른 계정으로 로그인</button>}</div>
        <div className="operator-note"><strong>운영자 PC에서 한 번만 연결하세요</strong><p>다른 PC로 옮기면 그 PC에서 다시 로그인합니다. 모바일 참가자는 운영자가 여는 QR로 입장하며, 행사 중에는 이 PC를 켜 두세요.</p></div>
        {health?.cliVersion && <small className="operator-version">{health.cliVersion} · 앱 {health.version}</small>}
      </section>
    </main>
  </div>;
}
