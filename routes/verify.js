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
      res.status(200).json({status: "OK", description: `One-time passcode successfully verified for ${email}`});
    } else {
      res.status(400).json({status: "Bad Request", description: `One-time passcode is not valid or has expired for ${email}`});
    }
  } catch(error) {
    res.status(500).json({status: "System Error", decription: "An error has occured. Please try again."});
  }
}

router.post('/verify', logTime, verifyEmail, handler);

module.exports = router;