function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function rubyHtml(value) {
  const source = String(value || '');
  const pattern = /([\u4e00-\u9fff々]+)[（(]([ぁ-んァ-ンー]+)[）)]/g;
  let html = '';
  let last = 0;
  let found = false;
  for (const match of source.matchAll(pattern)) {
    found = true;
    html += escapeHtml(source.slice(last, match.index));
    html += `<ruby>${escapeHtml(match[1])}<rt>${escapeHtml(match[2])}</rt></ruby>`;
    last = match.index + match[0].length;
  }
  if (!found) return '';
  html += escapeHtml(source.slice(last));
  return html;
}

function spokenText(text) {
  return String(text || '')
    .replace(/([\u4e00-\u9fff々]+)[（(][ぁ-んァ-ンー]+[）)]/g, '$1')
    .trim();
}

function annotationParts(text, reading, lang) {
  const ruby = lang === 'ja' ? rubyHtml(reading) : '';
  if (ruby) return { html: ruby, phonetic: '' };
  const phonetic = String(reading || '').trim();
  return {
    html: escapeHtml(text),
    phonetic: phonetic ? escapeHtml(phonetic) : '',
  };
}
