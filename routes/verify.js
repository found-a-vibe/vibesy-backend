const express = require('express');
const { verifyOTP } = require('../service/otp');
const { verifyEmail } = require('../middleware/email-verifier');
const { logTime } = require('../middleware/logger');

const router = express.Router();

const handler = async (req, res) => {
  const { email, otp } = req.body;
  try {
    const isValidOTP = await verifyOTP(email, otp);
    if (isValidOTP) {
      res.status(200).send(`OTP verified successfully for ${email}`);
    } else {
      res.status(400).send(`OTP is not valid for ${email}`)
    }
  } catch(error) {
    res.status(500).send("An error has occured. Please try again.");
  }
}

router.post('/verify', logTime, verifyEmail, handler);

module.exports = router;