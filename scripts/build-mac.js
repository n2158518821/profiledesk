const { spawnSync } = require('node:child_process');

const allowedArchitectures = new Set(['x64', 'arm64']);
const architecture = process.argv[2];

if (!allowedArchitectures.has(architecture)) {
  process.stderr.write('Usage: node scripts/build-mac.js <x64|arm64>\n');
  process.exit(2);
}

const hasSigningCertificate = Boolean(
  process.env.CSC_LINK?.trim() || process.env.CSC_NAME?.trim(),
);
const hasAppleIdNotarization = Boolean(
  process.env.APPLE_ID?.trim()
    && process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim()
    && process.env.APPLE_TEAM_ID?.trim(),
);
const hasApiKeyNotarization = Boolean(
  process.env.APPLE_API_KEY?.trim()
    && process.env.APPLE_API_KEY_ID?.trim()
    && process.env.APPLE_API_ISSUER?.trim(),
);

const args = [
  require.resolve('electron-builder/out/cli/cli.js'),
  '--mac',
  'dmg',
  `--${architecture}`,
  '--publish',
  'never',
];

if (!hasSigningCertificate) {
  // An unsigned app cannot safely use Hardened Runtime. This mode is only for
  // trusted development builds that the user explicitly approves on their Mac.
  args.push(
    '-c.mac.identity=null',
    '-c.mac.hardenedRuntime=false',
    '-c.mac.notarize=false',
  );
  process.stdout.write(
    'No Developer ID certificate detected; building an unsigned macOS development package.\n',
  );
} else if (!hasAppleIdNotarization && !hasApiKeyNotarization) {
  args.push('-c.mac.notarize=false');
  process.stdout.write(
    'Developer ID certificate detected, but notarization credentials are incomplete; building a signed, unnotarized package.\n',
  );
} else {
  process.stdout.write('Building a signed and notarized macOS package.\n');
}

const result = spawnSync(process.execPath, args, {
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
