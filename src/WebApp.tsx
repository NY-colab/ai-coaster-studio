import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ExternalLink, Link, LoaderCircle, Monitor, ShieldCheck, Sparkles, Unplug } from 'lucide-react';
import App from './App';
import { connect, disconnect, hasConnection } from './connection';

export default function WebApp() {
  const invite = new URLSearchParams(location.hash.slice(1)).has('host') ? location.href : '';
  const [link, setLink] = useState(invite);
  const [connected, setConnected] = useState(hasConnection() && !invite);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const starting = useRef(false);
  async function join(value: string) {
    if (starting.current) return;
    starting.current = true; setPending(true); setError('');
    try { await connect(value); history.replaceState(null, '', location.pathname); setConnected(true); setLink(''); }
    catch (e) { setError((e as Error).message); }
    finally { starting.current = false; setPending(false); }
  }
  useEffect(() => {
    const openInvite = () => {
      if (!new URLSearchParams(location.hash.slice(1)).has('host')) return;
      setConnected(false); setLink(location.href); void join(location.href);
    };
    openInvite(); window.addEventListener('hashchange', openInvite);
    return () => window.removeEventListener('hashchange', openInvite);
  }, []);
  useEffect(() => { const reset = () => { setConnected(false); setError('연결이 만료되었습니다. 새 행사 링크로 입장해 주세요.'); }; window.addEventListener('coaster-web-disconnect', reset); return () => window.removeEventListener('coaster-web-disconnect', reset); }, []);
  if (connected) return <><div className="web-connection-bar"><span><ShieldCheck size={15}/> 운영자 PC에 연결된 웹 공방</span><button onClick={() => { disconnect(); setConnected(false); }}><Unplug size={14}/> 이 기기 연결 닫기</button></div><App/></>;
  return <div className="operator-page"><header className="operator-header"><div className="brand"><span className="brand-symbol">◌</span><span><strong>동그란 순간</strong><small>AI 티코스터 공방</small></span></div><span className="operator-label">다운로드 없이 웹에서</span></header>
    <main className="operator-layout"><section className="operator-intro"><p className="eyebrow"><Sparkles size={16}/> QR로 만나는 작은 공방</p><h1>좋아하는 순간을,<br/><em>나만의 티코스터</em>로.</h1><p className="operator-copy">사진 한 장을 수채화, 크레파스, 캐리커처로.<br/>휴대폰과 컴퓨터에서 바로 체험하세요.</p><ol className="operator-steps"><li className="current"><span>01</span><div><strong>행사 링크로 연결</strong><p>운영자가 연 공방에 입장해요</p></div></li><li><span>02</span><div><strong>사진과 화풍 선택</strong><p>운영자 PC의 Codex가 그림을 만들어요</p></div></li><li><span>03</span><div><strong>9cm 티코스터 완성</strong><p>위치를 조절하고 PNG·PDF로 저장해요</p></div></li></ol></section>
    <section className="operator-card"><div className="operator-pc"><span className="operator-pc-icon"><Link size={27}/></span><div><small>웹 체험 시작</small><strong>열려 있는 공방에 연결하세요</strong><p>참가자는 별도 로그인이나 설치가 필요 없어요</p></div></div><h2>행사 링크를 받으셨나요?</h2><p className="operator-description">운영자에게 받은 링크를 붙여넣으세요. QR로 들어왔다면 자동으로 연결됩니다.</p><form onSubmit={e => { e.preventDefault(); void join(link); }}><label className="web-link-label" htmlFor="event-link">행사 링크</label><input className="web-link-input" id="event-link" type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="행사 링크 전체를 붙여넣어 주세요" required autoComplete="off" spellCheck={false}/><button className="operator-primary" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18}/> : <ArrowRight size={18}/>} {pending ? '운영자 PC에 연결 중…' : '공방 연결하기'}</button></form>{error && <p className="operator-error" role="alert">{error}</p>}
    <details className="web-operator-help"><summary><Monitor size={16}/> 운영자이신가요?</summary><p>운영자 PC에서 공방 앱을 실행하고 Codex에 로그인하세요. <b>모바일 체험 · QR → 모바일 체험 시작</b>을 누르면 이 웹앱에 바로 연결되는 링크와 QR이 생깁니다.</p><p>행사 중에는 PC를 켜 두세요. 체험 종료 버튼을 누르면 웹 참가자의 Codex 연결도 끊어집니다.</p><a href="https://github.com/NY-colab/ai-coaster-studio/releases/latest" target="_blank" rel="noreferrer">운영자 연결 프로그램 · 처음 한 번 설치 <ExternalLink size={13}/></a></details>
    <div className="operator-note"><strong>운영자가 연 체험에서만 생성됩니다</strong><p>사진과 작품은 운영자 PC에 저장되고, 그림 생성에 필요한 사진은 Codex로 전송됩니다. 행사 시간이나 요청 한도가 끝나면 생성할 수 없습니다.</p></div></section></main></div>;
}
