const express = require('express');
const { logTime } = require('../middleware/logger');
const admin = require('../service/admin')
const { getMessaging } = require('firebase-admin/messaging');

const router = express.Router();

const handler = async (req, res) => {
    const { title, body, toUserId } = req.body;

    try {
        // Fetch the recipient's FCM token from Firestore
        const receiver = await admin.firestore().collection("users").doc(toUserId).collection("tokens").doc("fcm").get();
        const fcmToken = receiver.data().fcmToken;

        const sender = await admin.firestore().collection("users").doc(toUserId).collection("profile").doc("metadata").get();
        const username = sender.data().fullName

        if (!fcmToken) {
            return res.status(400).send("Recipient has no FCM token");
        }

        await getMessaging().send({
            notification: {
            title: title,
            body: body + ` from ${username}`,
            },
            token: fcmToken,
        });
        res.status(200).send("Notification sent successfully");
    } catch (error) {
        res.status(500).send("Error sending notification: " + error.message);
    }
}

router.post('/send', handler, logTime);

module.exports = router;