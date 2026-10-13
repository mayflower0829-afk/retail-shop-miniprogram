const ENV_VERSIONS = ['develop', 'trial', 'release'];
let state = { status: 'uninitialized', envVersion: 'unknown', mode: null, error: null };
let initializedConfig = null;
let initialization = null;
let attempt = 0;

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  error.runtimeFailure = true;
  return error;
}

function detectEnvironment(platform) {
  if (!platform || typeof platform.getAccountInfoSync !== 'function') {
    return { envVersion: 'unknown', reason: 'unavailable' };
  }
  try {
    const account = platform.getAccountInfoSync();
    const value = account && account.miniProgram && account.miniProgram.envVersion;
    return ENV_VERSIONS.includes(value)
      ? { envVersion: value, reason: null }
      : { envVersion: 'unknown', reason: 'unrecognized' };
  } catch (_) {
    return { envVersion: 'unknown', reason: 'failed' };
  }
}

function validCloudEnv(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/.test(value)) return false;
  return !/^(?:your[-_]?env(?:[-_]?id)?|env[-_]?id|cloud[-_]?env|please[-_]?replace|placeholder)$/i.test(value);
}

function validateConfig(config, envVersion) {
  if (!config || !['demo', 'cloud'].includes(config.mode)) {
    throw failure('INVALID_MODE', '小程序运行模式配置无效，请联系店主。');
  }
  const develop = envVersion === 'develop';
  if ((!develop || config.mode === 'cloud') && config.demoAdminEnabled !== false) {
    throw failure('DEMO_ADMIN_FORBIDDEN', '体验版和正式版必须关闭演示店铺管理。');
  }
  if (config.mode === 'demo' && !develop) {
    throw failure('DEMO_FORBIDDEN', '当前版本禁止演示付款，请联系店主更新正式版本。');
  }
  if (config.mode === 'cloud' && !validCloudEnv(config.cloudEnv)) {
    throw failure('INVALID_CLOUD_ENV', '云端服务环境配置无效，请联系店主。');
  }
}

function configIdentity(config) {
  return JSON.stringify([config.mode, config.demoAdminEnabled, config.cloudEnv]);
}

function getState() {
  return { ...state, error: state.error ? { ...state.error } : null };
}

async function initializeOnce(config, platform) {
  const currentAttempt = ++attempt;
  const environment = detectEnvironment(platform);
  initializedConfig = null;
  state = { status: 'initializing', envVersion: environment.envVersion, mode: config && config.mode, error: null };
  try {
    validateConfig(config, environment.envVersion);
    const identity = configIdentity(config);
    if (config.mode === 'cloud') {
      if (!platform || !platform.cloud || typeof platform.cloud.init !== 'function' || typeof platform.cloud.callFunction !== 'function') {
        throw failure('CLOUD_UNAVAILABLE', '当前微信无法连接云端服务，请更新微信后重试。');
      }
      await platform.cloud.init({ env: config.cloudEnv, traceUser: false });
    }
    if (currentAttempt !== attempt) throw failure('INITIALIZATION_SUPERSEDED', '服务正在重新初始化，请稍后重试。');
    if (identity !== configIdentity(config)) throw failure('CONFIG_CHANGED', '服务配置已改变，请重新启动小程序。');
    initializedConfig = identity;
    state = { ...state, status: 'ready', error: null };
    return getState();
  } catch (original) {
    const error = original && original.runtimeFailure === true
      ? original
      : failure('CLOUD_INIT_FAILED', '云端服务初始化失败，请重新进入小程序；仍有问题请联系店主。');
    if (currentAttempt === attempt) {
      state = { ...state, status: 'failed', error: { code: error.code, message: error.message } };
    }
    throw error;
  }
}

function initialize(config, platform) {
  initialization = initializeOnce(config, platform);
  return initialization;
}

async function ready(config) {
  if (initialization) await initialization;
  return assertReady(config);
}

function assertReady(config) {
  if (state.status !== 'ready') {
    const error = state.error || { code: 'RUNTIME_NOT_READY', message: '服务尚未准备好，请稍后重试。' };
    throw failure(error.code, error.message);
  }
  if (config) {
    validateConfig(config, state.envVersion);
    if (configIdentity(config) !== initializedConfig) {
      throw failure('CONFIG_CHANGED', '服务配置已改变，请重新启动小程序。');
    }
  }
  return getState();
}

module.exports = { initialize, ready, assertReady, getState, detectEnvironment, validCloudEnv, validateConfig };
