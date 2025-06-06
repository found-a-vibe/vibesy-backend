const { v4 } = require("uuid");
const admin = require("../service/admin");
const axios = require("axios");
const sharp = require("sharp");

// Initialize Firestore
const db = admin.firestore();
// Initialize Firebase Storage
const bucket = admin.storage().bucket();

async function uploadImageFromUrl(imageUrl, eventId) {
  try {
    if (!imageUrl) {
      return null;
    }

    const filename = `event_images/${eventId}/image_${v4()}.jpg`;
    console.log(`Downloading image from: ${imageUrl}`);

    // Fetch image as buffer
    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });

    // Sharpen the image using sharp
    const sharpenedBuffer = await sharp(response.data)
      .sharpen() // You can tweak with .sharpen(1, 1, 1) for finer control
      .jpeg() // Ensure format is correct
      .toBuffer();

    // Upload sharpened image buffer to Firebase Storage
    const file = bucket.file(filename);
    await file.save(sharpenedBuffer, {
      metadata: { contentType: "image/jpeg" },
    });

    const storageUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
    console.log(`Image uploaded to Firebase Storage: ${storageUrl}`);

    return storageUrl;
  } catch (error) {
    console.error("Error uploading image:", error);
    return null;
  }
}

export async function fetchGoogleEvents() {
  const url = `https://serpapi.com/search.json?engine=google_events&q=Events%2Bin%2BAtlanta&hl=en&gl=us&htichips=date%3Amonth&api_key=${process.env.SERPAPI_KEY}`;

  try {
    const response = await axios.get(url);
    if (response.data && response.data.events_results) {
      console.log(`Fetched ${response.data.events_results.length} events`);
      return response.data.events_results;
    } else {
      console.warn("No events found in the response");
      return [];
    }
  } catch (error) {
    console.error("Error fetching events from SerpAPI:", error);
    return [];
  }
}

export async function saveEventsBatch(googleEvents = []) {
  if (!googleEvents.length) {
    return console.warn("⚠️ No events to save.");
  }

  try {
    const batch = db.batch();

    for (const googleEvent of googleEvents) {
      const eventId = v4();

      // Use event.image or fallback to event.thumbnail
      const imageUrl = googleEvent.image || googleEvent.thumbnail;
      let bucketImageUrl = "";

      if (imageUrl) {
        console.log(`Uploading image for event: ${googleEvent.title}`);
        bucketImageUrl = await uploadImageFromUrl(imageUrl, eventId);
      }

      // Construct Firestore event object
      const event = {
        id: eventId,
        title: googleEvent.title,
        description: googleEvent.description || "",
        date: googleEvent.date?.start_date || "",
        timeRange: googleEvent.date?.when || "",
        location: googleEvent.address?.join(", ") || "",
        images: bucketImageUrl ? [bucketImageUrl] : [],
        hashtags: [],
        guests: [],
        priceDetails: {
          title: "",
          amount: "",
          link: googleEvent.ticket_info?.[0]?.link || "",
        },
        likes: [],
        interactions: [],
        createdBy: "",
        source: googleEvent.link || "", // Optional: track source link
      };

      const eventRef = db.collection("events").doc(event.id);
      batch.set(eventRef, event, { merge: true });
    }

    await batch.commit();
    console.log(`${googleEvents.length} events saved to Firestore.`);
  } catch (error) {
    console.error("Error saving events batch:", error);
  }
}