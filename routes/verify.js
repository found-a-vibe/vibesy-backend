const express = require('express');
const router = express.Router()

const timeLog = (req, res, next) => {
  console.log('Time: ', Date.now());
  next();
};

router.post('/verify', timeLog, (req, res) => {
  res.send('Verifying OTP...');
});

module.exports = router;