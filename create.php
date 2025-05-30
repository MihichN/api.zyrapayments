<?php
// Включение отображения ошибок для отладки
error_reporting(E_ALL);
ini_set('display_errors', 1);
// Устанавливаем заголовок JSON
header('Content-Type: application/json');

// Подключаемся к базе данных
include('../cfg.php');

// Проверяем конфигурацию
if (!defined('DB_HOST') || !defined('DB_USER') || !defined('DB_PASS') || !defined('DB_NAME')) {
    die(json_encode(["error" => "Database configuration is missing."]));
}

// Подключение к БД
try {
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME, DB_USER, DB_PASS);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    die(json_encode(["error" => "Database connection failed: " . $e->getMessage()])); 
}

// Функция получения курса USDT к RUB через CoinGecko
function getExchangeRate() {
    global $currency_code;
    $apiUrl = "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=$currency_code";

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $apiUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $response = curl_exec($ch);
    curl_close($ch);

    if ($response) {
        $data = json_decode($response, true);
        return $data['tether'][strtolower($currency_code)] ?? false;
    }
    return false;
}

// Получаем данные POST
$data = file_get_contents("php://input");
$request = json_decode($data, true);

// Ответ по умолчанию
$response = [
    'status' => 'false',
    'error' => ''
];

// Проверяем структуру запроса
if (!isset($request['amount'], $request['order_id'], $request['shop_currency'], $request['shop_id'], $request['sign'])) {
    $response['error'] = 'Invalid request structure';
    echo json_encode($response);
    exit;
}

// Данные запроса
$amount = $request['amount'];
$order_id = $request['order_id'];
$shop_currency = $request['shop_currency'];
$shop_id = $request['shop_id'];
$sign = $request['sign'];

// Получаем данные о магазине и проверяем статус
$stmt = $pdo->prepare("SELECT API_KEY, status FROM shops WHERE shop_id = ?");
$stmt->execute([$shop_id]);
$shop = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$shop) {
    $response['error'] = 'Invalid shop_id';
    echo json_encode($response);
    exit;
}

if (strtolower($shop['status']) !== 'active') {
    $response['error'] = 'Магазин неактивен';
    echo json_encode($response);
    exit;
}

$api_key = $shop['API_KEY'];


// Правильная проверка подписи (сортируем по ключам)
$params = [
    'amount' => $amount,
    'order_id' => $order_id,
    'shop_currency' => $shop_currency,
    'shop_id' => $shop_id
];

ksort($params); // Сортируем ключи в алфавитном порядке
$string_to_sign = implode(':', $params) . $api_key;
$calculated_sign = hash('sha256', $string_to_sign);

if ($sign !== $calculated_sign) {
    $response['error'] = 'Invalid signature';
    echo json_encode($response);
    exit;
}

// Проверяем, существует ли order_id
$stmt = $pdo->prepare("SELECT COUNT(*) FROM payment_links WHERE order_id = ? AND shop_id = ?");
$stmt->execute([$order_id, $shop_id]);
$order_exists = $stmt->fetchColumn();
if ($order_exists > 0) {
    $response['error'] = 'Ссылка для этого заказа уже была сгенерирована';
    echo json_encode($response);
    exit;
}

// Получаем num из запроса и ищем соответствующий code в таблице shop_currency
$stmt = $pdo->prepare("SELECT code FROM shop_currency WHERE num = ?");
$stmt->execute([$shop_currency]);
$currency = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$currency) {
    $response['error'] = 'Invalid currency number';
    echo json_encode($response);
    exit;
}

// Извлекаем code для найденного num
$currency_code = $currency['code'];

// Получаем курс USDT к RUB
$exchangeRate = getExchangeRate();
if (!$exchangeRate) {
    $response['error'] = 'Не удалось получить курс валюты';
    echo json_encode($response);
    exit;
}

// Рассчитываем сумму в USDT
$amount_usdt = round($amount / $exchangeRate, 2);

// Генерация UUID для заказа
function generate_uuid() {
    return sprintf(
        '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}

$uuid = generate_uuid();
$created_at = date('Y-m-d H:i:s');

// Записываем данные в таблицу payment_links, включая кошелек
$stmt = $pdo->prepare("INSERT INTO payment_links (uuid, order_id, amount, created_at, exchange_rate, amount_usdt, shop_id, shop_currency) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
$stmt->execute([$uuid, $order_id, $amount, $created_at, $exchangeRate, $amount_usdt, $shop_id, $currency_code]);

// Формируем платежную ссылку с UUID
$payment_link = "https://pay.zyrapayments.com/pay/" . $uuid;

// Формируем подпись для ответа (сортировка по ключам)
$response_params = [
    'amount_usdt' => $amount_usdt,
    'created_at' => $created_at,
    'exchange_rate' => $exchangeRate,
    'order_id' => $order_id,
    'payment_link' => $payment_link,
    'shop_currency' => $shop_currency,
    'status' => 'true',
];

ksort($response_params); // Сортируем ключи
$response_string_to_sign = implode(':', $response_params) . $api_key;
$response_sign = hash('sha256', $response_string_to_sign);

// Формируем ответ
$response = [
    'status' => 'true',
    'payment_link' => $payment_link,
    'created_at' => $created_at,
    'order_id' => $order_id,
    'shop_currency' => $shop_currency,
    'exchange_rate' => $exchangeRate,
    'amount_usdt' => $amount_usdt,
    'sign' => $response_sign
];

// Отправляем JSON
echo json_encode($response);
?>
