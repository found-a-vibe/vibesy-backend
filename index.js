'use strict'
if (process.env.NODE_ENV !== 'production') {
  const config = require('dotenv').config()
  if (config.error) {
    throw config.error;
  };
}

const express = require('express');

const app = express();
const port = 3000;

// middlewares
const bodyParser = require('body-parser')

// routes
const sendRouter = require('./routes/send-otp');
const verifyRouter = require('./routes/verify-otp');
const resetPasswordRouter = require('./routes/reset-password');
const sendNotificationRouter = require('./routes/send-notification');
const eventsRouter = require('./routes/fetch-events');

const actualPort = process.env.SERVER_PORT || port;

app.use(bodyParser.json());

app.use('/otp', sendRouter);
app.use('/otp', verifyRouter);

app.use('/password', resetPasswordRouter);

app.use('/notifications', sendNotificationRouter);

app.use('/events', eventsRouter);

app.listen(actualPort, '0.0.0.0', () => {
  console.log(`Listening on port ${actualPort}`);
});
