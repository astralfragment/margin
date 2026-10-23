<?php
/**
 * Server settings for margin-oauth.php. Copy to margin-oauth-config.php in the cPanel home folder (above the website folder),
 * so it is never reachable from the web, and fill in the two apps' credentials.
 * The redirect URI must match the callback URL set on both the Atlassian and the Figma app.
 */
return [
    'atlassian_client_id' => '',
    'atlassian_client_secret' => '',
    'figma_client_id' => '',
    'figma_client_secret' => '',
    'redirect_uri' => 'https://lilacfragment.co.za/margin-oauth.php',
];
