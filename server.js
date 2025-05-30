require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
};

// Function to get USDT exchange rate
async function getExchangeRate(currencyCode) {
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=${currencyCode}`
    );
    return response.data.tether[currencyCode.toLowerCase()] || false;
  } catch (error) {
    console.error('Error fetching exchange rate:', error);
    return false;
  }
}

// Function to generate UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// API endpoint
app.post('/v1/create', async (req, res) => {
  try {
    const requestData = req.body;

    // Default response
    const response = {
      status: 'false',
      error: ''
    };

    // Validate request structure
    if (!requestData.amount || !requestData.order_id || !requestData.shop_currency || 
        !requestData.shop_id || !requestData.sign) {
      response.error = 'Invalid request structure';
      return res.json(response);
    }

    const { amount, order_id, shop_currency, shop_id, sign } = requestData;

    // Connect to database
    const connection = await mysql.createConnection(dbConfig);

    // Get shop data and check status
    const [shopRows] = await connection.execute(
      'SELECT API_KEY, status FROM shops WHERE shop_id = ?',
      [shop_id]
    );

    if (shopRows.length === 0) {
      response.error = 'Invalid shop_id';
      return res.json(response);
    }

    const shop = shopRows[0];

    if (shop.status.toLowerCase() !== 'active') {
      response.error = 'Магазин неактивен';
      return res.json(response);
    }

    // Verify signature
    const params = {
      amount,
      order_id,
      shop_currency,
      shop_id
    };

    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {});

    const stringToSign = Object.values(sortedParams).join(':') + shop.API_KEY;
    const calculatedSign = crypto
      .createHash('sha256')
      .update(stringToSign)
      .digest('hex');

    if (sign !== calculatedSign) {
      response.error = 'Invalid signature';
      return res.json(response);
    }

    // Check if order_id exists
    const [orderRows] = await connection.execute(
      'SELECT COUNT(*) as count FROM payment_links WHERE order_id = ? AND shop_id = ?',
      [order_id, shop_id]
    );

    if (orderRows[0].count > 0) {
      response.error = 'Ссылка для этого заказа уже была сгенерирована';
      return res.json(response);
    }

    // Get currency code
    const [currencyRows] = await connection.execute(
      'SELECT code FROM shop_currency WHERE num = ?',
      [shop_currency]
    );

    if (currencyRows.length === 0) {
      response.error = 'Invalid currency number';
      return res.json(response);
    }

    const currencyCode = currencyRows[0].code;

    // Get exchange rate
    const exchangeRate = await getExchangeRate(currencyCode);
    if (!exchangeRate) {
      response.error = 'Не удалось получить курс валюты';
      return res.json(response);
    }

    // Calculate USDT amount
    const amountUsdt = Math.round((amount / exchangeRate) * 100) / 100;

    // Generate UUID and timestamp
    const uuid = generateUUID();
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Insert payment link
    await connection.execute(
      `INSERT INTO payment_links (uuid, order_id, amount, created_at, exchange_rate, amount_usdt, shop_id, shop_currency) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid, order_id, amount, createdAt, exchangeRate, amountUsdt, shop_id, currencyCode]
    );

    // Generate payment link
    const paymentLink = `https://pay.zyrapayments.com/pay/${uuid}`;

    // Prepare response parameters
    const responseParams = {
      amount_usdt: amountUsdt,
      created_at: createdAt,
      exchange_rate: exchangeRate,
      order_id,
      payment_link: paymentLink,
      shop_currency: shop_currency,
      status: 'true'
    };

    // Generate response signature
    const sortedResponseParams = Object.keys(responseParams)
      .sort()
      .reduce((acc, key) => {
        acc[key] = responseParams[key];
        return acc;
      }, {});

    const responseStringToSign = Object.values(sortedResponseParams).join(':') + shop.API_KEY;
    const responseSign = crypto
      .createHash('sha256')
      .update(responseStringToSign)
      .digest('hex');

    // Final response
    const finalResponse = {
      ...responseParams,
      sign: responseSign
    };

    await connection.end();
    res.json(finalResponse);

  } catch (error) {
    console.error('Error processing payment:', error);
    res.json({
      status: 'false',
      error: 'Internal server error'
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 