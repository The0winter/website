// Keep diagnostic text separate from source prose and credentials.
export function failureDetails(error, context = {}) {
  const message = error.message || error.error || String(error);
  let code = error.code || 'source-error';
  let nextStep = error.nextStep;
  if (!nextStep) {
    if (/验证|验证码/.test(message)) {
      code = error.code || 'verification-required';
      nextStep = '继续采集后，在弹出的采集浏览器中手动完成验证；若验证反复失败，先停止并稍后再试。';
    } else if (/登录/.test(message)) {
      code = error.code || 'login-required';
      nextStep = '继续采集后，在弹出的采集浏览器中手动登录，再返回并刷新当前章节。';
    } else if (/429|Retry-After|限制访问/.test(message)) {
      code = error.code || 'rate-limited';
      nextStep = '先等待网站解除限速再继续；若反复出现，可调大来源配置中的 delayMs 请求间隔。';
    } else if (/超时|timeout|TIMEDOUT|ENOTFOUND|ECONN|下载失败|HTTP 5/i.test(message)) {
      code = error.code || 'network-error';
      nextStep = '检查网络和来源网站能否打开，稍后继续采集；已保存的章节会自动跳过。';
    } else {
      nextStep = '打开失败章节核对来源页面；若重试仍失败，将此处的章节、原因和质量报告交给 Codex 排查。';
    }
  }
  return {...context, error: message, code, nextStep, ...(error.selector ? {selector: error.selector} : {}), ...(error.url ? {url: error.url} : {})};
}

export function rejectedPage(selector, url) {
  return Object.assign(Error(`页面仍有阅读限制或未支持的拦截标记（${selector}），未保存可能不完整的正文。`), {
    code: 'page-restricted', selector, url, stopSource: true,
    nextStep: '先打开失败章节查看网站的具体提示。若要求登录或验证码，请在采集窗口处理；若需要阅读权限，请自行核对账号权限；若正文正常却仍被拦截，将报告交给 Codex 修复来源规则。',
  });
}
