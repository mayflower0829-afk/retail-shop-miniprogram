// Public template has no deployed owner identity; configure ADMIN_OPENIDS in the cloud.
const privateAdminOpenIds = [];

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const validOpenId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

// An explicitly configured environment value always wins, including an empty
// or malformed value. This allows an operator to revoke the deployment fallback.
function resolveAdminOpenIds(env, fallback = privateAdminOpenIds) {
  let values;
  if (env && hasOwn(env, 'ADMIN_OPENIDS')) {
    if (typeof env.ADMIN_OPENIDS !== 'string' || !env.ADMIN_OPENIDS.trim()) return [];
    values = env.ADMIN_OPENIDS.split(',').map(value => value.trim());
  } else {
    if (!Array.isArray(fallback)) return [];
    values = fallback;
  }
  if (!values.every(validOpenId)) return [];
  return [...new Set(values)];
}

function isAdmin(openid, env, fallback = privateAdminOpenIds) {
  return validOpenId(openid) && resolveAdminOpenIds(env, fallback).includes(openid);
}

module.exports = { resolveAdminOpenIds, isAdmin };
