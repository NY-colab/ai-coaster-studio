import {VERSION} from './common.mjs';
export const REPOSITORY='NY-colab/ai-coaster-studio';
export async function latestRelease(){
  const response=await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`,{headers:{Accept:'application/vnd.github+json','User-Agent':'AI-Coaster-Studio/'+VERSION},signal:AbortSignal.timeout(10000)});
  if(response.status===404)return {current:VERSION,available:false,url:`https://github.com/${REPOSITORY}/releases`,message:'아직 공개된 새 버전이 없습니다.'};
  if(!response.ok)throw Object.assign(new Error('GitHub 버전 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'),{statusCode:502});
  const release=await response.json(),latest=String(release.tag_name).replace(/^v/,'');
  const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;};
  return {current:VERSION,latest,available:/^\d+\.\d+\.\d+$/.test(latest)&&compare(latest,VERSION),url:release.html_url,message:latest===VERSION?'최신 버전입니다.':'GitHub 릴리스에서 변경 사항을 확인하세요.'};
}
