const express = require('express');
const admin = require('../service/admin')
const { logTime } = require('../middleware/logger');

const router = express.Router();

const handler = async (req, res) => {
    const { uid, password } = req.body;
    try {
        if (uid && password) {
            const userRecord = await admin.auth().updateUser(uid, { password })
            if (userRecord) {
                res.status(200).json({ status: "OK", description: "User's password has been successfully updated"})
            }
        } else {
            res.status(400).json({ status: "Bad Request", description: "User Id or Password is missing in the request"})
        }
    } catch(error) {
        console.log(error)

        const { code, message } = error.errorInfo
        if (code && message) {
            res.status(400).json({status: code, description: message});
        } else {
            res.status(500).json({status: "System Error", description: "An unknown error has occured"});
        }
    }
}

router.post('/reset', logTime, handler);

module.exports = router;