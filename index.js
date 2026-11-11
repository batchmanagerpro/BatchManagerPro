const express = require('express');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

async function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.MASTER_SHEET_ID,
      range: 'Centers!A2:F', // Read A to F
    });

    const rows = response.data.values || [];
    
    // Find the center by email (Column C, which is index 2)
    const center = rows.find(row => 
      row[2] && row[2].toString().toLowerCase().trim() === email.toLowerCase().trim()
    );

    if (!center) {
      return res.status(401).json({ error: 'Email not found' });
    }

    const storedPassword = center[3]; // Column D (Master-Password)
    const expireDate = center[5];     // Column F (Subscription-Expire)
    const centerName = center[1];     // Column B (Center-Name)

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

    // Create token
    const token = jwt.sign(
      { email: email, center_name: centerName },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, token, center_name: centerName });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.get('/', (req, res) => res.send('API is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
