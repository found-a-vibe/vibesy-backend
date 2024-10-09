'use strict'
const config = require('dotenv').config()

if (config.error) {
  throw config.error;
};

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

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
