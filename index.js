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
const sendRouter = require('./routes/send');
const verifyRouter = require('./routes/verify');

app.use(bodyParser.json());

app.use('/otp', sendRouter);
app.use('/otp', verifyRouter);

app.listen(process.env.SERVER_PORT || port, () => {
  console.log(`Listening on port ${port}`);
});
