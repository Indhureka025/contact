const path = require('path');
const fs = require('fs');
const env = require('../config/env');
const logger = require('../utils/logger');
const { normalizeUrl, isUrlAllowed } = require('../utils/urlPolicy');
const { describeError } = require('../utils/statusHandler');
const { newContext, gotoPage } = require('../browser/browserManager');
const { detectCaptcha, waitForHumanCaptcha } = require('../browser/formDetector');
const { fillForm, submitForm } = require('../browser/formFiller');
const { takeSnapshot, verifySubmission } = require('../browser/submissionVerifier');
const { locateContactForm } = require('./contactPageService');
const { ok, fail, review, completedVerify } = require('./resultService');

const SCREENSHOT_DIR = path.join(env.root, 'screenshots');
let operatorCaptchaPage = null;

function getCaptchaOperatorStatus() {
  const page = operatorCaptchaPage;
  const viewport = page && !page.isClosed() ? page.viewportSize() : null;
  return { waiting: Boolean(viewport), viewport };
}

async function getCaptchaScreenshot() {
  const page = operatorCaptchaPage;
  if (!page || page.isClosed()) return null;
  return page.screenshot({ type: 'png', timeout: 5000 });
}

async function sendCaptchaAction(action) {
  const page = operatorCaptchaPage;
  if (!page || page.isClosed()) return false;

  if (action.type === 'click') {
    await page.mouse.click(action.x, action.y);
  } else if (action.type === 'drag') {
    await page.mouse.move(action.x1, action.y1);
    await page.mouse.down();
    try {
      await page.mouse.move(action.x2, action.y2, { steps: 10 });
    } finally {
      await page.mouse.up();
    }
  } else if (action.type === 'type') {
    await page.keyboard.type(action.text, { delay: 20 });
  } else if (action.type === 'press') {
    await page.keyboard.press(action.key);
  } else {
    throw new Error('Unsupported CAPTCHA operator action');
  }
  return true;
}

async function openSite(page, url) {
  const attempt = async (target) => {
    const status = await gotoPage(page, target);
    if (status && status >= 400) {
      const hint = [403, 429, 503].includes(status) ? ' (site may block automation)' : '';
      return { ok: false, reason: `Homepage returned HTTP ${status}${hint}` };
    }
    return { ok: true };
  };
  try {
    return await attempt(url);
  } catch (err) {
    // https failed for a reason other than DNS: try plain http once
    if (url.startsWith('https://') && !/ERR_NAME_NOT_RESOLVED/.test(String(err.message))) {
      try {
        return await attempt('http://' + url.slice('https://'.length));
      } catch (_) {
        /* report the original error below */
      }
    }
    return { ok: false, reason: describeError(err) };
  }
}

async function runSteps(page, url) {
  try {
    const opened = await openSite(page, url);
    if (!opened.ok) return fail(opened.reason);

    const located = await locateContactForm(page, page.url());
    if (!located.ok) return fail(located.reason);

    const filled = await fillForm(located.form, env.contact);
    if (!filled.ok) return fail(filled.reason);

    if (await detectCaptcha(page)) {
      if (env.captchaMode !== 'pause') return fail('CAPTCHA on the form (cannot be solved automatically)');
      logger.info(`CAPTCHA on ${located.pageUrl}: waiting up to ${Math.round(env.captchaWaitMs / 1000)}s for you to solve it`);
      operatorCaptchaPage = page;
      try {
        const solved = await waitForHumanCaptcha(page, { timeoutMs: env.captchaWaitMs });
        if (!solved) return fail('CAPTCHA not solved within the wait time');
      } finally {
        if (operatorCaptchaPage === page) operatorCaptchaPage = null;
      }
    }
    if (!env.enableSubmission) {
      return review(`Dry run on ${located.pageUrl}: filled ${filled.filled.join(', ')}; submission disabled`);
    }

    const snapshot = await takeSnapshot(page);
    await submitForm(located.form.handle);
    const verdict = await verifySubmission(page, snapshot, { timeoutMs: env.verifyTimeoutMs });
    if (verdict.success) return ok(`Submitted on ${located.pageUrl}. ${verdict.reason}`);
    if (verdict.needsReview) {
      return completedVerify(`No confirmation detected on ${located.pageUrl}; check the site .`);
    }
    return fail(verdict.reason);
  } catch (err) {
    return fail(describeError(err));
  }
}

async function saveFailureScreenshot(page, row, url) {
  if (!env.saveFailureScreenshots) return;
  try {
    const host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_');
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `row${row.rowNumber}-${host}.png`), timeout: 5000 });
  } catch (_) {
    /* screenshots are best-effort */
  }
}

/**
 * Full workflow for one sheet row. Never throws: always resolves to
 * { status: 'Success' | 'Failed' | 'Review required' | 'Completed - verify', reason }.
 */
async function processWebsite(row) {
  const url = normalizeUrl(row.url);
  if (!url) return fail('Invalid URL');
  if (!isUrlAllowed(url, env.allowedDomains)) return fail('Domain not in ALLOWED_DOMAINS');

  let context = null;
  let timer = null;
  try {
    context = await newContext();
    const page = await context.newPage();
    const work = runSteps(page, url);
    const budgetMs = env.siteTimeoutMs + (env.captchaMode === 'pause' ? env.captchaWaitMs : 0);
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(fail(`Timed out after ${Math.round(budgetMs / 1000)}s`)), budgetMs);
    });
    const outcome = await Promise.race([work, timeout]);
    if (outcome.status === 'Failed') await saveFailureScreenshot(page, row, url);
    return outcome;
  } catch (err) {
    logger.warn(`Row ${row.rowNumber} (${row.url}) crashed: ${err.message}`);
    return fail(describeError(err));
  } finally {
    clearTimeout(timer);
    if (context) await context.close().catch(() => {}); // also aborts work that lost the timeout race
  }
}

module.exports = {
  processWebsite,
  getCaptchaOperatorStatus,
  getCaptchaScreenshot,
  sendCaptchaAction,
};
