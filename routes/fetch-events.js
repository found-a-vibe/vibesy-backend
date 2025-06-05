const express = require("express");
const { v4 } = require("uuid");
const { logTime } = require("../middleware/logger");
const admin = require("../service/admin");
const axios = require("axios");

// Initialize Firestore
const db = admin.firestore();
// Initialize Firebase Storage
const bucket = admin.storage().bucket();

const router = express.Router();

/**
 * Downloads an image from a URL and uploads it to Firebase Storage.
 * @param {string} imageUrl - The URL of the image.
 * @param {string} eventId - The ID of the event.
 * @returns {Promise<string | null>} - The Firebase Storage URL or null if upload fails.
 */
async function uploadImageFromUrl(imageUrl, eventId) {
    try {
        if (!imageUrl) {
          return null;
        }

        // Generate a unique filename for the event
        const filename = `event_images/${eventId}/image_${v4()}.jpg`;
        console.log(`⬇️ Downloading image from: ${imageUrl}`);

        // Fetch image as a buffer
        const response = await axios.get(imageUrl, { responseType: "arraybuffer" });

        // Upload image buffer to Firebase Storage
        const file = bucket.file(filename);
        await file.save(response.data, {
            metadata: { contentType: "image/jpeg" },
        });

        // **Return Firebase Storage URL instead of signed URL**
        const storageUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
        console.log(`✅ Image uploaded to Firebase Storage: ${storageUrl}`);

        return storageUrl;
    } catch (error) {
        console.error("🔥 Error uploading image:", error);
        return null;
    }
}

/**
 * Saves a batch of events to Firestore.
 * @param {Array} events - List of event objects.
 */
async function saveEventsBatch() {
    try {
        const batch = db.batch();
        for (const googleEvent of googleEvents) {
            const eventId = v4(); // Generate unique ID for event

            // Upload image & wait for the result
            let bucketImageUrl = "";
            if (googleEvent.image) {
                console.log(`Uploading image for event: ${googleEvent.title}`);
                bucketImageUrl = await uploadImageFromUrl(googleEvent.image, eventId);
            }
            console.log(googleEvent.ticket_info[0].link)
            // Ensure Firestore gets a plain JavaScript object
            const event = {
                id: eventId,
                title: googleEvent.title,
                description: googleEvent.description || "",
                date: googleEvent.date?.start_date || "",
                timeRange: googleEvent.date?.when || "",
                location: googleEvent.address[0] + ", " + googleEvent.address[1] || "",
                images: bucketImageUrl ? [bucketImageUrl] : [], // Store as an array of URLs
                hashtags: [],
                guests: [],
                priceDetails: {title: "", amount: "", link: googleEvent.ticket_info[0].link },
                likes: [],
                interactions: [],
                createdBy: "",
            };

            const eventRef = db.collection("events").doc(event.id);
            batch.set(eventRef, event, { merge: true });
        }

        await batch.commit();
        console.log(`✅ ${googleEvents.length} events saved successfully.`);
    } catch (error) {
        console.error("🔥 Error saving batch events:", error);
    }
}

const handler = async (req, res) => {
    await saveEventsBatch();
    res.status(200).json({ status: 200, message: "Events Saved to Firebase" });
};

router.get("/getLocalEvents", logTime, handler);

module.exports = router;