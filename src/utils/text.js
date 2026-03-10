function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function truncate(text, maxLength = 32000) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength);
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\r\n]+/g, '\n')
    .trim();
}

module.exports = { slugify, truncate, cleanText };
