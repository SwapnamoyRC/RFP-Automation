const { OpenAI } = require('openai');

let _openai = null;

function getOpenAI() {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS) || 1536;

module.exports = {
  get openai() { return getOpenAI(); },
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS
};
