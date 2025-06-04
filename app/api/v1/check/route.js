import { NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import crypto from 'crypto';

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
};

export async function POST(request) {
  try {
    const requestData = await request.json();

    // Default response
    const response = {
      status: 'false',
      error: ''
    };

    // Validate request structure
    if (!requestData.now || !requestData.shop_id || !requestData.order_id || !requestData.sign) {
      response.error = 'Invalid request structure';
      return NextResponse.json(response);
    }

    const { now, shop_id, order_id, sign } = requestData;

    // Connect to database
    const connection = await mysql.createConnection(dbConfig);

    // Get shop data
    const [shopRows] = await connection.execute(
      'SELECT API_KEY FROM shops WHERE shop_id = ?',
      [shop_id]
    );

    if (shopRows.length === 0) {
      response.error = 'Invalid shop_id';
      await connection.end();
      return NextResponse.json(response);
    }

    const shop = shopRows[0];

    // Verify signature
    const params = {
      now,
      order_id,
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
      await connection.end();
      return NextResponse.json(response);
    }

    // Get payment data
    const [paymentRows] = await connection.execute(
      'SELECT status, amount_usdt, created_at, processed_at FROM payment_links WHERE order_id = ? AND shop_id = ?',
      [order_id, shop_id]
    );

    if (paymentRows.length === 0) {
      response.error = 'Payment not found';
      await connection.end();
      return NextResponse.json(response);
    }

    const payment = paymentRows[0];

    // Prepare response based on payment status
    let responseParams;
    
    if (payment.status === 'success') {
      responseParams = {
        shop_id,
        status: payment.status,
        message: 'ok',
        order_id,
        amount_usdt: payment.amount_usdt,
        created_at: payment.created_at,
        processed_at: payment.processed_at
      };
    } else {
      responseParams = {
        shop_id,
        status: payment.status,
        message: 'ok',
        order_id
      };
    }

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
    return NextResponse.json(finalResponse);

  } catch (error) {
    console.error('Error checking payment:', error);
    return NextResponse.json({
      status: 'false',
      error: 'Internal server error'
    });
  }
} 