'use strict';

// AI Studio authorization keys and Express keys cannot be distinguished by prefix.
function provider(value = 'gemini') {
  if (!['gemini', 'vertex-express'].includes(value)) {
    throw Object.assign(new Error('BAD_GEMINI_PROVIDER'), { code: 'BAD_GEMINI_PROVIDER' });
  }
  return value;
}
function modelId(value) {
  const model = String(value || '').trim().replace(/^models\//, '');
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('BAD_GEMINI_MODEL');
  return model;
}
function endpoint(model, source) {
  const base = provider(source) === 'vertex-express'
    ? 'https://aiplatform.googleapis.com/v1beta1/publishers/google/models/'
    : 'https://generativelanguage.googleapis.com/v1beta/models/';
  return `${base}${modelId(model)}:generateContent`;
}
module.exports = { provider, modelId, endpoint };
