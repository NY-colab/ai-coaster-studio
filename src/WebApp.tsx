import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, Link, LoaderCircle, Monitor, ShieldCheck, Sparkles, Unplug } from 'lucide-react';
import App from './App';
import { connect, connectOperator, closeConnection, hasConnection, isOperatorConnection } from './connection';

export default function WebApp() {
  const params = new URLSearchParams(location.hash.slice(1));
  const invite = params.has('host') || params.has('operator') ? location.href : '';
  const [link, setLink] = useState(params.has('host') ? invite : '');
  const [connected, setConnected] = useState(hasConnection() && !invite);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const [participant, setParticipant] = useState(params.has('host'));
  const starting = useRef(false);
  async function join(value: string, operator = false) {
    if (starting.current) return;
    starting.current = true; setPending(true); setError('');
    try { await (operator ? connectOperator(value) : connect(value)); history.replaceState(null, '', location.pathname); setConnected(true); setLink(''); }
    catch (e) { setError((e as Error).message); }
    finally { starting.current = false; setPending(false); }
  }
  useEffect(() => {
    const openInvite = () => {
      const p = new URLSearchParams(location.hash.slice(1));
      if (!p.has('host') && !p.has('operator')) return;
      const value = location.href;
      // Pairing secrets must not remain in history, copied URLs or screenshots.
      if (p.has('operator')) history.replaceState(null, '', location.pathname);
      setConnected(false); setParticipant(p.has('host')); setLink(p.has('host') ? value : ''); void join(value, p.has('operator'));
    };
    openInvite(); window.addEventListener('hashchange', openInvite);
    return () => window.removeEventListener('hashchange', openInvite);
  }, []);
  useEffect(() => {
    const reset = () => { setConnected(false); setError('연결이 만료되었습니다. 운영자는 이 PC를 다시 연결하고, 참가자는 새 행사 링크로 입장해 주세요.'); };
    window.addEventListener('coaster-web-disconnect', reset);
    return () => window.removeEventListener('coaster-web-disconnect', reset);
  }, []);
  async function leave() {
    setPending(true); setError('');
    try { await closeConnection(); setConnected(false); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }
  if (connected) return <><div className="web-connection-bar"><span><ShieldCheck size={15}/>{isOperatorConnection() ? '운영자 웹앱 · 내 PC의 Codex 연결' : '참가자 체험 · 운영자 PC 연결'}</span><button disabled={pending} onClick={() => void leave()}><Unplug size={14}/> 웹 연결 닫기</button></div>{error && <p className="operator-error" role="alert">{error}</p>}<App/></>;
  return <div className="operator-page"><header className="operator-header"><div className="brand"><span className="brand-symbol">◌</span><span><strong>동그란 순간</strong><small>AI 티코스터 공방</small></span></div><span className="operator-label"><Monitor size={16}/> 운영자 웹앱</span></header>
    <main className="operator-layout"><section className="operator-intro"><p className="eyebrow"><Sparkles size={16}/> 내 계정으로 여는 작은 공방</p><h1>내 Codex로 연결하고,<br/><em>우리 공방의 QR</em>을 열어요.</h1><p className="operator-copy">이 주소를 운영자에게 공유하세요.<br/>각자의 PC와 Codex 계정으로 독립된 체험을 운영합니다.</p><ol className="operator-steps"><li className="current"><span>01</span><div><strong>내 PC 연결</strong><p>처음에는 연결 프로그램을 준비해요</p></div></li><li><span>02</span><div><strong>내 Codex로 로그인</strong><p>이 웹앱에서 로그인과 공방을 관리해요</p></div></li><li><span>03</span><div><strong>참가자 QR 배포</strong><p>내 행사의 시간·생성 한도를 정해 열어요</p></div></li></ol><p className="operator-footnote"><ShieldCheck size={17}/> API 키 없이, 각 운영자의 Codex 사용 한도로 생성합니다.</p></section>
    <section className="operator-card"><div className="operator-pc"><span className="operator-pc-icon"><Monitor size={27}/></span><div><small>운영자 시작하기</small><strong>지금 사용하는 PC에 연결하세요</strong><p>Windows 10/11 x64 · Chrome 또는 Edge</p></div></div>
    {pending ? <div className="operator-status" role="status"><LoaderCircle className="spin" size={18}/> {participant ? '행사에 연결하고 있어요' : '내 PC와 웹앱을 연결하고 있어요'}</div> : <><h2>이 PC에서 처음 사용하시나요?</h2><p className="operator-description">약 4KB의 시작 파일을 내려받아 압축을 풀고 <b>START-LITE.cmd</b>를 실행하세요. 설치된 Codex를 찾아 재사용하고, 처음에만 필요한 파일을 받습니다. 열린 화면에서 <b>이 PC에서 공방 열기</b>를 누르면 이 PC의 운영 화면에서 Codex에 로그인할 수 있습니다.</p><a className="operator-primary" href="https://github.com/NY-colab/ai-coaster-studio/releases/download/v1.4.1/AI-Coaster-Studio-Lite.zip"><Download size={18}/> 작은 시작 파일 받기 · 4KB</a><p className="operator-description">Codex가 있으면 약 82MB, 없으면 약 240MB를 추가로 받습니다. 다음 실행부터는 다시 받지 않아요. <a href="https://github.com/NY-colab/ai-coaster-studio/releases/download/v1.4.1/AI-Coaster-Studio-Windows-x64.zip">전체 묶음 받기</a></p><div className="web-operator-help"><h3>이미 연결 프로그램을 켜 두셨나요?</h3><a className="outline-btn wide" href="http://127.0.0.1:4318/web-operator" target="_blank" rel="noreferrer"><ArrowRight size={17}/> 이 PC에서 공방 열기</a><p>연결 화면이 열리지 않으면 <b>START-LITE.cmd</b>를 다시 실행하세요. 전체 묶음은 <b>START.vbs</b>를 사용하세요. 기존 버전 사용자는 v1.4.1 이상으로 업데이트해 주세요.</p></div></>}
    {error && <p className="operator-error" role="alert">{error}</p>}
    <div className="operator-note"><strong>로그인부터 QR 발급까지 웹에서</strong><p>운영 화면은 이 PC의 브라우저에서 열립니다. 공방 시작 후 <b>모바일 체험 · QR</b>에서 참가자 링크를 발급합니다. 참가자는 설치 없이 접속합니다. 행사 중 PC와 연결 프로그램을 켜 두고, 끝나면 <b>체험 즉시 종료</b>를 누르세요.</p></div>
    <details className="web-operator-help" open={participant} onToggle={e=>setParticipant(e.currentTarget.open)}><summary><Link size={16}/> 참가자 행사 링크로 입장하기</summary><p>참가자 QR로 들어오면 자동으로 연결됩니다. 받은 링크를 직접 붙여넣을 수도 있습니다.</p><form onSubmit={e=>{e.preventDefault(); void join(link);}}><label className="web-link-label" htmlFor="event-link">행사 링크</label><input className="web-link-input" id="event-link" type="url" value={link} onChange={e=>setLink(e.target.value)} placeholder="운영자에게 받은 행사 링크" required autoComplete="off" spellCheck={false}/><button className="operator-primary" disabled={pending}><ArrowRight size={18}/> 참가자로 입장하기</button></form></details>
    </section></main></div>;
}
