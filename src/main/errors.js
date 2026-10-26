'use strict';

const { tr } = require('../renderer/i18n');

function explainGcpError(error) {
  const status = Number(error?.status || 0);
  const raw = String(error?.message || tr('errRequest'));
  let message = tr('errQuery');
  let needsSetup = false;

  if (/TOKEN_EXPIRED|quota project/i.test(raw)) {
    message = tr('errToken');
    needsSetup = true;
  } else if (/billing/i.test(raw)) {
    message = tr('errBilling');
    needsSetup = true;
  } else if (/API key not valid|API_KEY_INVALID|API_KEY_SERVICE_BLOCKED/i.test(raw)) {
    message = tr('errBadKey');
    needsSetup = true;
  } else if (/generativelanguage\.googleapis\.com/i.test(raw)) {
    message = tr('errGeminiDisabled');
    needsSetup = true;
  } else if (status === 401 || /unauthenticated|invalid authentication|invalid_grant|invalid_rapt/i.test(raw)) {
    message = tr('errToken');
    needsSetup = true;
  } else if (/texttospeech\.googleapis\.com/i.test(raw)) {
    message = tr('errTtsDisabled');
    needsSetup = true;
  } else if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured|translate\.googleapis\.com|aiplatform\.googleapis\.com/i.test(raw)) {
    message = tr('errApiDisabled');
    needsSetup = true;
  } else if (status === 403 || /PERMISSION_DENIED/i.test(raw)) {
    message = tr('errPermission');
    needsSetup = true;
  } else if (status === 404 || /not found|was not found|Publisher Model/i.test(raw)) {
    message = tr('errNotFound');
    needsSetup = true;
  } else if (status === 429 || /RESOURCE_EXHAUSTED/i.test(raw)) {
    message = tr('errQuota');
  } else if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(raw)) {
    message = tr('errNetwork');
  } else if (raw && raw.length < 180) {
    message = raw;
  }

  const detail = raw && raw !== message ? raw.slice(0, 360) : '';
  return { message, detail, needsSetup };
}

module.exports = { explainGcpError };
