const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @template T
 * @param {(attempt: number) => Promise<T>} operation
 * @param {{
 *   attempts?: number,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number,
 *   shouldRetry?: (result: T, attempt: number) => boolean,
 *   onRetry?: (result: T, nextAttempt: number, delayMs: number) => void | Promise<void>,
 * }} [options]
 * @returns {Promise<T>}
 */
export const retryAsync = async (operation, options = {}) => {
  const {
    attempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 2000,
    shouldRetry = () => false,
    onRetry,
  } = options;

  let lastResult;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await operation(attempt);
    lastResult = result;

    if (!shouldRetry(result, attempt) || attempt === attempts) {
      return result;
    }

    const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) +
      Math.floor(Math.random() * 100);

    if (onRetry) {
      await onRetry(result, attempt + 1, delayMs);
    }

    await sleep(delayMs);
  }

  return lastResult;
};
