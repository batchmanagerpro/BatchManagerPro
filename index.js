const express = require('express');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Serve the static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// --- Google Sheets Auth ---
async function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// --- 1. Endpoint to get all centers for the dropdown ---
app.get('/api/centers', async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.MASTER_SHEET_ID,
      range: 'Centers!A2:F', // Read columns A to F
    });

    const rows = response.data.values || [];
    
    // Map the rows to safe objects
    const centers = rows.map(row => ({
      center_id: row[0],
      center_name: row[1],
      // We do NOT send the password (row[2]) to the frontend!
      logo: row[5] || '' 
    })).filter(c => c.center_id && c.center_name); // Ignore empty rows

    res.json({ centers });
  } catch (error) {
    console.error('Error fetching centers:', error);
    res.status(500).json({ error: 'Failed to load centers' });
  }
});

// --- 2. Teacher Login Endpoint ---
app.post('/api/login', async (req, res) => {
  const { center_id, password } = req.body;

  if (!center_id || !password) {
    return res.status(400).json({ error: 'Center ID and password required' });
  }

  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.MASTER_SHEET_ID,
      range: 'Centers!A2:E',
    });

    const rows = response.data.values || [];
    
    // Find the center
    const center = rows.find(row => row[0] === center_id);

    if (!center) {
      return res.status(401).json({ error: 'Coaching center not found' });
    }

    const storedPassword = center[2];
    const expireDate = center[4];

    // Check password
    if (password !== storedPassword) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Check subscription expiry
    if (expireDate) {
      const parts = expireDate.split('/');
      if (parts.length === 3) {
        const expiry = new Date(parts[2], parts[1] - 1, parts[0]);
        const today = new Date();
        if (expiry < today) {
          return res.status(403).json({ error: 'Subscription expired. Contact support.' });
        }
      }
    }

    // Create the session token
    const token = jwt.sign(
      { center_id: center[0], sheet_id: center[3] },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ 
      success: true, 
      token, 
      center_name: center[1] 
    });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Health check route
app.get('/api/health', (req, res) => {
  res.send('BatchManager Pro API is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
