const crypto = require("crypto");

const DEFAULT_UPLOAD_FOLDER = "day1/products";

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

function normalizeFolder(rawFolder) {
  const folder = String(rawFolder || DEFAULT_UPLOAD_FOLDER).trim();
  const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, "");
  if (!safeFolder || safeFolder.includes("..")) {
    return DEFAULT_UPLOAD_FOLDER;
  }
  return safeFolder;
}

async function verifyFirebaseToken(idToken, firebaseApiKey) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idToken }),
    },
  );

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const user = payload?.users?.[0];
  if (!user?.localId) {
    return null;
  }
  return user.localId;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY;
  const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET;
  const firebaseApiKey = process.env.FIREBASE_WEB_API_KEY;
  const allowedAdminUids = String(process.env.ALLOWED_ADMIN_UIDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!cloudName || !cloudinaryApiKey || !cloudinaryApiSecret || !firebaseApiKey) {
    return jsonResponse(500, {
      error:
        "Missing required server configuration. Add Cloudinary and Firebase env vars in Netlify.",
    });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (error) {
    return jsonResponse(400, { error: "Invalid JSON payload" });
  }

  const idToken = String(body.idToken || "");
  if (!idToken) {
    return jsonResponse(401, { error: "Authentication token is required" });
  }

  const uid = await verifyFirebaseToken(idToken, firebaseApiKey);
  if (!uid) {
    return jsonResponse(401, { error: "Invalid or expired authentication token" });
  }

  if (allowedAdminUids.length > 0 && !allowedAdminUids.includes(uid)) {
    return jsonResponse(403, { error: "You are not allowed to upload files" });
  }

  const folder = normalizeFolder(body.folder);
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureBase = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash("sha1")
    .update(`${signatureBase}${cloudinaryApiSecret}`)
    .digest("hex");

  return jsonResponse(200, {
    cloudName,
    apiKey: cloudinaryApiKey,
    folder,
    timestamp,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
  });
};
