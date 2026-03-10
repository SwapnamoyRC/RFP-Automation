const logger = require('../config/logger');

async function retry(fn, { maxRetries = 3, delayMs = 1000, backoff = 2 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const wait = delayMs * Math.pow(backoff, attempt - 1);
        logger.warn(`Attempt ${attempt}/${maxRetries} failed, retrying in ${wait}ms...`, {
          error: err.message
        });
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastError;
}

module.exports = { retry };
