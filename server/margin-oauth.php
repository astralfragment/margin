<?php
/**
 * Sign-in helper for the Margin Chrome extension, served from the Lilac Fragment site.
 * Atlassian and Figma only hand out tokens to apps that prove a client secret, and a secret cannot ship inside an extension.
 * This file holds the secrets on the server and does three things only.
 * A GET is the OAuth callback, sent on to the extension's chromiumapp.org address named in the state.
 * A POST swaps a sign-in code for tokens, or a refresh token for a new access token, and returns them.
 * It never stores or logs a code or a token, and it never sees review content, which goes from the extension straight to Jira and Figma.
 * Secrets live in margin-oauth-config.php above the web root.
 */

const MARGIN_EXTENSION_IDS = array('opdbdpplohjnbehmfgbncflhappbggem', 'ldhompocjnoloimngcpdlmfillfenmfa');
const MARGIN_PROVIDERS = array('jira', 'figma');
const MARGIN_MAX_BODY = 16384;
const MARGIN_STATE = '/^(jira|figma)\.([a-p]{32})\.([A-Za-z0-9_-]{16,128})$/';

/**
 * Find margin-oauth-config.php in the folders above the web root (up to four levels, then the account home), never inside the web root itself.
 */
function margin_config_path()
{
    $dir = dirname(__DIR__);
    for ($i = 0; $i < 4 && $dir !== dirname($dir); $i++, $dir = dirname($dir)) {
        if (is_file($dir . '/margin-oauth-config.php')) {
            return $dir . '/margin-oauth-config.php';
        }
    }
    $home = getenv('HOME');
    if ($home && is_file($home . '/margin-oauth-config.php')) {
        return $home . '/margin-oauth-config.php';
    }

    return '';
}

/**
 * Send a JSON answer and stop.
 * @param int $status The HTTP status.
 * @param array $body The fields to send.
 */
function margin_json($status, array $body)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body);
    exit;
}

/**
 * The extension id behind a request's Origin header, or an empty string when it is not Margin.
 */
function margin_origin_id()
{
    $origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
    if (preg_match('#^chrome-extension://([a-p]{32})$#', $origin, $m) && in_array($m[1], MARGIN_EXTENSION_IDS, true)) {
        return $m[1];
    }

    return '';
}

/**
 * Send the browser on to the extension, carrying the code or the error from the provider.
 * Chrome closes the sign-in window as soon as it reaches the chromiumapp.org address.
 */
function margin_callback()
{
    $state = isset($_GET['state']) ? (string) $_GET['state'] : '';
    if (!preg_match(MARGIN_STATE, $state, $m) || !in_array($m[2], MARGIN_EXTENSION_IDS, true)) {
        http_response_code(400);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'This sign-in link is not valid. Start again from Margin.';
        exit;
    }
    $params = array('state' => $state);
    foreach (array('code', 'error', 'error_description') as $key) {
        if (isset($_GET[$key]) && is_string($_GET[$key])) {
            $params[$key] = substr($_GET[$key], 0, 2048);
        }
    }
    header('Location: https://' . $m[2] . '.chromiumapp.org/' . $m[1] . '?' . http_build_query($params), true, 302);
    exit;
}

/**
 * Post to a provider's token endpoint and return its status and decoded answer.
 * @param string $url The token endpoint.
 * @param string $body The encoded request body.
 * @param array $headers Extra request headers.
 */
function margin_post($url, $body, array $headers)
{
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => array_merge(array('Accept: application/json'), $headers),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
    ));
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false || $status === 0) {
        margin_json(502, array('error' => 'provider_unreachable'));
    }
    $data = json_decode($raw, true);

    return array($status, is_array($data) ? $data : array());
}

/**
 * Swap a code or a refresh token for tokens with Atlassian, which takes the secret in a JSON body.
 * @param array $config The server settings.
 * @param array $req The extension's request.
 */
function margin_jira(array $config, array $req)
{
    $body = array(
        'client_id' => $config['atlassian_client_id'],
        'client_secret' => $config['atlassian_client_secret'],
    );
    if ($req['grant'] === 'refresh') {
        $body += array('grant_type' => 'refresh_token', 'refresh_token' => $req['refresh_token']);
    } else {
        $body += array('grant_type' => 'authorization_code', 'code' => $req['code'], 'redirect_uri' => $config['redirect_uri']);
    }

    return margin_post('https://auth.atlassian.com/oauth/token', json_encode($body), array('Content-Type: application/json'));
}

/**
 * Swap a code or a refresh token for tokens with Figma, which takes the secret as HTTP Basic auth.
 * @param array $config The server settings.
 * @param array $req The extension's request.
 */
function margin_figma(array $config, array $req)
{
    $auth = 'Authorization: Basic ' . base64_encode($config['figma_client_id'] . ':' . $config['figma_client_secret']);
    $form = array('Content-Type: application/x-www-form-urlencoded', $auth);
    if ($req['grant'] === 'refresh') {
        return margin_post('https://api.figma.com/v1/oauth/refresh', http_build_query(array('refresh_token' => $req['refresh_token'])), $form);
    }
    $body = array(
        'redirect_uri' => $config['redirect_uri'],
        'code' => $req['code'],
        'grant_type' => 'authorization_code',
        'code_verifier' => $req['code_verifier'],
    );

    return margin_post('https://api.figma.com/v1/oauth/token', http_build_query($body), $form);
}

/**
 * Handle a token request from the extension and answer with only the token fields.
 */
function margin_token()
{
    $id = margin_origin_id();
    if ($id === '') {
        margin_json(403, array('error' => 'unknown_origin'));
    }
    header('Access-Control-Allow-Origin: chrome-extension://' . $id);
    header('Vary: Origin');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        header('Access-Control-Allow-Methods: POST');
        header('Access-Control-Allow-Headers: Content-Type');
        header('Access-Control-Max-Age: 86400');
        http_response_code(204);
        exit;
    }

    $raw = file_get_contents('php://input', false, null, 0, MARGIN_MAX_BODY + 1);
    $req = json_decode((string) $raw, true);
    if (strlen((string) $raw) > MARGIN_MAX_BODY || !is_array($req)) {
        margin_json(400, array('error' => 'bad_request'));
    }
    $req += array('provider' => '', 'grant' => 'code', 'code' => '', 'code_verifier' => '', 'refresh_token' => '');
    $refresh = $req['grant'] === 'refresh';
    if (!in_array($req['provider'], MARGIN_PROVIDERS, true) || !in_array($req['grant'], array('code', 'refresh'), true)
        || ($refresh ? $req['refresh_token'] === '' : $req['code'] === '')) {
        margin_json(400, array('error' => 'bad_request'));
    }

    $file = margin_config_path();
    $config = $file !== '' ? include $file : array();
    $prefix = $req['provider'] === 'jira' ? 'atlassian' : 'figma';
    if (!is_array($config) || empty($config[$prefix . '_client_id']) || empty($config[$prefix . '_client_secret'])) {
        margin_json(503, array('error' => 'not_configured'));
    }
    $config += array('redirect_uri' => 'https://lilacfragment.co.za/margin-oauth.php');

    list($status, $data) = $req['provider'] === 'jira' ? margin_jira($config, $req) : margin_figma($config, $req);
    $keep = array('access_token', 'refresh_token', 'expires_in', 'scope', 'token_type', 'user_id_string', 'error', 'error_description', 'message');
    margin_json($status, array_intersect_key($data, array_flip($keep)));
}

header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    margin_callback();
}
if ($_SERVER['REQUEST_METHOD'] === 'POST' || $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    margin_token();
}
http_response_code(405);
header('Allow: GET, POST, OPTIONS');
exit;
