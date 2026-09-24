// src/utils/escapeRegex.js
/**
 * Escape user supplied text before it is used to build a RegExp.
 *
 * Every search endpoint in this codebase interpolates user input into `$regex`;
 * without escaping, a query like "(a+)+$" becomes a catastrophic-backtracking
 * pattern (ReDoS) and characters such as "." or "*" silently match far more
 * documents than the user asked for.
 */
export const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a safe, case-insensitive "contains" RegExp from user input.
 * Returns null when there is nothing to search for.
 */
export const containsRegex = (value, flags = 'i') => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  return new RegExp(escapeRegex(trimmed), flags);
};

export default escapeRegex;
