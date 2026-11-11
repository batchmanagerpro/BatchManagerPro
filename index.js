const express = require('express');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- Google Sheets Auth ---
async function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// --- Auth Middleware ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user; // Contains center_name and sheet_id
    next();
  });
}

// --- 1. Login ---
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.MASTER_SHEET_ID,
      range: 'Centers!A2:F',
    });
    const rows = response.data.values || [];
    const center = rows.find(row => row[2] && row[2].toLowerCase().trim() === email.toLowerCase().trim());

    if (!center) return res.status(401).json({ error: 'Email not found' });
    if (password !== center[3]) return res.status(401).json({ error: 'Incorrect password' });
    
    // Check expiry
    const expireDate = center[5];
    if (expireDate) {
      const parts = expireDate.split('/');
      if (parts.length === 3) {
        const expiry = new Date(parts[2], parts[1] - 1, parts[0]);
        if (expiry < new Date()) return res.status(403).json({ error: 'Subscription expired' });
      }
    }

    const token = jwt.sign(
      { center_name: center[1], sheet_id: center[4] }, // Column E is Sheet ID
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ success: true, token, center_name: center[1] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- 2. Get Batches ---
app.get('/api/batches', authenticateToken, async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: req.user.sheet_id,
      range: 'Batches!A2:H', // batch_id, name, type, fee, deadline_day, cycle_length, created_at, active
    });
    const rows = response.data.values || [];
    const batches = rows.filter(r => r[7] !== 'FALSE').map(r => ({
      batch_id: r[0], name: r[1], type: r[2], fee: Number(r[3]),
      deadline_day: r[4], cycle_length: r[5]
    }));
    res.json({ batches });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load batches' });
  }
});

// --- 3. Get Students for a Batch ---
app.get('/api/batches/:batchId/students', authenticateToken, async (req, res) => {
  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: req.user.sheet_id,
      range: 'Students!A2:H',
    });
    const rows = response.data.values || [];
    const students = rows
      .filter(r => r[1] === req.params.batchId && r[7] !== 'FALSE')
      .map(r => ({ student_id: r[0], name: r[2], school: r[3], phone: r[4] }));
    res.json({ students });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load students' });
  }
});

// --- 4. Add Student (Generates ID) ---
app.post('/api/students', authenticateToken, async (req, res) => {
  const { batch_id, name, school, phone, address } = req.body;
  try {
    // Generate a unique 6-char ID like STU-8F4K9
    const generatedId = 'STU-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: req.user.sheet_id,
      range: 'Students!A2:H',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          generatedId, batch_id, name, school, phone, address, new Date().toISOString().split('T')[0], 'TRUE'
        ]]
      }
    });
    res.json({ success: true, student_id: generatedId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add student' });
  }
});

app.get('/', (req, res) => res.send('API is running'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
