'use strict';

// Simplified characters that are not standard Japanese joyo forms.
const SIMPLIFIED_ONLY = new Set(
  '爱门问时动电车东马鱼鸟云书买卖开关还对过发网这们说话习个么吗后广产业头见页风飞饭馆园远选进边达运适义议让认记讲论设许译词试诗语误调谁谈谢贝负贡财责贤败货质贵费资赞赵轨转轮软轻载较辅辆辞辩农辽迁迟逊递邓邮邻郑酱铜铁钟钢钥钱听觉兰阳阴队阶际随隐难鸡离龙龟齐齿龄经济汉'.split('')
);

// Japanese shinjitai / kyūjitai that are not the simplified Chinese glyph.
const JAPANESE_FORM = new Set(
  '愛門問時動電車東馬魚鳥雲書買売賣開關關還対對過発發網這們説說話習個麼嗎後広廣産產業頭見頁風飛飯館園遠選進辺邊達運適義議譲讓認記講論設許訳譯詞試詩語誤調誰談謝貝負貢財責賢敗貨質貴費資賛贊趙軌転轉輪軟軽輕載較輔輛辭辯農遼遷遅遲遜逓遞鄧郵隣鄰鄭醤醬銅鉄鐵鐘鋼鑰銭錢聴聽覚覺蘭陽陰隊階際隨随隠隱難鶏雞離竜龍亀龜斉齊歯齒齢齡経經済濟漢強読駅県働円気実様児乗焼総続単団庁伝稲闘徳悩脳抜並変豊毎満黙頼覧両緑録亜圧囲栄営塩価絵拡観厳広黒収獣処浄図酔専増蔵帯沢弾仏払歩麺'.split('')
);

function codePoints(text) {
  return [...String(text || '')];
}

function scriptLanguage(text) {
  const value = String(text || '');
  const kana = (value.match(/[\u3040-\u30ff\uff66-\uff9d]/g) || []).length;
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  if (kana > 0 && latin === 0) return 'ja';
  if (latin > 0 && kana === 0 && !/\p{Script=Han}/u.test(value)) return 'en';
  return null;
}

function hanOnly(text) {
  const core = String(text || '').replace(/\s+/g, '');
  return core.length > 0 && /^[\p{Script=Han}]+$/u.test(core);
}

function hasSimplifiedChinese(text) {
  return codePoints(text).some((char) => SIMPLIFIED_ONLY.has(char));
}

function hanBias(text) {
  let simplified = 0;
  let japanese = 0;
  for (const char of codePoints(text)) {
    if (SIMPLIFIED_ONLY.has(char)) simplified += 1;
    if (JAPANESE_FORM.has(char)) japanese += 1;
  }
  if (japanese > 0 && simplified === 0) return 'ja';
  if (simplified > 0 && japanese === 0) return 'zh';
  if (japanese > simplified) return 'ja';
  if (simplified > japanese) return 'zh';
  return null;
}

function pinnedLanguage(code) {
  const value = String(code || '').toLowerCase();
  if (value === 'zh' || value === 'ja' || value === 'en') return value;
  return '';
}

const PAIRS = ['en-zh', 'en-ja', 'ja-zh', 'ja-en', 'zh-en', 'zh-ja'];

function normalizePair(value, legacy) {
  const text = String(value || '');
  if (PAIRS.includes(text)) return text;
  const pin = pinnedLanguage(legacy?.sourcePin);
  const outbound = legacy?.zhTarget === 'ja' ? 'ja' : 'en';
  if (pin === 'zh') return `zh-${outbound}`;
  if (pin === 'ja') return 'ja-zh';
  if (pin === 'en') return 'en-zh';
  return 'en-zh';
}

function normalizeLang(code) {
  const value = String(code || '').toLowerCase();
  if (!value || value === 'und') return 'und';
  if (value.startsWith('zh')) return 'zh';
  if (value.startsWith('ja')) return 'ja';
  if (value.startsWith('en')) return 'en';
  return value.split('-')[0];
}

function languageLabel(code) {
  const labels = {
    en: '英语',
    ja: '日语',
    zh: '中文',
    mix: '混合',
    und: '未识别',
    ko: '韩语',
    fr: '法语',
    de: '德语',
    es: '西班牙语',
    pt: '葡萄牙语',
    ru: '俄语',
    it: '意大利语',
  };
  return labels[code] || code || '未识别';
}

function fallbackLanguage(text) {
  const value = String(text || '').trim();
  const hinted = scriptLanguage(value);
  if (hinted) return hinted;
  if (/[A-Za-z]/.test(value) && /\p{Script=Han}/u.test(value)) return 'mix';
  if (/[你我他她]/.test(value)) return 'zh';
  const bias = hanBias(value);
  if (bias) return bias;
  if (hanOnly(value)) return 'zh';
  if (/[A-Za-z]/.test(value)) return 'en';
  return 'und';
}

function resolveLanguage(text, detected) {
  const value = String(text || '').trim();
  const hinted = scriptLanguage(value);
  if (hinted) return hinted;
  if (/[A-Za-z]/.test(value) && /\p{Script=Han}/u.test(value)) return 'mix';
  if (/[你我他她]/.test(value)) return 'zh';
  const bias = hanBias(value);
  if (bias) return bias;
  const code = normalizeLang(detected);
  if (hanOnly(value)) return 'zh';
  if (code === 'ja') return 'ja';
  return code;
}

function classify(text, lang) {
  const value = String(text || '').trim();
  if (!value) return 'word';
  const sentencePunct = /[.!?。！？]/.test(value);

  if (lang === 'ja') {
    if (sentencePunct) return 'sentence';
    if (/(です|ます|でした|ました|だ|だった|ない|なかった|ている|てる|ください|でしょう|だろう)$/.test(value) && codePoints(value).length >= 6) {
      return 'sentence';
    }
    if (codePoints(value).length >= 18) return 'sentence';
    if (codePoints(value).length >= 8 && /[はがを]/.test(value)) return 'sentence';
    return 'word';
  }

  if (lang === 'zh') {
    if (sentencePunct || /[；;]/.test(value)) return 'sentence';
    if (/(吗|呢|吧|啊|呀)$/.test(value)) return 'sentence';
    const length = codePoints(value).length;
    if (length >= 12) return 'sentence';
    if (length >= 5 && /[的了是在把被就都也很还又才不没]/.test(value)) return 'sentence';
    if (length >= 4 && /(今天|明天|昨天|现在|已经|正在|因为|所以|如果|虽然|但是|可以|应该|觉得|知道|什么|怎么|为什么|我们|你们|他们)/.test(value)) {
      return 'sentence';
    }
    if (/^(我|你|他|她|它)/.test(value) && length >= 3) return 'sentence';
    return 'word';
  }

  if (lang === 'en') {
    const words = value.split(/\s+/).filter(Boolean);
    if (sentencePunct && words.length >= 2) return 'sentence';
    if (words.length >= 7) return 'sentence';
    if (words.length >= 2 && /^(i|you|he|she|we|they)\b/i.test(value)) return 'sentence';
    if (words.length >= 3 && /^(it|this|that|there|what|when|where|why|how|please)\b/i.test(value)) {
      return 'sentence';
    }
    if (words.length >= 5 && /\b(is|are|was|were|am|be|been|have|has|had|do|does|did|will|would|can|could|should|because|although|if|when)\b/i.test(value)) {
      return 'sentence';
    }
    return 'word';
  }

  if (sentencePunct) return 'sentence';
  if (value.split(/\s+/).filter(Boolean).length >= 6 || codePoints(value).length >= 24) return 'sentence';
  return 'word';
}

module.exports = {
  scriptLanguage,
  resolveLanguage,
  fallbackLanguage,
  pinnedLanguage,
  PAIRS,
  normalizePair,
  normalizeLang,
  languageLabel,
  classify,
  hanOnly,
};
