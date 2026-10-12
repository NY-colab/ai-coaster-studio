import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { appFetch, hosted } from './connection';
export default function ProtectedImage({ src, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [image, setImage] = useState<string>();
  const [error, setError] = useState(false);
  const remote = hosted && src?.startsWith('/api/');
  useEffect(() => {
    if (!remote || !src) return;
    let live = true, url: string | undefined;
    const controller = new AbortController(); setImage(undefined); setError(false);
    void appFetch(src, { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error(); return r.blob(); }).then(blob => { if (live) { url = URL.createObjectURL(blob); setImage(url); } }).catch(() => { if (live) setError(true); });
    return () => { live = false; controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [src, remote]);
  if (remote && error) return <span role="img" aria-label="사진을 불러오지 못했습니다">사진 연결을 확인해 주세요</span>;
  return <img {...props} src={remote ? image : src}/>;
}
