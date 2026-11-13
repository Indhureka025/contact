const { getDefaultRunner } = require('../services/batchService');
const websiteService = require('../services/websiteService');

const runner = () => getDefaultRunner();

exports.health = (req, res) => {
  res.json({ ok: true, running: runner().getState().running });
};

exports.status = (req, res) => {
  res.json(runner().getState());
};

// Process every pending row, 10 at a time, until the sheet is finished (runs in the background).
exports.startRun = (req, res) => {
  if (!runner().start({})) return res.status(409).json({ error: 'A run is already in progress' });
  return res.status(202).json({ started: true });
};

// Process exactly one batch of up to BATCH_SIZE rows and wait for it to finish.
exports.runBatch = async (req, res, next) => {
  try {
    res.json(await runner().run({ maxBatches: 1 }));
  } catch (err) {
    if (err.code === 'RUN_ACTIVE') return res.status(409).json({ error: err.message });
    return next(err);
  }
};

exports.stop = (req, res) => {
  res.json({ stopping: runner().stop() });
};

exports.captchaStatus = (req, res) => {
  res.json(websiteService.getCaptchaOperatorStatus());
};

exports.captchaScreenshot = async (req, res, next) => {
  try {
    const screenshot = await websiteService.getCaptchaScreenshot();
    if (!screenshot) return res.sendStatus(204);
    res.set('Cache-Control', 'no-store').type('png').send(screenshot);
  } catch (err) {
    next(err);
  }
};

exports.captchaAction = async (req, res, next) => {
  const action = req.body;
  const status = websiteService.getCaptchaOperatorStatus();
  if (!status.waiting) return res.status(409).json({ error: 'No CAPTCHA is waiting for input' });
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    return res.status(400).json({ error: 'A CAPTCHA operator action is required' });
  }

  const inBounds = (x, y) =>
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < status.viewport.width &&
    y < status.viewport.height;

  if (action.type === 'click' && !inBounds(action.x, action.y)) {
    return res.status(400).json({ error: 'Click coordinates are outside the browser viewport' });
  }
  if (action.type === 'drag' && (!inBounds(action.x1, action.y1) || !inBounds(action.x2, action.y2))) {
    return res.status(400).json({ error: 'Drag coordinates are outside the browser viewport' });
  }
  if (action.type === 'type' && (typeof action.text !== 'string' || action.text.length < 1 || action.text.length > 256)) {
    return res.status(400).json({ error: 'Text must contain between 1 and 256 characters' });
  }
  if (
    action.type === 'press' &&
    !['Enter', 'Tab', 'Space', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape'].includes(action.key)
  ) {
    return res.status(400).json({ error: 'Unsupported keyboard key' });
  }
  if (!['click', 'drag', 'type', 'press'].includes(action.type)) {
    return res.status(400).json({ error: 'Unsupported CAPTCHA operator action' });
  }

  try {
    const sent = await websiteService.sendCaptchaAction(action);
    if (!sent) return res.status(409).json({ error: 'The CAPTCHA page is no longer available' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
