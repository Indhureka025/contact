const express = require('express');
const controller = require('../controllers/automationController');

const router = express.Router();

function requireLocalOperator(req, res, next) {
  const address = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) {
    return res.status(403).json({ error: 'The CAPTCHA operator console is available only on this computer' });
  }
  next();
}

router.get('/health', controller.health);
router.get('/status', controller.status);
router.post('/runs', controller.startRun); // run until all websites are done
router.post('/runs/stop', controller.stop); // stop after the current batch
router.post('/batches', controller.runBatch); // one batch only
router.get('/operator/captcha', requireLocalOperator, controller.captchaStatus);
router.get('/operator/screenshot', requireLocalOperator, controller.captchaScreenshot);
router.post('/operator/action', requireLocalOperator, controller.captchaAction);

module.exports = router;
