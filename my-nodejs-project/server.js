const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());
app.use(cors());

const JWT_SECRET = 'toxinxtriplesc'; // Change this to a strong random key
const NOWPAYMENTS_API_KEY = 'Z4V8FKY-C3J4AJ8-PQMTBVK-YPJZHN8';
const NOWPAYMENTS_API_URL = 'https://api.nowpayments.io/v1';

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/auth_db', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to MongoDB');
}).catch(err => {
    console.error('Failed to connect to MongoDB', err);
});

// Define User model
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 } // New field for balance
});

const User = mongoose.model('User', UserSchema);

app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ msg: 'Missing email or password' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
        return res.status(400).json({ msg: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 8);
    const user = new User({ email, password: hashedPassword });
    await user.save();

    res.status(200).json({ msg: 'User registered successfully' });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ msg: 'Missing email or password' });
    }

    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ msg: 'Invalid email or password' });
    }

    const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({ token });
});

app.get('/protected', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ msg: 'No token provided' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ msg: 'Invalid token' });
        }
        res.status(200).json({ msg: `Hello, ${decoded.email}` });
    });
});

// Route to create a payment invoice
app.post('/create-payment', async (req, res) => {
    const { amount, currency, userId } = req.body;

    if (!amount || !currency || !userId) {
        return res.status(400).json({ msg: 'Missing required fields' });
    }

    try {
        const response = await axios.post(`${NOWPAYMENTS_API_URL}/invoice`, {
            price_amount: amount,
            price_currency: 'usd',
            pay_currency: currency.toLowerCase(),
            ipn_callback_url: 'https://nowpayments.io',
            order_id: userId,
            order_description: `Deposit ${amount} ${currency}`
        }, {
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const paymentUrl = response.data.invoice_url; // Adjust according to the actual response structure
        res.status(200).json({ payment_url: paymentUrl });
    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: 'Failed to create payment invoice' });
    }
});

app.post('/payment-callback', async (req, res) => {
    const { order_id, payment_status, pay_amount, pay_currency } = req.body;

    if (payment_status === 'finished') {
        try {
            const user = await User.findOne({ email: order_id });
            if (user) {
                user.balance += pay_amount; // Assuming pay_amount is in USD or converted to your base currency
                await user.save();
                console.log(`Payment successful for user ${order_id}`);
            }
        } catch (error) {
            console.error('Error updating user balance:', error);
        }
    }

    app.get('/balance', async (req, res) => {
        const token = req.headers['authorization'];
        if (!token) {
            return res.status(401).json({ msg: 'No token provided' });
        }
    
        try {
            const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
            const user = await User.findOne({ email: decoded.email });
            if (!user) {
                return res.status(404).json({ msg: 'User not found' });
            }
            res.status(200).json({ balance: user.balance });
        } catch (error) {
            res.status(401).json({ msg: 'Invalid token' });
        }
    });

    // Route to request withdrawal
app.post('/request-withdrawal', async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ msg: 'No token provided' });
    }

    const { amount, walletAddress } = req.body;
    if (!amount || !walletAddress) {
        return res.status(400).json({ msg: 'Missing required fields' });
    }

    try {
        const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
        const user = await User.findOne({ email: decoded.email });
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        if (user.balance < amount) {
            return res.status(400).json({ msg: 'Insufficient balance' });
        }

        const response = await axios.post(`${NOWPAYMENTS_API_URL}/payment`, {
            price_amount: amount,
            price_currency: 'usd',
            pay_currency: 'usdt', // or any other currency
            ipn_callback_url: 'https://your-site.com/payment-callback',
            order_id: user._id.toString(),
            order_description: `Withdrawal ${amount} USD to ${walletAddress}`
        }, {
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        user.balance -= amount;
        await user.save();

        res.status(200).json({ transactionId: response.data.payment_id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: 'Failed to process withdrawal request' });
    }
});

    res.status(200).send('OK');
});
