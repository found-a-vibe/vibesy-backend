const express = require('express');
const { sendEmail } = require('../service/email');
const { generateOTP } = require('../service/otp');
const { verifyEmail } = require('../middleware/email-verifier');
const { logTime } = require('../middleware/logger');

const router = express.Router();

const handler = async (req, res) => {
  const { email } = req.body;
  try {
    const otp = await generateOTP(email);
    const status = await sendEmail(email, otp);
    res.status(status).send(`OTP send to ${email}`);
  } catch(error) {
    res.status(500).send("An error has occured. Please try again.");
  }
}

router.post('/send', logTime, verifyEmail, handler);

module.exports = router;