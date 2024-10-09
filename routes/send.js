const express = require('express');
const admin = require('../service/admin');
const { sendEmail } = require('../service/sendgrid');
const { generateOTP } = require('../service/otp');

const router = express.Router();

const timeLog = (req, res, next) => {
  console.log('Time: ', Date.now());
  next();
};

const verifyEmailExists = async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    return res.sendStatus(400).send("Invalid request body. Email is required.");
  }
  try {
    let userRecord = await admin.auth().getUserByEmail(email);
    console.log(`Successfully fetched user with uid: ${userRecord.uid}`);
  } catch(error) {
    console.log('Error fetching user data:', error);
    if (error.code === "auth/user-not-found") {
      return res.status(400).send("Email not registered in Firebase.");
    }
    return res.status(500).send("Error verifying email.");
  }
  next();
}

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

router.post('/send', timeLog, verifyEmailExists, handler);

module.exports = router;