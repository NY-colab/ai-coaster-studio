// Never send raw provider output (which can contain paths or input text) to participants.
export function generationError(result, log = '') {
  const reason = String(result?.error || '');
  const evidence = reason + ' ' + log;
  if (/rate.limit|usage.limit|quota|limit reached/i.test(evidence)) return {code:'RATE_LIMIT',message:'Codex 사용 한도에 도달했습니다. 한도가 회복된 후 다시 시도해 주세요.'};
  if (/unauth|\b401\b|token expired|not logged|login required/i.test(evidence)) return {code:'AUTH_EXPIRED',message:'로그인이 만료되었습니다. 운영자 PC의 연결 설정에서 다시 로그인해 주세요.'};
  if (result?.status==='unavailable' || /unsupported tool|image.{0,30}tool.{0,30}unavailable/i.test(evidence)) return {code:'IMAGE_TOOL_UNAVAILABLE',message:'현재 Codex 계정에서 내장 이미지 생성 도구를 사용할 수 없습니다. 운영자에게 Codex 업데이트와 계정 상태 확인을 요청해 주세요.'};
  if (/no (?:person|people|human|face)|without (?:a )?(?:person|face)|인물.{0,12}없|사람.{0,12}없|얼굴.{0,12}없/i.test(reason)) return {code:'SUBJECT_MISMATCH',message:'그림 생성기가 입력을 인물 사진으로만 해석해 중단했습니다. 운영자 PC를 최신 버전으로 업데이트한 뒤 다시 만들기를 눌러 주세요. 로고·사물 사진도 지원합니다.'};
  if (/safety|content policy|policy violation|안전 정책|콘텐츠 정책/i.test(reason)) return {code:'CONTENT_REJECTED',message:'이미지 생성 서비스가 이 입력을 처리하지 않았습니다. 다른 사진으로 시도해 주세요.'};
  if (/network|connect|timeout|timed.out/i.test(evidence)) return {code:'CONNECTION_FAILED',message:'네트워크 연결로 인해 완료를 확인하지 못했습니다. 자동 재제출하지 않았습니다.'};
  if (/local.{0,15}path|image.{0,15}path|파일 경로/i.test(reason)) return {code:'OUTPUT_MISSING',message:'생성된 이미지 파일을 확인하지 못했습니다. 중복 생성하지 않았으니 운영자에게 결과 확인을 요청해 주세요.'};
  return {code:'GENERATION_FAILED',message:'Codex에서 완성 이미지를 받지 못했습니다. 이전 작품은 보존했으며 자동으로 다시 요청하지 않았습니다. 다시 만들기로 재시도하거나 다른 사진을 선택해 주세요.'};
}
