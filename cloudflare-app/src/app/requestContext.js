/**
 * @typedef {Object} RequestContext
 * @property {Request} request
 * @property {URL} url
 * @property {string} path
 * @property {string} method
 * @property {Object} env
 * @property {Object} db
 * @property {Object} config
 * @property {Object|null} session
 * @property {Object|null} actor
 * @property {string} requestId
 * @property {Object} logger
 */

/** @returns {Readonly<RequestContext>} */
export function createRequestContext({ request, env, db, config, session = null, actor = null, requestId, logger }) {
  const url = new URL(request.url);
  return Object.freeze({ request, url, path: url.pathname, method: request.method, env, db, config, session, actor, requestId, logger });
}
