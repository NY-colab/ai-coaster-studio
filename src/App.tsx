import EventPanel from './EventPanel';
import OperatorLogin from './OperatorLogin';
import ProtectedImage from './ProtectedImage';
import { appFetch, hosted } from './connection';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, Camera, Check, ChevronDown, ChevronRight, CircleHelp, FileImage, ImagePlus, LoaderCircle, Minus, Plus, Printer, RotateCcw, Settings2, Smartphone, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { Edit, Health, Job, Style } from './types';
import { defaultEdit } from './types';

type Photo = { id: string; url: string; width: number; height: number };
type ApiError = Error & { code?: string };
type Phase = 'photo' | 'style' | 'result';

const styleChoices: { id: Style; title: string; desc: string; className: string; mark: string }[] = [
  { id: 'watercolor', title: '수채화', desc: '물감이 번진 듯 부드럽고 따뜻하게', className: 'watercolor', mark: '水' },
  { id: 'crayon', title: '크레파스', desc: '손으로 그린 듯 발랄하고 포근하게', className: 'crayon', mark: '✳' },
  { id: 'caricature', title: '캐리커처', desc: '특징을 살려 유쾌하고 사랑스럽게', className: 'caricature', mark: '☺' },
];

function isActive(job: Job) { return job.status === 'queued' || job.status === 'running'; }
function readableError(error: unknown) { return error instanceof Error ? error.message : '요청을 완료하지 못했습니다. 다시 시도해 주세요.'; }

async function parseError(response: Response): Promise<ApiError> {
  let body: { error?: string; code?: string } = {};
  try { body = await response.json(); } catch { /* no JSON body */ }
  const error = new Error(body.error || `요청을 처리하지 못했습니다. (${response.status})`) as ApiError;
  error.code = body.code;
  return error;
}

async function api<T>(path: string, options?: RequestInit, token?: string): Promise<T> {
  const headers = new Headers(options?.headers);
  if (token) headers.set('X-Coaster-Token', token);
  if (options?.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await appFetch(path, { ...options, headers });
  if (response.status === 410) { window.dispatchEvent(new Event('coaster-event-closed')); throw new Error('모바일 체험이 종료되었습니다. 운영자에게 문의해 주세요.'); }
  if (response.status === 401) { if (!hosted) window.location.assign('/'); throw new Error('행사 접속 코드로 다시 입장해 주세요.'); }
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}

async function fetchBlob(path: string, options?: RequestInit, token?: string) {
  const headers = new Headers(options?.headers);
  if (token) headers.set('X-Coaster-Token', token);
  if (options?.body) headers.set('Content-Type', 'application/json');
  const response = await appFetch(path, { ...options, headers });
  if (response.status === 410) { window.dispatchEvent(new Event('coaster-event-closed')); throw new Error('모바일 체험이 종료되었습니다. 운영자에게 문의해 주세요.'); }
  if (response.status === 401) { if (!hosted) window.location.assign('/'); throw new Error('행사 접속 코드로 다시 입장해 주세요.'); }
  if (!response.ok) throw await parseError(response);
  return response.blob();
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [operatorStarted, setOperatorStarted] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [style, setStyle] = useState<Style>('watercolor');
  const [phase, setPhase] = useState<Phase>('photo');
  const [edit, setEdit] = useState<Edit>(defaultEdit);
  const [safeZone, setSafeZone] = useState(true);
  const [copies, setCopies] = useState(1);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [eventOpen, setEventOpen] = useState(false);
  const [eventClosed, setEventClosed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const fileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraWanted = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const editRef = useRef(edit);
  const selectedIdRef = useRef(selectedId);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const saveTimer = useRef<number | undefined>(undefined);
  const tokenRef = useRef<string | undefined>(undefined);
  const previewRef = useRef<string | null>(null);
  const jobsRef = useRef<Job[]>([]);
  const mounted = useRef(true);

  useEffect(() => { const close = () => { setEventClosed(true); streamRef.current?.getTracks().forEach(t=>t.stop()); }; window.addEventListener('coaster-event-closed', close); return () => window.removeEventListener('coaster-event-closed', close); }, []);
  useEffect(() => {
    if(!health?.remote||!health.eventExpiresAt)return;
    const timer=window.setTimeout(()=>window.dispatchEvent(new Event('coaster-event-closed')),Math.max(0,Date.parse(health.eventExpiresAt)-Date.now()));
    return()=>window.clearTimeout(timer);
  },[health?.remote,health?.eventExpiresAt]);
  const current = jobs.find(job => job.id === selectedId) ?? null;
  const active = jobs.some(isActive) || !!health?.busy;
  const canGenerate = !!photo && !!health?.ready && !active && !busyAction;
  useEffect(() => { if (!active) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [active]);

  useEffect(() => { editRef.current = edit; }, [edit]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  useEffect(() => { tokenRef.current = health?.token; }, [health?.token]);
  useEffect(() => { previewRef.current = previewUrl; }, [previewUrl]);

  const refresh = useCallback(async () => {
    const [healthResult, jobsResult] = await Promise.allSettled([
      api<Health>('/api/health'), api<{ jobs: Job[] }>('/api/jobs'),
    ]);
    if (!mounted.current) return;
    if (healthResult.status === 'fulfilled') { setHealth(healthResult.value); tokenRef.current = healthResult.value.token; }
    if (jobsResult.status === 'fulfilled') {
      setJobs(jobsResult.value.jobs);
      jobsRef.current = jobsResult.value.jobs;
      const selected = selectedIdRef.current;
      if (selected && !jobsResult.value.jobs.some(job => job.id === selected)) setSelectedId(null);
    }
    if (healthResult.status === 'rejected' && jobsResult.status === 'rejected') setError('공방 서버에 연결할 수 없습니다. 앱을 다시 시작한 뒤 새로고침해 주세요.');
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; streamRef.current?.getTracks().forEach(track => track.stop()); if (previewRef.current) URL.revokeObjectURL(previewRef.current); window.clearTimeout(saveTimer.current); };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, active ? 1500 : 5000);
    return () => window.clearInterval(timer);
  }, [active, health?.login.status, health?.remote, refresh]);

  useEffect(() => {
    if (health && !health.remote && (!health.ready || health.login.status === 'running')) {
      setOperatorStarted(false);
      cameraWanted.current = false;
      streamRef.current?.getTracks().forEach(track => track.stop());
      setCameraOpen(false);
    }
  }, [health?.ready, health?.remote, health?.login.status]);

  const saveEdit = useCallback((jobId: string | null, snapshot: Edit) => {
    if (!jobId) return Promise.resolve();
    saveChain.current = saveChain.current.catch(() => undefined).then(async () => {
      const { job } = await api<{ job: Job }>(`/api/jobs/${encodeURIComponent(jobId)}/edit`, {
        method: 'PATCH', body: JSON.stringify({ edit: snapshot }),
      }, tokenRef.current);
      setJobs(previous => previous.map(item => item.id === job.id ? job : item));
    });
    return saveChain.current;
  }, []);

  const updateEdit = (next: Edit | ((old: Edit) => Edit)) => {
    setEdit(old => {
      const value = typeof next === 'function' ? next(old) : next;
      editRef.current = value;
      window.clearTimeout(saveTimer.current);
      if (selectedIdRef.current) saveTimer.current = window.setTimeout(() => {
        void saveEdit(selectedIdRef.current, editRef.current).catch(e => setError(`편집 내용을 저장하지 못했습니다. ${readableError(e)}`));
      }, 500);
      return value;
    });
  };

  async function flushEdit() {
    window.clearTimeout(saveTimer.current);
    if (selectedIdRef.current && jobsRef.current.find(j => j.id === selectedIdRef.current)?.status === 'succeeded') await saveEdit(selectedIdRef.current, editRef.current);
    else await saveChain.current;
  }

  async function openJob(job: Job) {
    try {
      await flushEdit();
      const latest = jobsRef.current.find(item => item.id === job.id) ?? job;
      setSelectedId(job.id); selectedIdRef.current = job.id;
      setEdit(latest.edit); editRef.current = latest.edit;
      setPhoto({ id: latest.photoId, url: latest.photoUrl, width: 0, height: 0 });
      setStyle(latest.style); setPhase('result'); setError('');
    } catch (e) { setError(`편집 내용을 저장하지 못했습니다. ${readableError(e)}`); }
  }

  async function nextParticipant() {
    try {
      await flushEdit();
      setSelectedId(null); selectedIdRef.current = null; setPhoto(null); setEdit(defaultEdit); editRef.current = defaultEdit;
      setStyle('watercolor'); setCopies(1); setRequestId(null); setPhase('photo'); setError('');
    } catch (e) { setError(`편집 내용을 저장하지 못했습니다. ${readableError(e)}`); }
  }

  async function upload(file: File) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setError('사진 파일(JPG, PNG)을 선택해 주세요.'); return; }
    setBusyAction('upload'); setError('');
    try {
      await flushEdit();
      const form = new FormData(); form.set('photo', file);
      const result = await api<Photo>('/api/photos', { method: 'POST', body: form }, tokenRef.current);
      setPhoto(result); setSelectedId(null); selectedIdRef.current = null; setPhase('style'); setRequestId(null);
    } catch (e) { setError(readableError(e)); }
    finally { setBusyAction(null); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function startCamera() {
    setCameraError(''); cameraWanted.current = true; setCameraOpen(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저에서는 카메라를 사용할 수 없습니다. 파일에서 사진을 골라 주세요.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      if (!cameraWanted.current || !mounted.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      window.setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play(); } }, 0);
    } catch (e) { setCameraError(readableError(e)); }
  }

  function closeCamera() { cameraWanted.current = false; streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; setCameraOpen(false); }

  async function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) { setCameraError('카메라 화면이 준비되면 다시 눌러 주세요.'); return; }
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .92));
    if (!blob) { setCameraError('사진을 캡처하지 못했습니다. 다시 시도해 주세요.'); return; }
    closeCamera(); await upload(new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' }));
  }

  async function generate() {
    if (!photo || !canGenerate) return;
    const id = requestId ?? crypto.randomUUID(); setRequestId(id); setBusyAction('generate'); setError('');
    try {
      const { job } = await api<{ job: Job }>('/api/jobs', { method: 'POST', body: JSON.stringify({ photoId: photo.id, style, requestId: id }) }, tokenRef.current);
      setJobs(old => [job, ...old.filter(item => item.id !== job.id)]);
      setSelectedId(job.id); selectedIdRef.current = job.id; setEdit(job.edit); editRef.current = job.edit; setPhase('result'); setRequestId(null);
    } catch (e) { setError(readableError(e)); }
    finally { setBusyAction(null); }
  }

  async function exportFile(format: 'png' | 'pdf') {
    if (!current || current.status !== 'succeeded') return;
    const popup = format === 'pdf' ? window.open('', '_blank') : null;
    if (popup) { popup.document.title = '인쇄용 PDF 준비 중'; popup.document.body.innerHTML = '<p style="font:18px sans-serif;padding:32px">인쇄용 PDF를 준비하고 있습니다…</p>'; }
    setBusyAction(format); setError('');
    try {
      await flushEdit();
      const blob = await fetchBlob('/api/export', { method: 'POST', body: JSON.stringify({ format, items: [{ jobId: current.id, edit: editRef.current, copies: format === 'pdf' ? copies : 1 }] }) }, tokenRef.current);
      const name = `donggeuran-sungan-${current.id.slice(0, 8)}.${format}`;
      if (format === 'pdf') {
        const url = URL.createObjectURL(blob);
        if (popup && !popup.closed) popup.location.href = url;
        else download(blob, name);
        window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
      } else download(blob, name);
    } catch (e) { popup?.close(); setError(readableError(e)); }
    finally { setBusyAction(null); }
  }

  async function calibration() {
    setBusyAction('calibration'); setError('');
    try {
      const blob = await fetchBlob('/api/calibration.pdf');
      const url = URL.createObjectURL(blob); const popup = window.open(url, '_blank');
      if (!popup) download(blob, 'coaster-calibration.pdf');
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    } catch (e) { setError(readableError(e)); }
    finally { setBusyAction(null); }
  }

  async function login() {
    setBusyAction('login'); setError('');
    try {
      const { login: result } = await api<{ login: Health['login'] }>('/api/auth/login', { method: 'POST' }, tokenRef.current);
      setHealth(old => old ? { ...old, login: result } : old);
    } catch (e) { setError(readableError(e)); }
    finally { setBusyAction(null); }
  }

  async function checkConnection() {
    setBusyAction('check'); setError('');
    try {
      if (!tokenRef.current) { await refresh(); return; }
      const result = await api<Health>('/api/auth/check', { method: 'POST' }, tokenRef.current);
      setHealth(result); tokenRef.current = result.token;
    } catch (e) { setError(readableError(e)); }
    finally { setBusyAction(null); }
  }

  async function shutdown() {
    try { await flushEdit(); await api('/api/shutdown', { method: 'POST' }, tokenRef.current); document.body.innerHTML = '<main style="font:20px Malgun Gothic,sans-serif;padding:80px;text-align:center;background:#faf9f4;color:#244839"><h1>공방이 종료되었습니다.</h1><p>이 창을 닫아도 됩니다.</p></main>'; } catch(e) { setError(readableError(e)); }
  }

  async function clearData() {
    setBusyAction('clear'); setError('');
    try {
      await api<{ ok: true }>('/api/data', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) }, tokenRef.current);
      setJobs([]); setPhoto(null); setSelectedId(null); selectedIdRef.current = null; setEdit(defaultEdit); editRef.current = defaultEdit;
      setPhase('photo'); setRequestId(null); setClearOpen(false); await refresh();
    } catch (e) { setError(readableError(e)); }
    finally { setBusyAction(null); }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!current?.imageUrl || current.status !== 'succeeded') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: edit.x, startY: edit.y };
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId || !viewportRef.current) return;
    const size = viewportRef.current.getBoundingClientRect().width;
    updateEdit(old => ({ ...old, x: Math.max(-1, Math.min(1, drag.startX + (event.clientX - drag.x) / size)), y: Math.max(-1, Math.min(1, drag.startY + (event.clientY - drag.y) / size)) }));
  }
  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null; }

  const currentStatus = current?.status === 'queued' ? '차례를 기다리고 있어요' : current?.status === 'running' ? (current.stage || '그림을 그리고 있어요') : '';
  const steps = [{ key: 'photo', name: '사진 담기' }, { key: 'style', name: '느낌 고르기' }, { key: 'result', name: '완성하기' }] as const;
  const stepIndex = steps.findIndex(step => step.key === phase);

  if(eventClosed) return <main className="event-ended"><span className="brand-symbol">◌</span><h1>오늘의 체험이 끝났어요.</h1><p>이 휴대폰과 운영자 PC의 연결이 종료되었습니다.<br/>새 체험은 운영자에게 받은 새 QR로 입장해 주세요.</p></main>;
  if (!health && hosted) return <main className="event-ended"><LoaderCircle className="spin" size={28}/><h1>공방에 연결하고 있어요</h1><p>{error || "운영자 PC의 체험 상태를 확인하고 있습니다."}</p></main>;
  if (!health || (!health.remote && (!operatorStarted || !health.ready || health.login.status === 'running'))) return <OperatorLogin health={health} error={error} busy={!!busyAction} onLogin={() => void login()} onRefresh={() => void checkConnection()} onContinue={() => { setError(''); setOperatorStarted(true); }}/>;
  return <div className="app-shell">
    <header className="site-header">
      <div className="header-inner">
        <button className="brand" onClick={() => void nextParticipant()} aria-label="처음으로 돌아가기"><span className="brand-symbol">◌</span><span><strong>동그란 순간</strong><small>AI 티코스터 공방</small></span></button>
        <nav className="steps" aria-label="제작 단계">{steps.map((step, index) => <div className={`step ${index === stepIndex ? 'is-current' : ''} ${index < stepIndex ? 'is-done' : ''}`} key={step.key}><span className="step-number">{index < stepIndex ? <Check size={15} /> : `0${index + 1}`}</span><span>{step.name}</span>{index < 2 && <span className="step-line" />}</div>)}</nav>
        {health && !health.remote && <button className="header-settings" aria-label="모바일 체험 · QR" onClick={() => setEventOpen(true)}><Smartphone size={19}/><span>모바일 체험 · QR</span></button>}
        <button className="header-settings" onClick={() => setSettingsOpen(true)} aria-label="설정 열기"><Settings2 size={19} /><span>설정</span></button>
      </div>
    </header>

    <main>
      {error && <div className="notice error-notice" role="alert"><CircleHelp size={20} /><span>{error}</span><button aria-label="알림 닫기" onClick={() => setError('')}><X size={18} /></button></div>}
      {phase === 'photo' && <section className="intro-page page-wrap">
        <div className="eyebrow"><span className="eyebrow-dot" /> 오늘의 작은 공방</div>
        <h1>좋아하는 순간을<br /><em>매일 곁에</em> 두세요.</h1>
        <p className="intro-copy">사진 한 장이 세상에 하나뿐인 티코스터가 됩니다.<br />함께 웃었던 얼굴, 오래 간직하고 싶은 순간을 골라 주세요.</p>
        <div className="upload-options">
          <button className="upload-card" onClick={() => fileInput.current?.click()} disabled={!!busyAction}><span className="upload-icon peach"><ImagePlus size={31} strokeWidth={1.7}/></span><span className="upload-title">사진 파일 선택하기 <ChevronRight size={21}/></span><span className="upload-detail">휴대폰이나 컴퓨터에 저장된 사진</span></button>
          <button className="upload-card" onClick={() => void startCamera()} disabled={!!busyAction}><span className="upload-icon lavender"><Camera size={31} strokeWidth={1.7}/></span><span className="upload-title">지금 사진 찍기 <ChevronRight size={21}/></span><span className="upload-detail">카메라로 이 순간 바로 담기</span></button>
        </div>
        {busyAction === 'upload' && <p className="inline-loading"><LoaderCircle className="spin" size={18}/> 사진을 준비하고 있어요…</p>}
        <p className="intro-footnote"><ShieldCheck size={16}/> {health?.remote ? '사진과 작품은 운영자 PC에 보관되며, 이 기기에서 만든 결과만 표시됩니다.' : '사진은 이 기기의 공방에 보관되며, 설정에서 앱에 보관된 사진을 지울 수 있어요.'}</p>
        <div className="intro-decoration" aria-hidden="true"><span className="disc disc-one"/><span className="disc disc-two"/><span className="disc disc-three"/></div>
      </section>}

      {phase === 'style' && <section className="page-wrap style-page">
        <button className="text-back" onClick={() => setPhase('photo')}><ArrowLeft size={18}/> 사진 다시 고르기</button>
        <div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-dot"/> 두 번째, 나만의 느낌</span><h1>어떤 그림으로<br /><em>남겨 볼까요?</em></h1><p>마음에 드는 화풍을 골라 주세요. AI가 사진을 보고 그림을 그려 줍니다.</p></div><div className="selected-photo"><ProtectedImage src={photo?.url} alt="선택한 사진"/><span>선택한 사진</span></div></div>
        <div className="style-grid">{styleChoices.map(choice => <button key={choice.id} className={`style-card ${choice.className} ${style === choice.id ? 'selected' : ''}`} onClick={() => { setStyle(choice.id); setRequestId(null); }} aria-pressed={style === choice.id}><span className="style-art"><span className="style-art-circle">{choice.mark}</span></span><span className="style-text"><strong>{choice.title}</strong><small>{choice.desc}</small></span><span className="style-check">{style === choice.id ? <Check size={15}/> : null}</span></button>)}</div>
        <div className="style-footer"><p><ShieldCheck size={17}/> 생성하면 사진이 Codex로 전송되어 AI 그림 제작에 사용됩니다.</p><button className="primary-btn" onClick={() => void generate()} disabled={!canGenerate}>{busyAction === 'generate' ? <><LoaderCircle className="spin" size={19}/> 시작하는 중…</> : <>그림 만들기 <Sparkles size={19}/></>}</button></div>
        {!health?.ready && <p className="setup-hint">공방 연결이 필요합니다. 오른쪽 위 <button onClick={() => setSettingsOpen(true)}>설정</button>에서 상태를 확인해 주세요.</p>}
        {active && <p className="setup-hint">다른 그림을 만드는 중입니다. 완성되면 새 그림을 만들 수 있어요.</p>}
      </section>}

      {phase === 'result' && <section className="page-wrap result-page">
        <div className="result-top"><div><span className="eyebrow"><span className="eyebrow-dot"/> 마지막, 마음에 들게 다듬기</span><h1>우리의 <em>동그란 순간</em></h1><p>사진을 움직이고 크기를 조절해, 원하는 모습으로 완성해 주세요.</p>{current && isActive(current) && <p role="status">진행 시간 {Math.max(0, Math.floor((now - Date.parse(current.startedAt || current.createdAt)) / 1000))}초 · {current.stage}</p>}</div><div style={{display:'flex',gap:10}}><button className="outline-btn" disabled={active || !!busyAction} onClick={() => { void flushEdit().then(() => { setPhase('style'); setRequestId(null); }).catch(e => setError(readableError(e))); }}><Sparkles size={18}/> 다른 그림 만들기</button><button className="outline-btn next-btn" onClick={() => void nextParticipant()}><Plus size={18}/> 다음 참가자</button></div></div>
        <div className="studio-layout">
          <div className="canvas-panel"><div className="panel-title"><span>미리보기</span><span className="soft-label">{edit.shape === 'circle' ? '원형' : '사각형'} · {edit.sizeMm} mm</span></div>
            <div className="preview-stage">
              {current?.status === 'succeeded' && current.imageUrl ? <div className={`coaster-preview ${edit.shape}`} ref={viewportRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} role="img" aria-label="완성한 그림. 마우스나 손가락으로 드래그해 위치를 바꿀 수 있습니다."><ProtectedImage src={current.imageUrl} alt="" draggable={false} style={{ transform: `translate(${edit.x * 100}%, ${edit.y * 100}%) rotate(${edit.rotation}deg) scale(${edit.zoom})` }}/>{safeZone && <span className="safe-ring" style={{ inset: `${500 / edit.sizeMm}%` }} aria-hidden="true"/>}</div> : <div className="waiting-preview">{current?.status === 'failed' || current?.status === 'interrupted' ? <><CircleHelp size={37}/><strong>그림을 완성하지 못했어요</strong><p>{current.error || '다시 시도해 주세요.'}</p><button className="outline-btn" onClick={() => { setPhase('style'); setRequestId(null); }}>다시 만들기</button></> : <><span className="waiting-disc"><Sparkles size={45}/></span><strong>{currentStatus || '그림을 불러오는 중이에요'}</strong><p>조금만 기다려 주세요. 완성되면 여기서 만날 수 있어요.</p><LoaderCircle className="spin" size={21}/></>}</div>}
            </div>
            <div className="preview-hint"><span><ShieldCheck size={16}/> 점선 안쪽에 중요한 얼굴과 글씨를 두세요.</span><label className="switch-row"><input type="checkbox" checked={safeZone} onChange={e => setSafeZone(e.target.checked)}/> 안전선 보기</label></div>
            <p className="scale-note">화면의 크기는 실제 인쇄 크기와 다릅니다. 출력 전 시험 인쇄로 확인해 주세요.</p>
          </div>
          <div className="control-panel"><div className="panel-title"><span>디자인 조정</span><span className="panel-caption">끌어서 위치를 옮길 수 있어요</span></div>
            <fieldset disabled={current?.status !== 'succeeded'}><div className="control-group"><label>모양</label><div className="segmented"><button type="button" className={edit.shape === 'circle' ? 'active' : ''} onClick={() => updateEdit(old => ({ ...old, shape: 'circle' }))}><span className="shape-icon circle-icon"/> 원형</button><button type="button" className={edit.shape === 'square' ? 'active' : ''} onClick={() => updateEdit(old => ({ ...old, shape: 'square' }))}><span className="shape-icon square-icon"/> 사각형</button></div></div>
              <div className="control-group"><div className="control-label"><label htmlFor="size">완성 크기</label><strong>{edit.sizeMm} <small>mm</small></strong></div><input id="size" type="range" min="40" max="120" step="1" value={edit.sizeMm} onChange={e => updateEdit(old => ({ ...old, sizeMm: Number(e.target.value) }))}/><div className="range-labels"><span>40 mm</span><span>120 mm</span></div></div>
              <div className="control-group"><div className="control-label"><label htmlFor="zoom">사진 확대</label><strong>{Math.round(edit.zoom * 100)} <small>%</small></strong></div><input id="zoom" type="range" min="0.5" max="3" step="0.01" value={edit.zoom} onChange={e => updateEdit(old => ({ ...old, zoom: Number(e.target.value) }))}/><div className="range-labels"><span>50%</span><span>300%</span></div></div>
              <div className="control-group"><div className="control-label"><label htmlFor="rotation">사진 회전</label><strong>{edit.rotation} <small>°</small></strong></div><input id="rotation" type="range" min="-180" max="180" step="1" value={edit.rotation} onChange={e => updateEdit(old => ({ ...old, rotation: Number(e.target.value) }))}/><div className="range-labels"><span>−180°</span><span>+180°</span></div></div>
              <button className="reset-btn" type="button" onClick={() => updateEdit(old => ({ ...defaultEdit, shape: old.shape, sizeMm: old.sizeMm }))}><RotateCcw size={16}/> 위치·확대·회전 초기화</button>
            </fieldset>
            <div className="export-box"><div className="export-title"><span>완성 파일 받기</span><ArrowDownToLine size={18}/></div><p>PNG는 제작용 이미지, PDF는 A4 인쇄용입니다.</p><div className="export-actions"><button className="outline-btn" disabled={current?.status !== 'succeeded' || !!busyAction} onClick={() => void exportFile('png')}>{busyAction === 'png' ? <LoaderCircle className="spin" size={17}/> : <FileImage size={18}/>} PNG 저장</button><div className="copy-picker"><span>매수</span><button aria-label="매수 줄이기" disabled={copies <= 1} onClick={() => setCopies(c => Math.max(1, c - 1))}><Minus size={15}/></button><strong>{copies}</strong><button aria-label="매수 늘리기" disabled={copies >= 6} onClick={() => setCopies(c => Math.min(6, c + 1))}><Plus size={15}/></button></div></div><button className="primary-btn pdf-btn" disabled={current?.status !== 'succeeded' || !!busyAction} onClick={() => void exportFile('pdf')}>{busyAction === 'pdf' ? <><LoaderCircle className="spin" size={18}/> PDF 준비 중…</> : <><Printer size={18}/> A4 인쇄용 PDF 열기</>}</button><small>PDF를 연 뒤 인쇄창에서 실제 크기(100%)로 출력하세요.</small></div>
          </div>
        </div>
      </section>}

      {jobs.length > 0 && <section className="history page-wrap" aria-label="이전 작품"><div className="history-heading"><div><span className="eyebrow">우리의 작은 전시</span><h2>오늘 만든 작품</h2></div><span>{jobs.length}개의 순간</span></div><div className="history-list">{jobs.map(job => <button key={job.id} className={`history-item ${selectedId === job.id ? 'selected' : ''}`} onClick={() => void openJob(job)}><span className="history-thumb"><ProtectedImage src={job.imageUrl || job.photoUrl} alt=""/></span><span className="history-info"><strong>{styleChoices.find(choice => choice.id === job.style)?.title}</strong><small>{job.status === 'succeeded' ? new Date(job.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : job.status === 'failed' ? '제작 실패' : job.status === 'interrupted' ? '제작 중단' : job.stage || '제작 중'}</small></span><ChevronRight size={17}/></button>)}</div></section>}
    </main>

    <footer className="site-footer"><span>동그란 순간 <span className="footer-dot">◌</span> AI 티코스터 공방</span><span>한 장의 사진, 오래 남을 마음</span></footer>
    <input ref={fileInput} type="file" accept="image/jpeg,image/png" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); }} hidden aria-label="사진 파일 선택"/>

    {eventOpen && health && !health.remote && <EventPanel token={health.token} ready={health.ready} onClose={()=>setEventOpen(false)}/>}
    {cameraOpen && <div className="modal-backdrop" role="presentation"><div className="modal camera-modal" role="dialog" aria-modal="true" aria-label="사진 찍기"><button className="modal-close" aria-label="카메라 닫기" onClick={closeCamera}><X size={21}/></button><div className="modal-eyebrow">지금 이 순간</div><h2>카메라로 사진 찍기</h2><div className="camera-frame">{cameraError ? <p role="alert">{cameraError}</p> : <video ref={videoRef} autoPlay playsInline muted/>}</div><p>얼굴이 화면 가운데 오도록 맞춰 주세요.</p><button className="primary-btn" disabled={!!cameraError} onClick={() => void capture()}><Camera size={18}/> 사진 찍기</button></div></div>}

    {settingsOpen && <div className="modal-backdrop" role="presentation"><div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="공방 설정"><button className="modal-close" aria-label="설정 닫기" onClick={() => setSettingsOpen(false)}><X size={21}/></button><div className="modal-eyebrow">공방 관리</div><h2>설정</h2><div className="status-card"><span className={`status-dot ${health?.ready ? 'ok' : ''}`}/><div><strong>{health?.ready ? 'AI 공방이 준비되었어요' : 'AI 공방 연결이 필요해요'}</strong><p>{health?.message || '서버 상태를 확인하고 있어요.'}</p></div></div>{health?.imageGeneration === 'untested' && <p className="settings-note">AI 그림 생성은 첫 작품을 만들 때 확인됩니다.</p>}{health?.login.status === 'running' && <div className="login-panel"><LoaderCircle size={18} className="spin"/><div><strong>로그인 진행 중</strong><p>{health.login.message || '브라우저에서 로그인을 마쳐 주세요.'}</p>{health.login.code && <p>인증 코드: <b>{health.login.code}</b></p>}{health.login.url && <a href={health.login.url} target="_blank" rel="noreferrer">로그인 페이지 열기 ↗</a>}</div></div>}{!health?.remote && health?.login.status !== 'running' && <button className="outline-btn wide" disabled={!!busyAction || active} onClick={() => void login()}>{health?.ready ? 'Codex 다시 로그인' : 'Codex 로그인 시작하기'}</button>}
      {!health?.remote && <button className="settings-row" disabled={active || health?.login.status === 'running'} onClick={() => void shutdown()}><span>앱 종료</span><X size={18}/></button>}<div className="settings-divider"/><button className="settings-row" onClick={() => void calibration()} disabled={!!busyAction}><span><Printer size={19}/> A4 크기 확인용 PDF</span><ChevronRight size={18}/></button><p className="settings-note">처음 인쇄할 때 자로 크기를 확인해 주세요. 인쇄 설정은 실제 크기(100%)를 사용합니다.</p>{!health?.remote && <button className="settings-row danger-row" onClick={() => setClearOpen(true)} disabled={active || !!busyAction}><span><Trash2 size={19}/> 이 기기의 사진·작품 모두 지우기</span><ChevronRight size={18}/></button>}{health?.remote && <p className="settings-note">모바일 체험입니다. 이 기기에서 만든 작품만 볼 수 있습니다. 로그인 변경·사진 삭제·체험 종료는 운영자 PC에서 할 수 있습니다.</p>}{!health?.remote && active && <p className="settings-note">그림 제작이 끝나면 삭제할 수 있습니다.</p>}</div></div>}

    {clearOpen && <div className="modal-backdrop top-modal" role="presentation"><div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label="사진과 작품 삭제 확인"><div className="delete-icon"><Trash2 size={23}/></div><h2>모든 사진과 작품을 지울까요?</h2><p>이 기기의 공방에 저장된 사진과 결과물이 모두 삭제됩니다. 삭제한 뒤에는 되돌릴 수 없습니다. Codex 이미지 캐시와 서비스 기록은 별도로 관리됩니다.</p><div className="confirm-actions"><button className="outline-btn" onClick={() => setClearOpen(false)}>취소</button><button className="danger-btn" disabled={!!busyAction || active} onClick={() => void clearData()}>{busyAction === 'clear' ? '삭제 중…' : '모두 삭제'}</button></div></div></div>}
  </div>;
}

export default App;


