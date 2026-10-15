'use strict';

function explainGcpError(error) {
  const status = Number(error?.status || 0);
  const raw = String(error?.message || '请求失败');
  let message = '查询没有完成。';
  let needsSetup = false;

  if (/TOKEN_EXPIRED|quota project/i.test(raw)) {
    message = '访问令牌已失效。请在设置里重新一键登录。';
    needsSetup = true;
  } else if (/billing/i.test(raw)) {
    message = '这个 GCP 项目还没开通结算。Cloud Translation 和 Vertex AI 都需要已启用结算的项目。';
    needsSetup = true;
  } else if (status === 401 || /unauthenticated|invalid authentication|invalid_grant|invalid_rapt/i.test(raw)) {
    message = '访问令牌已失效。请在设置里重新一键登录。';
    needsSetup = true;
  } else if (/texttospeech\.googleapis\.com/i.test(raw)) {
    message = '项目还没启用 Cloud Text-to-Speech API。';
    needsSetup = true;
  } else if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured|translate\.googleapis\.com|aiplatform\.googleapis\.com/i.test(raw)) {
    message = '项目还没启用 Cloud Translation API 或 Vertex AI API。';
    needsSetup = true;
  } else if (status === 403 || /PERMISSION_DENIED/i.test(raw)) {
    message = '当前账号没有调用这个项目的权限。需要 Cloud Translation 用户和 Vertex AI 用户权限。';
    needsSetup = true;
  } else if (status === 404 || /not found|was not found|Publisher Model/i.test(raw)) {
    message = '没有找到接口或模型。请检查项目 ID、区域（默认 global）和模型名（默认 gemini-3.8-flash）。';
    needsSetup = true;
  } else if (status === 429 || /RESOURCE_EXHAUSTED/i.test(raw)) {
    message = '配额用完或请求太频繁，稍后再试。';
  } else if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(raw)) {
    message = '连不上 Google API。请检查网络是否能访问 translation.googleapis.com 和 aiplatform.googleapis.com。';
  } else if (raw && raw.length < 180) {
    message = raw;
  }

  const detail = raw && raw !== message ? raw.slice(0, 360) : '';
  return { message, detail, needsSetup };
}

module.exports = { explainGcpError };
