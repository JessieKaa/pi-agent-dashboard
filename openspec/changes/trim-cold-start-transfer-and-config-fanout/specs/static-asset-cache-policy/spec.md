# static-asset-cache-policy Spec

## ADDED Requirements

### Requirement: Content-hashed assets are immutable; HTML is never cached

The dashboard server SHALL serve static files under the Vite content-hashed
`assets/` directory with `Cache-Control: public, max-age=31536000, immutable`,
including precompressed `.gz` siblings. Root HTML documents (the landing
`index.html` and paths resolved through the SPA fallback) SHALL keep
`Cache-Control: no-store`. Non-hashed root static files (`sw.js`,
`manifest.json`, icons) SHALL keep the static plugin's default policy.

#### Scenario: A hashed asset response is immutable-cacheable
- **WHEN** the browser requests `/assets/<name>-<hash>.js`
- **THEN** the response carries `public, max-age=31536000, immutable`

#### Scenario: The gzipped sibling carries the same policy
- **WHEN** the browser requests the same asset with `Accept-Encoding: gzip` and the precompressed sibling is served
- **THEN** the response carries `public, max-age=31536000, immutable`

#### Scenario: HTML stays uncacheable
- **WHEN** the browser requests `/` (or any SPA-fallback route)
- **THEN** the response carries `no-store`

#### Scenario: A returning visit revalidates nothing it cannot change
- **WHEN** the user revisits the dashboard with a warm cache
- **THEN** hashed asset requests are served from cache without a network request
