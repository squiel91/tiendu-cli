const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @template T
 * @param {(attempt: number) => Promise<T>} operation
 * @param {{
 *   attempts?: number,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number,
 *   shouldRetry?: (result: T, attempt: number) => boolean,
 *   shouldRetryError?: (error: unknown, attempt: number) => boolean,
 *   onRetry?: (result: T, nextAttempt: number, delayMs: number) => void | Promise<void>,
 *   onRetryError?: (error: unknown, nextAttempt: number, delayMs: number) => void | Promise<void>,
 * }} [options]
 * @returns {Promise<T>}
 */
export const retryAsync = async (operation, options = {}) => {
  const {
    attempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 2000,
    shouldRetry = () => false,
    shouldRetryError = () => true,
    onRetry,
    onRetryError,
  } = options;

  let lastResult;
  let lastError;

  const getDelayMs = (attempt) =>
    Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) +
    Math.floor(Math.random() * 100);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation(attempt);
      lastResult = result;

      if (!shouldRetry(result, attempt) || attempt === attempts) {
        return result;
      }

      const delayMs = getDelayMs(attempt);

      if (onRetry) {
        await onRetry(result, attempt + 1, delayMs);
      }

      await sleep(delayMs);
    } catch (error) {
      lastError = error;

      if (!shouldRetryError(error, attempt) || attempt === attempts) {
        throw error;
      }

      const delayMs = getDelayMs(attempt);
      if (onRetryError) {
        await onRetryError(error, attempt + 1, delayMs);
      }

      await sleep(delayMs);
    }
  }

  if (lastError) throw lastError;
  return lastResult;
};
