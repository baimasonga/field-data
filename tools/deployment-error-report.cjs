const fs = require('node:fs');

const summarize = (log, env = process.env) => {
  let text = log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const start = text.search(/\[ERROR\]|Error:|error:/);
  text = start < 0 ? 'Cloudflare upload failed. See the deployment step logs for details.' : text.slice(start);
  for (const [name, value] of Object.entries(env)) {
    if (!/(TOKEN|PASSWORD|PASSPHRASE|SECRET|ACCESS_KEY|ACCOUNT_ID|PGHOST|PGUSER|EMAIL)/.test(name) || !value) continue;
    for (const variant of [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]) text = text.split(variant).join('[redacted]');
  }
  return text.trim().slice(0, 1500).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
};

if (require.main === module) {
  const log = fs.readFileSync(process.argv[2], 'utf8');
  process.stdout.write(`::error title=Cloudflare upload failed::${summarize(log)}\n`);
}
module.exports = { summarize };
