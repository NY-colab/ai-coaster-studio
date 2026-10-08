import {useEffect,useState} from 'react';
import {X,Smartphone,QrCode,Copy,Download,Power,LoaderCircle,ExternalLink} from 'lucide-react';
type EventState={status:'closed'|'starting'|'open';active:boolean;message:string;expiresAt?:string;maxGenerations?:number;used?:number;url?:string;joinUrl?:string;code?:string;qr?:string};
type Release={current:string;latest?:string;available:boolean;url:string;message:string};
export default function EventPanel({token,ready,onClose}:{token:string;ready:boolean;onClose:()=>void}) {
  const [event,setEvent]=useState<EventState|null>(null),[duration,setDuration]=useState(60),[limit,setLimit]=useState(100),[pending,setPending]=useState(false),[message,setMessage]=useState(''),[release,setRelease]=useState<Release|null>(null);
  const [now,setNow]=useState(Date.now());
  async function call<T>(url:string,body?:unknown):Promise<T>{const r=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Coaster-Token':token},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error||'요청을 처리하지 못했습니다.');return data;}
  useEffect(()=>{let live=true;const refresh=()=>{setNow(Date.now());void call<EventState>('/api/event').then(v=>{if(live)setEvent(v);}).catch(e=>{if(live)setMessage(e.message);});};refresh();const timer=window.setInterval(refresh,2000);return()=>{live=false;clearInterval(timer);};},[token]);
  async function action(start:boolean){setPending(true);setMessage('');try{setEvent(await call<EventState>(start?'/api/event/start':'/api/event/stop',start?{durationMinutes:duration,maxGenerations:limit}:{}));}catch(e){setMessage((e as Error).message);}finally{setPending(false);}}
  async function copy(){try{await navigator.clipboard.writeText(event?.joinUrl||'');setMessage('체험 링크를 복사했습니다. 링크를 받은 사람은 바로 입장할 수 있습니다.');}catch{setMessage('링크를 길게 누르거나 선택해서 복사해 주세요.');}}
  async function checkUpdate(){setPending(true);try{setRelease(await call<Release>('/api/updates'));}catch(e){setMessage((e as Error).message);}finally{setPending(false);}}
  const remaining=event?.expiresAt?Math.max(0,Math.ceil((Date.parse(event.expiresAt)-now)/60000)):0;
  return <div className="modal-backdrop"><section className="modal event-modal" role="dialog" aria-modal="true" aria-label="모바일 체험 관리">
    <button className="modal-close" onClick={onClose} aria-label="모바일 체험 관리 닫기"><X size={21}/></button>
    <div className="modal-eyebrow"><Smartphone size={17}/> 운영자 PC · 모바일 체험</div><h2>QR로 여는 작은 공방</h2>
    <p className="event-lead">참가자는 휴대폰으로 접속하고, 그림은 이 컴퓨터의 Codex가 만듭니다.</p>
    <div className={'event-status '+(event?.active?'is-open':'')}><span className={`status-dot ${event?.active?'ok':''}`}/><div><strong>{event?.message||'체험 상태를 확인하고 있습니다.'}</strong>{event?.active&&<small>{remaining}분 남음 · 생성 요청 {event.used} / {event.maxGenerations}장</small>}</div></div>
    {!event?.active&&<div className="event-setup"><label>체험 시간<select value={duration} onChange={e=>setDuration(Number(e.target.value))}><option value={15}>15분</option><option value={30}>30분</option><option value={60}>1시간</option><option value={120}>2시간</option><option value={180}>3시간</option><option value={240}>4시간</option><option value={480}>8시간</option></select></label><label>전체 생성 요청 한도<input type="number" min={1} max={1000} value={limit} onChange={e=>setLimit(Number(e.target.value))}/></label><button className="primary-btn" disabled={pending||!ready||!Number.isInteger(limit)||limit<1||limit>1000} onClick={()=>void action(true)}>{pending?<LoaderCircle className="spin" size={18}/>:<QrCode size={18}/>}모바일 체험 시작</button>{!ready&&<p>설정에서 이 컴퓨터의 Codex 로그인을 먼저 확인해 주세요.</p>}</div>}
    {event?.status==='starting'&&<p role="status"><LoaderCircle className="spin" size={18}/> 외부 주소와 QR코드를 준비하고 있습니다…</p>}
    {event?.status==='open'&&event.qr&&<div className="event-share"><img className="event-qr" src={event.qr} alt="모바일 체험 입장 QR코드"/><div className="event-link-box"><strong>휴대폰 카메라로 QR을 비춰 주세요</strong><p>QR 또는 체험 링크로 바로 입장합니다. 참가자는 자기 사진과 작품만 볼 수 있습니다.</p><input readOnly value={event.joinUrl} aria-label="모바일 체험 링크" onFocus={e=>e.target.select()}/><div className="event-buttons"><button className="outline-btn" onClick={()=>void copy()}><Copy size={17}/>링크 복사</button><a className="outline-btn" href={event.qr} download="티코스터-체험-QR.png"><Download size={17}/>QR 저장</a></div><small>직접 주소 입력 시 접속 코드: <b>{event.code}</b></small><small>자동 종료: {new Date(event.expiresAt!).toLocaleString('ko-KR')}</small></div></div>}
    {event?.active&&<button className="danger-btn event-stop" disabled={pending} onClick={()=>void action(false)}><Power size={18}/>체험 즉시 종료 · 모바일 연결 끊기</button>}
    <p className="event-note">종료 시 기존 링크·QR·접속 세션이 무효화되어 이 PC의 Codex로 새 요청을 보낼 수 없습니다. 실행 중인 모바일 생성도 중단을 요청합니다. 이미 사용된 할당량은 되돌릴 수 없습니다.</p>
    {message&&<p className="event-message" role="status">{message}</p>}
    <div className="event-update"><div><strong>업데이트와 패치</strong><p>체험을 종료한 뒤 폴더의 UPDATE.cmd를 실행하면 새 버전을 별도 폴더에 준비합니다.</p></div><button className="outline-btn" disabled={pending} onClick={()=>void checkUpdate()}>새 버전 확인</button>{release&&<p>현재 {release.current}{release.latest&&` · 최신 ${release.latest}`} · {release.message} <a href={release.url} target="_blank" rel="noreferrer">GitHub 릴리스 <ExternalLink size={13}/></a></p>}</div>
    <p className="event-note">이 PC의 전원·인터넷을 유지해 주세요. 임시 주소는 체험을 다시 열 때 바뀝니다.</p>
  </section></div>;
}
