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

app.get('/api/centers', async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.MASTER_SHEET_ID,
      range: 'Centers!A2:F',
    });
    const rows = response.data.values || [];
    const centers = rows.map(row => ({
      center_id: row[0],
      center_name: row[1],
      logo: row[5] || '' 
    })).filter(c => c.center_id && c.center_name);
    res.json({ centers });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to load centers' });
  }
});

app.post('/api/login', async (req, res) => {
  const { center_id, password } = req.body;
  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.MASTER_SHEET_ID,
      range: 'Centers!A2:E',
    });
    const rows = response.data.values || [];
    const center = rows.find(row => row[0] === center_id);
    if (!center) return res.status(401).json({ error: 'Center not found' });
    
    if (password !== center[2]) return res.status(401).json({ error: 'Incorrect password' });
    
    const expireDate = center[4];
    if (expireDate) {
      const parts = expireDate.split('/');
      if (parts.length === 3) {
        const expiry = new Date(parts[2], parts[1] - 1, parts[0]);
        if (expiry < new Date()) return res.status(403).json({ error: 'Subscription expired' });
      }
    }

    const token = jwt.sign({ center_id: center[0], sheet_id: center[3] }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, center_name: center[1] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/', (req, res) => res.send('API is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
